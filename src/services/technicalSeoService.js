const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const { createLogger } = require('../utils/logger');

const log = createLogger('services:technical-seo');
const MAX_SITEMAP_URLS = 250;
const DEFAULT_MAX_PAGES = 20;
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

async function auditSite(siteUrl, options = {}) {
    const normalizedUrl = normalizeSiteUrl(siteUrl);
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
            const page = await crawlPage(next.url, next.depth, next.source, siteOrigin);
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
        crawlConfig: { maxPages },
        analyzedAt: new Date().toISOString(),
    };
}

async function crawlPage(url, depth, source, siteOrigin) {
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
    return axios.get(url, {
        headers: {
            'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        timeout: options.timeout || 20000,
        maxRedirects: typeof options.maxRedirects === 'number' ? options.maxRedirects : 5,
        validateStatus: (status) => status < 600,
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        responseType: 'text',
    });
}

function buildCategoryScores(issues) {
    const weights = {
        crawlability: 30,
        indexability: 35,
        sitemaps: 15,
        architecture: 20,
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
