const axios = require('axios');
const cheerio = require('cheerio');
const { createLogger } = require('../utils/logger');
const { assertSafeHttpUrl } = require('../utils/urlSecurity');

const log = createLogger('services:technical-seo');
const MAX_SITEMAP_URLS = 250;
const DEFAULT_MAX_PAGES = 20;
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

async function auditSite(siteUrl, options = {}) {
    const normalizedUrl = normalizeSiteUrl(siteUrl);
    await assertSafeHttpUrl(normalizedUrl);
    const maxPages = clampNumber(options.maxPages, 5, 50, DEFAULT_MAX_PAGES);
    const baseUrl = new URL(normalizedUrl);
    const siteOrigin = baseUrl.origin;
    const visited = new Set();
    const queued = new Set([normalizedUrl]);
    const queue = [{ url: normalizedUrl, depth: 0, source: null }];
    const inboundLinkCounts = new Map();
    const crawledPages = [];
    const pageByUrl = new Map();
    const titleBuckets = new Map();
    const metaBuckets = new Map();

    const robotsTxt = await fetchRobotsTxt(baseUrl);
    const discoveredSitemaps = await discoverSitemaps(baseUrl, robotsTxt);

    while (queue.length && crawledPages.length < maxPages) {
        const next = queue.shift();
        if (!next || visited.has(next.url)) {
            continue;
        }

        visited.add(next.url);

        try {
            const page = await crawlPage(next.url, next.depth, next.source, siteOrigin, {
                checkSecurityHeaders: options.checkSecurityHeaders,
            });
            page.inboundLinks = inboundLinkCounts.get(page.url) || 0;
            crawledPages.push(page);
            pageByUrl.set(page.url, page);

            if (page.title) {
                pushMapValue(titleBuckets, normalizeText(page.title), page.url);
            }
            if (page.metaDescription) {
                pushMapValue(metaBuckets, normalizeText(page.metaDescription), page.url);
            }

            if (page.status >= 300 && page.status < 400 && page.redirectTo && isInternalUrl(page.redirectTo, siteOrigin)) {
                const redirectTarget = cleanUrl(page.redirectTo, siteOrigin);
                if (!visited.has(redirectTarget) && !queued.has(redirectTarget) && crawledPages.length + queue.length < maxPages * 2) {
                    queued.add(redirectTarget);
                    queue.push({ url: redirectTarget, depth: page.depth + 1, source: page.url });
                }
            }

            for (const link of page.internalLinksDiscovered) {
                const cleanLink = cleanUrl(link, siteOrigin);
                inboundLinkCounts.set(cleanLink, (inboundLinkCounts.get(cleanLink) || 0) + 1);
                if (!visited.has(cleanLink) && !queued.has(cleanLink) && queue.length + crawledPages.length < maxPages * 2) {
                    queued.add(cleanLink);
                    queue.push({ url: cleanLink, depth: page.depth + 1, source: page.url });
                }
            }
        } catch (err) {
            log.warn({ url: next.url, err: err.message }, 'technical crawl failed for page');
            crawledPages.push({
                url: next.url,
                depth: next.depth,
                source: next.source,
                status: 0,
                statusLabel: 'Request failed',
                title: '',
                metaDescription: '',
                canonical: '',
                robotsMeta: '',
                isIndexable: false,
                hasCanonical: false,
                canonicalStatus: 'missing',
                internalLinks: 0,
                externalLinks: 0,
                inboundLinks: inboundLinkCounts.get(next.url) || 0,
                contentType: '',
                issues: ['Request failed'],
                internalLinksDiscovered: [],
                loadMs: 0,
            });
        }
    }

    const sitewide = buildSitewideAnalysis({
        siteUrl: normalizedUrl,
        siteOrigin,
        pages: crawledPages,
        robotsTxt,
        sitemaps: discoveredSitemaps,
        titleBuckets,
        metaBuckets,
        maxPages,
    });

    return {
        siteUrl: normalizedUrl,
        overall: sitewide.overall,
        categories: sitewide.categories,
        summary: sitewide.summary,
        issues: sitewide.issues,
        pages: sitewide.pages,
        robotsTxt,
        sitemaps: discoveredSitemaps,
        crawlConfig: {
            maxPages,
            checkSecurityHeaders: Boolean(options.checkSecurityHeaders),
        },
        analyzedAt: new Date().toISOString(),
    };
}

async function crawlPage(url, depth, source, siteOrigin, options = {}) {
    const startedAt = Date.now();
    const response = await fetchUrl(url, { maxRedirects: 0 });
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    const location = response.headers.location ? absolutizeUrl(response.headers.location, url) : '';
    const page = {
        url: cleanUrl(url, siteOrigin),
        depth,
        source,
        status: response.status,
        statusLabel: getStatusLabel(response.status),
        title: '',
        metaDescription: '',
        canonical: '',
        robotsMeta: '',
        isIndexable: false,
        hasCanonical: false,
        canonicalStatus: 'missing',
        internalLinks: 0,
        externalLinks: 0,
        inboundLinks: 0,
        contentType,
        issues: [],
        internalLinksDiscovered: [],
        redirectTo: location,
        loadMs: Date.now() - startedAt,
    };

    if (response.status >= 300 && response.status < 400) {
        if (!location) {
            page.issues.push('Redirect without location header');
        }
        return page;
    }

    if (response.status >= 400) {
        page.issues.push(`HTTP ${response.status}`);
        return page;
    }

    if (!contentType.includes('text/html')) {
        page.issues.push('Non-HTML response');
        return page;
    }

    const html = typeof response.data === 'string' ? response.data : String(response.data || '');
    const $ = cheerio.load(html);
    const title = $('title').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content') || '';
    const canonicalRaw = $('link[rel="canonical"]').attr('href') || '';
    const canonical = canonicalRaw ? absolutizeUrl(canonicalRaw, url) : '';
    const robotsMeta = ($('meta[name="robots"]').attr('content') || '').toLowerCase();
    const allLinks = $('a[href]').map((_, element) => $(element).attr('href') || '').get();
    const internalLinksDiscovered = [];
    let externalLinks = 0;

    allLinks.forEach((href) => {
        const absolute = absolutizeUrl(href, url);
        if (!absolute) {
            return;
        }
        if (isInternalUrl(absolute, siteOrigin)) {
            internalLinksDiscovered.push(absolute);
        } else {
            externalLinks += 1;
        }
    });

    page.title = title;
    page.metaDescription = metaDescription;
    page.canonical = canonical;
    page.robotsMeta = robotsMeta;
    page.hasCanonical = !!canonical;
    page.canonicalStatus = getCanonicalStatus(page.url, canonical, siteOrigin);
    page.isIndexable = !robotsMeta.includes('noindex') && response.status === 200;
    page.internalLinks = uniqueCount(internalLinksDiscovered);
    page.externalLinks = externalLinks;
    page.internalLinksDiscovered = uniqueUrls(internalLinksDiscovered, siteOrigin);

    // Hreflang extraction
    page.hreflang = $('link[rel="alternate"][hreflang]').map((_, el) => ({
        lang: $(el).attr('hreflang') || '',
        href: absolutizeUrl($(el).attr('href') || '', url),
    })).get().filter(h => h.href && h.lang);

    // Pagination extraction
    page.pagination = {
        next: $('link[rel="next"]').attr('href') ? absolutizeUrl($('link[rel="next"]').attr('href'), url) : null,
        prev: $('link[rel="prev"]').attr('href') ? absolutizeUrl($('link[rel="prev"]').attr('href'), url) : null,
    };

    // Structured data extraction
    page.structuredData = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse($(el).html());
            const items = Array.isArray(parsed) ? parsed : [parsed];
            items.forEach(item => {
                const types = item['@type'] ? (Array.isArray(item['@type']) ? item['@type'] : [item['@type']]) : [];
                page.structuredData.push({ types, raw: item });
            });
        } catch { /* skip invalid JSON-LD */ }
    });

    // Heading structure audit
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
        headings.push({ tag: el.name.toUpperCase(), text: $(el).text().trim() });
    });
    page.headings = headings;
    page.h1Count = headings.filter(h => h.tag === 'H1').length;
    page.h2Count = headings.filter(h => h.tag === 'H2').length;
    page.headingHierarchyValid = validateHeadingHierarchy(headings);

    // Image audit
    const images = [];
    $('img').each((_, el) => {
        const src = $(el).attr('src') || '';
        const alt = $(el).attr('alt') || '';
        const width = $(el).attr('width');
        const height = $(el).attr('height');
        images.push({
            src: absolutizeUrl(src, url),
            alt,
            hasAlt: alt.trim().length > 0,
            hasDimensions: !!width && !!height,
        });
    });
    page.images = images;
    page.imageCount = images.length;
    page.imagesMissingAlt = images.filter(img => !img.hasAlt).length;
    page.imagesMissingDimensions = images.filter(img => !img.hasDimensions).length;

    // Word count & thin content detection
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    page.wordCount = wordCount;
    page.isThinContent = wordCount < 300;

    // Mixed content detection (HTTP resources on HTTPS page)
    if (url.startsWith('https:')) {
        const mixedContent = [];
        const resourceSelectors = [
            'img[src^="http:"]',
            'script[src^="http:"]',
            'link[href^="http:"]',
            'iframe[src^="http:"]',
            'video[src^="http:"]',
            'audio[src^="http:"]',
            'source[src^="http:"]',
        ];
        resourceSelectors.forEach(selector => {
            $(selector).each((_, el) => {
                const attr = el.name === 'link' ? 'href' : 'src';
                const resourceUrl = $(el).attr(attr);
                if (resourceUrl && resourceUrl.startsWith('http:')) {
                    mixedContent.push({ tag: el.name, url: resourceUrl, attribute: attr });
                }
            });
        });
        page.mixedContent = mixedContent;
        page.hasMixedContent = mixedContent.length > 0;
    } else {
        page.mixedContent = [];
        page.hasMixedContent = false;
    }

    // Security headers (from response)
    page.securityHeaders = {
        hsts: !!response.headers['strict-transport-security'],
        csp: !!response.headers['content-security-policy'],
        xFrameOptions: !!response.headers['x-frame-options'],
        xContentTypeOptions: !!response.headers['x-content-type-options'],
        referrerPolicy: !!response.headers['referrer-policy'],
        permissionsPolicy: !!response.headers['permissions-policy'],
        crossOriginOpenerPolicy: !!response.headers['cross-origin-opener-policy'],
        crossOriginResourcePolicy: !!response.headers['cross-origin-resource-policy'],
    };
    page.missingSecurityHeaders = options.checkSecurityHeaders
        ? Object.entries(page.securityHeaders)
            .filter(([_, present]) => !present)
            .map(([header]) => header)
        : [];

    if (!title) {
        page.issues.push('Missing title');
    }
    if (!metaDescription) {
        page.issues.push('Missing meta description');
    }
    if (!canonical) {
        page.issues.push('Missing canonical');
    }
    if (page.canonicalStatus === 'cross-domain') {
        page.issues.push('Canonical points to another domain');
    }
    if (robotsMeta.includes('noindex')) {
        page.issues.push('Meta noindex');
    }
    if (page.internalLinks === 0 && depth > 0) {
        page.issues.push('No internal links out');
    }
    if (page.h1Count === 0) {
        page.issues.push('Missing H1 heading');
    }
    if (page.h1Count > 1) {
        page.issues.push('Multiple H1 headings');
    }
    if (!page.headingHierarchyValid) {
        page.issues.push('Invalid heading hierarchy (skipped levels)');
    }
    if (page.imagesMissingAlt > 0) {
        page.issues.push(`${page.imagesMissingAlt} image(s) missing alt text`);
    }
    if (page.hasMixedContent) {
        page.issues.push(`${page.mixedContent.length} mixed content resource(s) (HTTP on HTTPS page)`);
    }
    if (page.missingSecurityHeaders.length > 0) {
        page.issues.push(`Missing security headers: ${page.missingSecurityHeaders.join(', ')}`);
    }
    if (page.isThinContent) {
        page.issues.push(`Thin content (${page.wordCount} words)`);
    }

    return page;
}

function buildSitewideAnalysis({ siteUrl, siteOrigin, pages, robotsTxt, sitemaps, titleBuckets, metaBuckets, maxPages }) {
    const issues = [];
    const addIssue = (category, severity, name, desc, fix, current = '', expected = '', affectedUrls = []) => {
        issues.push({ category, severity, name, desc, fix, current, expected, affectedUrls });
    };

    const htmlPages = pages.filter((page) => page.contentType.includes('text/html') || page.status === 0 || (page.status >= 300 && page.status < 400) || page.status >= 400);
    const brokenPages = htmlPages.filter((page) => page.status >= 400 || page.status === 0);
    const redirectedPages = htmlPages.filter((page) => page.status >= 300 && page.status < 400);
    const noindexPages = htmlPages.filter((page) => page.robotsMeta.includes('noindex'));
    const missingCanonicalPages = htmlPages.filter((page) => page.status === 200 && !page.hasCanonical);
    const canonicalCrossDomainPages = htmlPages.filter((page) => page.canonicalStatus === 'cross-domain');
    const deepPages = htmlPages.filter((page) => page.depth >= 4);
    const weaklyLinkedPages = htmlPages.filter((page) => page.status === 200 && page.depth > 0 && page.inboundLinks <= 1);
    const pageByUrl = new Map(htmlPages.map((page) => [page.url, page]));
    const duplicateTitleGroups = getDuplicateGroups(titleBuckets);
    const duplicateMetaGroups = getDuplicateGroups(metaBuckets);
    const sitemapUrls = uniqueUrls(sitemaps.flatMap((item) => item.urls || []), siteOrigin);
    const orphanSitemapUrls = sitemapUrls.filter((url) => !pages.some((page) => page.url === url));

    if (!robotsTxt.found) {
        addIssue(
            'crawlability',
            'important',
            'robots.txt not found',
            'Search engines expect a robots.txt file at the site root. Missing it reduces control over crawl directives and sitemap discovery.',
            `Add a robots.txt file at ${siteOrigin}/robots.txt with at least a sitemap reference and basic crawl rules.`,
            'Missing',
            'Accessible robots.txt',
            []
        );
    }

    if (robotsTxt.disallowAll) {
        addIssue(
            'crawlability',
            'critical',
            'robots.txt blocks all crawling',
            'The current robots.txt appears to disallow crawling for all user agents, which can prevent important pages from being discovered.',
            'Remove the global `Disallow: /` rule or scope it to non-public sections only.',
            'Disallow: /',
            'Allow crawl for public pages',
            [siteUrl]
        );
    }

    if (!sitemaps.length) {
        addIssue(
            'sitemaps',
            'important',
            'No XML sitemap discovered',
            'A crawlable XML sitemap helps search engines discover important URLs faster and verify canonical coverage.',
            `Publish a sitemap at ${siteOrigin}/sitemap.xml and reference it in robots.txt.`,
            'No sitemap found',
            'At least one accessible XML sitemap',
            []
        );
    }

    if (brokenPages.length) {
        addIssue(
            'crawlability',
            'critical',
            `${brokenPages.length} broken page(s) found`,
            'Broken URLs waste crawl budget and create dead ends for users and search engines.',
            'Fix the failing URLs, restore the page, or 301 redirect them to the best matching live page.',
            `${brokenPages.length} broken URLs`,
            '0 broken HTML pages',
            brokenPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (redirectedPages.length) {
        addIssue(
            'crawlability',
            'important',
            `${redirectedPages.length} redirecting URL(s) in crawl`,
            'Internal links should point directly to final destination URLs instead of relying on redirects.',
            'Update internal links and sitemap entries to use the final canonical destination URL.',
            `${redirectedPages.length} redirects`,
            'Internal links should resolve with 200 status',
            redirectedPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (missingCanonicalPages.length) {
        addIssue(
            'indexability',
            'important',
            `${missingCanonicalPages.length} page(s) missing canonical tags`,
            'Canonical tags help search engines consolidate duplicate URLs and understand the preferred version of each page.',
            'Add a self-referencing canonical on each indexable page.',
            `${missingCanonicalPages.length} missing canonicals`,
            'Self-referencing canonical on indexable pages',
            missingCanonicalPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (canonicalCrossDomainPages.length) {
        addIssue(
            'indexability',
            'critical',
            `${canonicalCrossDomainPages.length} cross-domain canonical issue(s)`,
            'Cross-domain canonicals can de-index your own URLs if they point to another site by mistake.',
            'Review and correct canonical tags so they point to the intended preferred URL on this site.',
            `${canonicalCrossDomainPages.length} cross-domain canonicals`,
            'Canonical should point to the preferred URL on the same site',
            canonicalCrossDomainPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (noindexPages.length) {
        addIssue(
            'indexability',
            'important',
            `${noindexPages.length} page(s) set to noindex`,
            'Noindex directives are useful for low-value pages, but they should be intentional and reviewed regularly.',
            'Confirm these pages should stay out of search results. Remove `noindex` from any page that should rank.',
            `${noindexPages.length} noindex pages`,
            'Only intentional noindex directives',
            noindexPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (duplicateTitleGroups.length) {
        addIssue(
            'indexability',
            'important',
            `${duplicateTitleGroups.length} duplicate title cluster(s)`,
            'Duplicate titles make it harder for search engines to understand the unique purpose of each page.',
            'Rewrite duplicated title tags so each page targets a unique intent and primary topic.',
            `${duplicateTitleGroups.length} duplicate title groups`,
            'Unique title per indexable page',
            flattenGroups(duplicateTitleGroups, 20)
        );
    }

    if (duplicateMetaGroups.length) {
        addIssue(
            'indexability',
            'good',
            `${duplicateMetaGroups.length} duplicate meta description cluster(s)`,
            'Duplicate meta descriptions reduce click-through differentiation in search results.',
            'Write unique descriptions for the highest-value duplicated pages first.',
            `${duplicateMetaGroups.length} duplicate meta groups`,
            'Unique meta description per important page',
            flattenGroups(duplicateMetaGroups, 20)
        );
    }

    if (orphanSitemapUrls.length) {
        addIssue(
            'architecture',
            'important',
            `${orphanSitemapUrls.length} sitemap URL(s) not reached in crawl`,
            'URLs present in the sitemap but unreachable from internal navigation may be orphaned or weakly linked.',
            'Add internal links to these pages from relevant hubs or confirm they belong in the sitemap.',
            `${orphanSitemapUrls.length} sitemap-only URLs`,
            'Important sitemap URLs should be internally linked',
            orphanSitemapUrls.slice(0, 20)
        );
    }

    if (deepPages.length) {
        addIssue(
            'architecture',
            'important',
            `${deepPages.length} deep page(s) found`,
            'Pages deeper than three clicks from the entry point are harder for users and crawlers to discover consistently.',
            'Strengthen hub pages, breadcrumbs, and contextual links to reduce crawl depth for important pages.',
            `${deepPages.length} pages at depth 4+`,
            'Important pages should usually be within 3 clicks',
            deepPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (weaklyLinkedPages.length) {
        addIssue(
            'architecture',
            'good',
            `${weaklyLinkedPages.length} weakly linked page(s)`,
            'Pages with only one or zero discovered internal links often struggle to earn crawl attention and authority flow.',
            'Add contextual internal links from relevant category, blog, or service pages.',
            `${weaklyLinkedPages.length} weakly linked pages`,
            'Important pages should have multiple internal links',
            weaklyLinkedPages.slice(0, 20).map((page) => page.url)
        );
    }

    const missingH1Pages = htmlPages.filter((page) => page.status === 200 && page.h1Count === 0);
    const multipleH1Pages = htmlPages.filter((page) => page.status === 200 && page.h1Count > 1);
    const invalidHeadingHierarchyPages = htmlPages.filter((page) => page.status === 200 && page.headingHierarchyValid === false);
    const pagesWithMissingAltImages = htmlPages.filter((page) => page.status === 200 && page.imagesMissingAlt > 0);
    const pagesWithMissingDimensionImages = htmlPages.filter((page) => page.status === 200 && page.imagesMissingDimensions > 0);
    const thinContentPages = htmlPages.filter((page) => page.status === 200 && page.isThinContent);
    const mixedContentPages = htmlPages.filter((page) => page.status === 200 && page.hasMixedContent);
    const missingSecurityHeadersPages = htmlPages.filter((page) => page.status === 200 && page.missingSecurityHeaders && page.missingSecurityHeaders.length > 0);
    const missingSecurityHeaderCounts = htmlPages
        .filter((page) => page.status === 200 && page.missingSecurityHeaders && page.missingSecurityHeaders.length > 0)
        .reduce((counts, page) => {
            page.missingSecurityHeaders.forEach((header) => {
                counts[header] = (counts[header] || 0) + 1;
            });
            return counts;
        }, {});

    if (missingH1Pages.length) {
        addIssue(
            'content',
            'important',
            `${missingH1Pages.length} page(s) missing H1 heading`,
            'Every indexable page should have one clear H1 that communicates the primary topic to users and search engines.',
            'Add a unique, descriptive H1 to each page. Avoid hiding the H1 with CSS; use one H1 near the top of the main content.',
            `${missingH1Pages.length} pages without H1`,
            'One unique H1 per indexable page',
            missingH1Pages.slice(0, 20).map((page) => page.url)
        );
    }

    if (multipleH1Pages.length) {
        addIssue(
            'content',
            'good',
            `${multipleH1Pages.length} page(s) with multiple H1 headings`,
            'Multiple H1 tags can dilute the main topic signal and make content structure less clear.',
            'Keep one primary H1 per page and use H2-H6 for subsections.',
            `${multipleH1Pages.length} pages with multiple H1s`,
            'One H1 per page',
            multipleH1Pages.slice(0, 20).map((page) => page.url)
        );
    }

    if (invalidHeadingHierarchyPages.length) {
        addIssue(
            'content',
            'good',
            `${invalidHeadingHierarchyPages.length} page(s) with skipped heading levels`,
            'Skipped heading levels, such as H2 directly to H4, make page structure harder to understand.',
            'Use heading levels sequentially: H1, then H2, then H3. Do not skip levels for styling.',
            `${invalidHeadingHierarchyPages.length} pages with invalid heading hierarchy`,
            'Sequential heading structure',
            invalidHeadingHierarchyPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (pagesWithMissingAltImages.length) {
        addIssue(
            'content',
            'important',
            `${pagesWithMissingAltImages.length} page(s) with image alt text gaps`,
            'Images without alt text reduce accessibility and miss image-search/context signals.',
            'Add descriptive alt text for meaningful images. Use alt="" only for decorative images.',
            `${pagesWithMissingAltImages.length} pages with missing alt text`,
            'All meaningful images should have alt text',
            pagesWithMissingAltImages.slice(0, 20).map((page) => page.url)
        );
    }

    if (pagesWithMissingDimensionImages.length) {
        addIssue(
            'performance',
            'good',
            `${pagesWithMissingDimensionImages.length} page(s) with images missing width/height`,
            'Images without explicit dimensions can contribute to layout shift and slower rendering.',
            'Add width and height attributes or CSS aspect-ratio for responsive images.',
            `${pagesWithMissingDimensionImages.length} pages with images missing dimensions`,
            'Images should reserve layout space',
            pagesWithMissingDimensionImages.slice(0, 20).map((page) => page.url)
        );
    }

    if (thinContentPages.length) {
        addIssue(
            'content',
            'important',
            `${thinContentPages.length} thin content page(s) found`,
            'Pages with very little visible text may struggle to satisfy search intent or rank for meaningful queries.',
            'Add original, useful content that fully answers the page intent. Review boilerplate-heavy pages and merge or improve low-value pages.',
            `${thinContentPages.length} pages under 300 words`,
            'At least 300 words on indexable content pages',
            thinContentPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (mixedContentPages.length) {
        addIssue(
            'security',
            'critical',
            `${mixedContentPages.length} page(s) loading mixed content`,
            'HTTPS pages should not load HTTP resources because browsers may block them and users lose trust.',
            'Update all HTTP image, script, stylesheet, iframe, video, and audio URLs to HTTPS or protocol-relative URLs.',
            `${mixedContentPages.length} HTTPS pages with HTTP resources`,
            'No mixed content on HTTPS pages',
            mixedContentPages.slice(0, 20).map((page) => page.url)
        );
    }

    if (missingSecurityHeadersPages.length) {
        addIssue(
            'security',
            'important',
            `${missingSecurityHeadersPages.length} page(s) missing recommended security headers`,
            'Security headers help protect users and improve browser trust. Missing headers can expose the site to clickjacking, MIME sniffing, and policy gaps.',
            `Add recommended headers: ${Object.keys(missingSecurityHeaderCounts).sort().join(', ') || 'HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy'}.`,
            `Missing headers detected on ${missingSecurityHeadersPages.length} page(s)`,
            'HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy',
            missingSecurityHeadersPages.slice(0, 20).map((page) => page.url)
        );
    }

    // ─── Hreflang Checks ─────────────────────────────────────────────────
    const pagesWithHreflang = htmlPages.filter(p => p.hreflang && p.hreflang.length > 0);
    const hreflangErrors = [];

    for (const page of pagesWithHreflang) {
        // Check for missing self-referencing hreflang
        const hasSelfRef = page.hreflang.some(h => h.href === page.url);
        if (!hasSelfRef) {
            hreflangErrors.push({ url: page.url, issue: 'missing self-referencing hreflang' });
        }

        // Check for missing x-default
        const hasXDefault = page.hreflang.some(h => h.lang === 'x-default');
        if (!hasXDefault) {
            hreflangErrors.push({ url: page.url, issue: 'missing x-default hreflang' });
        }

        // Check for invalid language codes (basic ISO 639-1 check)
        for (const h of page.hreflang) {
            if (h.lang === 'x-default') continue;
            if (!/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(h.lang)) {
                hreflangErrors.push({ url: page.url, issue: `invalid hreflang code: ${h.lang}` });
            }
        }

        // Check bidirectional: hreflang target should link back
        for (const h of page.hreflang) {
            if (!h.href || h.lang === 'x-default') continue;
            const targetPage = pageByUrl.get(cleanUrl(h.href, siteOrigin));
            if (targetPage && targetPage.hreflang) {
                const hasReturnLink = targetPage.hreflang.some(th => th.href === page.url);
                if (!hasReturnLink) {
                    hreflangErrors.push({ url: page.url, issue: `hreflang ${h.lang} target (${h.href}) has no return link` });
                }
            }
        }
    }

    if (hreflangErrors.length) {
        addIssue(
            'indexability',
            'important',
            `${hreflangErrors.length} hreflang issue(s) found`,
            'Hreflang errors cause search engines to ignore your international targeting signals, showing wrong-language pages to users.',
            'Fix hreflang tags: ensure bidirectional links, valid ISO language codes, self-referencing tags, and x-default.',
            `${hreflangErrors.length} hreflang errors`,
            'Valid bidirectional hreflang with self-reference and x-default',
            hreflangErrors.slice(0, 20).map(e => `${e.url} — ${e.issue}`)
        );
    }

    // ─── Pagination Checks ───────────────────────────────────────────────
    const pagesWithPagination = htmlPages.filter(p => p.pagination && (p.pagination.next || p.pagination.prev));
    const paginationErrors = [];

    for (const page of pagesWithPagination) {
        // Check self-referencing canonical on paginated pages
        if (page.pagination.next || page.pagination.prev) {
            if (page.canonicalStatus !== 'self') {
                paginationErrors.push({ url: page.url, issue: 'paginated page should have self-referencing canonical (not pointing to page 1)' });
            }
        }

        // Check next/prev chain continuity
        if (page.pagination.next) {
            const nextPage = pageByUrl.get(cleanUrl(page.pagination.next, siteOrigin));
            if (nextPage && nextPage.pagination.prev) {
                if (cleanUrl(nextPage.pagination.prev, siteOrigin) !== page.url) {
                    paginationErrors.push({ url: page.url, issue: `next page (${page.pagination.next}) does not link back with rel="prev"` });
                }
            }
        }

        // Check that pagination URLs return 200
        if (page.pagination.next) {
            const nextUrl = cleanUrl(page.pagination.next, siteOrigin);
            const nextPage = pageByUrl.get(nextUrl);
            if (nextPage && nextPage.status >= 400) {
                paginationErrors.push({ url: page.url, issue: `rel="next" points to broken URL (${nextUrl})` });
            }
        }
    }

    if (paginationErrors.length) {
        addIssue(
            'architecture',
            'important',
            `${paginationErrors.length} pagination issue(s) found`,
            'Pagination issues confuse crawlers about which page to index and can cause duplicate content or lost ranking signals.',
            'Use self-referencing canonicals on paginated pages. Ensure rel="next"/"prev" chains are complete and bidirectional.',
            `${paginationErrors.length} pagination errors`,
            'Complete rel="next"/"prev" chain with self-referencing canonicals',
            paginationErrors.slice(0, 20).map(e => `${e.url} — ${e.issue}`)
        );
    }

    // ─── Canonical Chain Checks ──────────────────────────────────────────
    const canonicalErrors = [];

    for (const page of htmlPages) {
        if (!page.canonical || page.canonicalStatus === 'missing') continue;

        const canonicalTarget = cleanUrl(page.canonical, siteOrigin);

        // Check: canonical points to a URL that itself has a different canonical (chain)
        const targetPage = pageByUrl.get(canonicalTarget);
        if (targetPage && targetPage.canonical && cleanUrl(targetPage.canonical, siteOrigin) !== canonicalTarget) {
            canonicalErrors.push({
                url: page.url,
                issue: `canonical chain: ${page.url} → ${canonicalTarget} → ${targetPage.canonical}`,
            });
        }

        // Check: canonical points to a broken URL (404/5xx)
        if (targetPage && targetPage.status >= 400) {
            canonicalErrors.push({
                url: page.url,
                issue: `canonical points to broken URL (${canonicalTarget}, status ${targetPage.status})`,
            });
        }

        // Check: canonical protocol mismatch (http vs https)
        if (page.canonical.startsWith('http:') && page.url.startsWith('https:')) {
            canonicalErrors.push({
                url: page.url,
                issue: 'canonical uses HTTP but page is served over HTTPS',
            });
        }

        // Check: canonical www mismatch
        const pageWww = page.url.includes('://www.');
        const canonWww = page.canonical.includes('://www.');
        if (pageWww !== canonWww) {
            canonicalErrors.push({
                url: page.url,
                issue: 'canonical www/non-www mismatch with page URL',
            });
        }
    }

    if (canonicalErrors.length) {
        addIssue(
            'indexability',
            'critical',
            `${canonicalErrors.length} canonical chain / mismatch issue(s)`,
            'Canonical chains and mismatches dilute ranking signals and can cause de-indexation. Each page should canonical to its final, correct, self-referencing URL.',
            'Fix canonical tags so each page points directly to its own final URL. Avoid chains, protocol mismatches, and www inconsistencies.',
            `${canonicalErrors.length} canonical issues`,
            'Each page has a direct self-referencing canonical',
            canonicalErrors.slice(0, 20).map(e => `${e.url} — ${e.issue}`)
        );
    }

    // ─── Structured Data Summary ─────────────────────────────────────────
    const schemaTypes = new Map();
    let pagesWithSchema = 0;
    for (const page of htmlPages) {
        if (page.structuredData && page.structuredData.length > 0) {
            pagesWithSchema++;
            for (const sd of page.structuredData) {
                for (const t of sd.types) {
                    schemaTypes.set(t, (schemaTypes.get(t) || 0) + 1);
                }
            }
        }
    }

    const categories = buildCategoryScores(issues);
    const overall = computeOverallScore(issues);

    return {
        overall,
        categories,
        summary: {
            pagesCrawled: pages.length,
            maxPages,
            htmlPages: htmlPages.filter((page) => page.status === 200).length,
            brokenPages: brokenPages.length,
            redirects: redirectedPages.length,
            noindexPages: noindexPages.length,
            missingCanonicals: missingCanonicalPages.length,
            duplicateTitleClusters: duplicateTitleGroups.length,
            duplicateMetaClusters: duplicateMetaGroups.length,
            deepPages: deepPages.length,
            sitemapCount: sitemaps.length,
            sitemapUrls: sitemapUrls.length,
            orphanSitemapUrls: orphanSitemapUrls.length,
            robotsFound: robotsTxt.found,
            hreflangIssues: hreflangErrors.length,
            paginationIssues: paginationErrors.length,
            canonicalChainIssues: canonicalErrors.length,
            missingH1Pages: missingH1Pages.length,
            multipleH1Pages: multipleH1Pages.length,
            invalidHeadingHierarchyPages: invalidHeadingHierarchyPages.length,
            imagesMissingAlt: htmlPages.filter((page) => page.status === 200).reduce((sum, page) => sum + (page.imagesMissingAlt || 0), 0),
            imagesMissingDimensions: htmlPages.filter((page) => page.status === 200).reduce((sum, page) => sum + (page.imagesMissingDimensions || 0), 0),
            thinContentPages: thinContentPages.length,
            mixedContentPages: mixedContentPages.length,
            missingSecurityHeadersPages: missingSecurityHeadersPages.length,
            missingSecurityHeaderCounts,
            pagesWithSchema,
            schemaTypes: Object.fromEntries(schemaTypes),
        },
        issues,
        pages: pages.map((page) => ({
            url: page.url,
            status: page.status,
            statusLabel: page.statusLabel,
            depth: page.depth,
            title: page.title,
            canonical: page.canonical,
            robotsMeta: page.robotsMeta,
            inboundLinks: page.inboundLinks,
            internalLinks: page.internalLinks,
            externalLinks: page.externalLinks,
            loadMs: page.loadMs,
            issues: page.issues,
            redirectTo: page.redirectTo || '',
            canonicalStatus: page.canonicalStatus,
            hreflang: page.hreflang || [],
            pagination: page.pagination || {},
            structuredData: (page.structuredData || []).flatMap(sd => sd.types),
            h1Count: page.h1Count || 0,
            h2Count: page.h2Count || 0,
            headingHierarchyValid: page.headingHierarchyValid,
            headings: (page.headings || []).slice(0, 12),
            imageCount: page.imageCount || 0,
            imagesMissingAlt: page.imagesMissingAlt || 0,
            imagesMissingDimensions: page.imagesMissingDimensions || 0,
            wordCount: page.wordCount || 0,
            hasMixedContent: page.hasMixedContent || false,
            mixedContentCount: (page.mixedContent || []).length,
            missingSecurityHeaders: page.missingSecurityHeaders || [],
        })),
    };
}

async function fetchRobotsTxt(baseUrl) {
    const robotsUrl = `${baseUrl.origin}/robots.txt`;

    try {
        const response = await fetchUrl(robotsUrl, { maxRedirects: 3, timeout: 12000 });
        const body = typeof response.data === 'string' ? response.data : String(response.data || '');
        const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const sitemapUrls = lines
            .filter((line) => /^sitemap:/i.test(line))
            .map((line) => line.split(':').slice(1).join(':').trim())
            .map((url) => absolutizeUrl(url, robotsUrl))
            .filter(Boolean);
        const disallowAll = /user-agent:\s*\*([\s\S]*?)disallow:\s*\//i.test(body);

        return {
            url: robotsUrl,
            found: response.status === 200,
            status: response.status,
            disallowAll,
            sitemaps: uniqueUrls(sitemapUrls),
            preview: lines.slice(0, 12),
        };
    } catch (err) {
        log.warn({ url: robotsUrl, err: err.message }, 'robots.txt fetch failed');
        return {
            url: robotsUrl,
            found: false,
            status: 0,
            disallowAll: false,
            sitemaps: [],
            preview: [],
        };
    }
}

async function discoverSitemaps(baseUrl, robotsTxt) {
    const candidates = uniqueUrls([
        ...(robotsTxt.sitemaps || []),
        `${baseUrl.origin}/sitemap.xml`,
        `${baseUrl.origin}/sitemap_index.xml`,
    ]);
    const results = [];

    for (const sitemapUrl of candidates) {
        try {
            const response = await fetchUrl(sitemapUrl, { maxRedirects: 2, timeout: 15000 });
            if (response.status >= 400) {
                continue;
            }

            const xml = typeof response.data === 'string' ? response.data : String(response.data || '');
            const urls = extractXmlLocs(xml)
                .filter((entry) => isInternalUrl(entry, baseUrl.origin))
                .slice(0, MAX_SITEMAP_URLS);

            results.push({
                url: sitemapUrl,
                status: response.status,
                urlCount: urls.length,
                urls,
            });
        } catch (err) {
            log.warn({ url: sitemapUrl, err: err.message }, 'sitemap fetch failed');
        }
    }

    return results;
}

async function fetchUrl(url, options = {}) {
    const safeUrl = await assertSafeHttpUrl(url);
    return axios.get(safeUrl.href, {
        headers: {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: options.timeout || 20000,
        // Redirects are deliberately disabled so every outbound URL is validated.
        maxRedirects: 0,
        maxContentLength: 5 * 1024 * 1024,
        maxBodyLength: 5 * 1024 * 1024,
        validateStatus: (status) => status < 600,
        responseType: 'text',
    });
}

function buildCategoryScores(issues) {
    const weights = {
        crawlability: 30,
        indexability: 35,
        sitemaps: 15,
        architecture: 20,
        content: 20,
        performance: 15,
        security: 15,
    };
    const categories = {};

    Object.keys(weights).forEach((category) => {
        const catIssues = issues.filter((issue) => issue.category === category);
        const critical = catIssues.filter((issue) => issue.severity === 'critical').length;
        const important = catIssues.filter((issue) => issue.severity === 'important').length;
        const good = catIssues.filter((issue) => issue.severity === 'good').length;
        const score = Math.max(0, 100 - (critical * 25 + important * 10 + good * 4));
        categories[category] = { score, critical, important, good, issues: catIssues };
    });

    return categories;
}

function computeOverallScore(issues) {
    const penalty = issues.reduce((sum, issue) => {
        if (issue.severity === 'critical') return sum + 12;
        if (issue.severity === 'important') return sum + 5;
        return sum + 2;
    }, 0);

    return Math.max(0, 100 - penalty);
}

function getDuplicateGroups(bucket) {
    return [...bucket.entries()]
        .filter(([value, urls]) => value && urls.length > 1)
        .map(([value, urls]) => ({ value, urls }));
}

function flattenGroups(groups, limit) {
    return groups.flatMap((group) => group.urls).slice(0, limit);
}

function getCanonicalStatus(pageUrl, canonicalUrl, siteOrigin) {
    if (!canonicalUrl) {
        return 'missing';
    }
    if (!isInternalUrl(canonicalUrl, siteOrigin)) {
        return 'cross-domain';
    }
    return cleanUrl(canonicalUrl, siteOrigin) === cleanUrl(pageUrl, siteOrigin) ? 'self' : 'other-internal';
}

function validateHeadingHierarchy(headings) {
    if (headings.length === 0) return true;
    const levels = headings.map(h => parseInt(h.tag.replace('H', ''), 10));
    let prevLevel = levels[0];
    if (prevLevel !== 1) return false;
    for (let i = 1; i < levels.length; i++) {
        const curr = levels[i];
        if (curr > prevLevel + 1) return false;
        prevLevel = curr;
    }
    return true;
}

function getStatusLabel(status) {
    if (!status) return 'Failed';
    if (status >= 200 && status < 300) return 'OK';
    if (status >= 300 && status < 400) return 'Redirect';
    if (status >= 400 && status < 500) return 'Client error';
    if (status >= 500) return 'Server error';
    return 'Unknown';
}

function normalizeSiteUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) {
        throw new Error('Enter a site URL to audit.');
    }
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(withProtocol);
    return cleanUrl(parsed.toString(), parsed.origin);
}

function normalizeText(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractXmlLocs(xml) {
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/gi)]
        .map((match) => decodeXml(match[1]))
        .filter(Boolean);
}

function decodeXml(value) {
    return String(value || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function pushMapValue(map, key, value) {
    if (!key) {
        return;
    }
    const list = map.get(key) || [];
    if (!list.includes(value)) {
        list.push(value);
    }
    map.set(key, list);
}

function uniqueCount(values) {
    return new Set(values).size;
}

function uniqueUrls(values, siteOrigin) {
    return [...new Set(values.map((value) => (siteOrigin ? cleanUrl(value, siteOrigin) : value)).filter(Boolean))];
}

function isInternalUrl(candidate, siteOrigin) {
    try {
        return new URL(candidate).origin === siteOrigin;
    } catch {
        return false;
    }
}

function cleanUrl(value, siteOrigin) {
    try {
        const url = new URL(value, siteOrigin);
        url.hash = '';
        if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) {
            url.port = '';
        }
        const normalizedPath = url.pathname.replace(/\/$/, '') || '/';
        url.pathname = normalizedPath === '' ? '/' : normalizedPath;
        return url.toString().replace(/\/$/, url.pathname === '/' ? '/' : '');
    } catch {
        return '';
    }
}

function absolutizeUrl(value, base) {
    try {
        const trimmed = String(value || '').trim();
        if (!trimmed || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
            return '';
        }
        return new URL(trimmed, base).toString();
    } catch {
        return '';
    }
}

function clampNumber(value, min, max, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(parsed)));
}

module.exports = {
    auditSite,
};
