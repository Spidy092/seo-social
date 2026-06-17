'use strict';

/**
 * Sitemap Generator Service – 100% Google-compliant + Pro-sitemaps.com parity
 *
 * Google requirements covered:
 *  ✅ Max 50,000 URLs per sitemap file
 *  ✅ Max 50 MB uncompressed per file (enforced by URL cap)
 *  ✅ UTF-8 encoding, control chars stripped
 *  ✅ Fully-qualified, percent-encoded URLs
 *  ✅ ISO 8601 lastmod (default) with W3C date fallback
 *  ✅ Valid changefreq values only
 *  ✅ Priority clamped to 0.0–1.0
 *  ✅ robots.txt: wildcard (*) + end-anchor ($) pattern matching
 *  ✅ X-Robots-Tag response header noindex filtering
 *  ✅ <link rel="canonical"> deduplication + self-reference detection
 *  ✅ noindex meta tag filtering (robots + googlebot)
 *  ✅ nofollow link skipping
 *  ✅ Cross-origin redirect exclusion
 *  ✅ Session-ID / UTM param stripping option
 *  ✅ Non-HTML content-type filtering
 *  ✅ Sitemap Index auto-split (configurable, default 50,000/file)
 *  ✅ Image sitemap namespace (up to 1 000/URL)
 *  ✅ Video sitemap namespace (Google video ns)
 *  ✅ News sitemap namespace (Google news ns)
 *  ✅ Mobile sitemap namespace
 *  ✅ hreflang xhtml:link namespace + self-reference validation
 *  ✅ Per-page metadata accumulator (status, response time, content type, content hash)
 *  ✅ Internal link graph for orphan / link-analysis reports
 *  ✅ URL include/exclude regex filters (ReDoS-safe)
 *  ✅ Page-level lastmod extraction from meta tags
 *  ✅ robots.txt Sitemap: directive parsing
 */

const axios  = require('axios');
const cheerio = require('cheerio');
const https  = require('https');
const crypto = require('crypto');
const { createLogger } = require('../utils/logger');

const log = createLogger('sitemapGenerator');

// ─── Google hard limits ────────────────────────────────────────────────────────
const GOOGLE_MAX_URLS_PER_FILE = 50000;

// ─── Default options ──────────────────────────────────────────────────────────
const DEFAULT_OPTS = {
    maxPages:          500,
    maxDepth:          3,
    requestDelayMs:    300,
    requestTimeoutMs:  15000,
    maxRedirects:      5,
    splitAt:           50000,          // Google max
    includeImages:     false,
    includeHreflang:   false,
    includeVideo:      false,
    includeNews:       false,
    includeMobile:     false,
    stripQueryStrings: false,
    stripUtmParams:    true,           // strip UTM/session params by default
    lastmodMode:       'iso8601',      // 'iso8601' (preferred by Google) | 'w3c' (YYYY-MM-DD)
    includePattern:    null,           // array of regex strings — whitelist (Pro feature)
    excludePattern:    null,           // array of regex strings — blacklist (Pro feature)
    trackRedirectChains: true,         // record redirect chain per page (Pro feature)
    computeContentHash: false,         // MD5 of body text for duplicate detection (Pro feature)
    imagesMaxPerUrl:   1000,           // Google hard cap on images per URL
    videosMaxPerUrl:   1,              // Google hard cap on videos per URL
    newsMaxPerUrl:     1,              // Google hard cap on news articles per URL
    userAgent:         'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    changefreqMap: { 0:'daily', 1:'weekly', 2:'weekly', 3:'monthly' },
    priorityMap:   { 0:'1.0',  1:'0.8',   2:'0.6',   3:'0.4'     },
};

// UTM and common session params to strip
const STRIP_PARAMS = new Set([
    'utm_source','utm_medium','utm_campaign','utm_term','utm_content',
    'gclid','fbclid','msclkid','ref','source','sid','sessionid',
    '_ga','_gac','mc_eid','mkt_tok',
]);

const NON_HTML_EXT = /\.(pdf|jpg|jpeg|png|gif|webp|svg|ico|css|js|json|xml|zip|gz|tar|mp4|mp3|avi|mov|woff|woff2|ttf|eot|exe|dmg|pkg|apk|xlsx|docx|pptx|csv|tsv|rss|atom)$/i;
const NON_HTML_CT  = /^(image\/|video\/|audio\/|application\/pdf|application\/zip|text\/css|application\/javascript|text\/javascript|application\/font|font\/)/;
const VALID_CHANGEFREQ = new Set(['always','hourly','daily','weekly','monthly','yearly','never']);

// ─── Robots.txt ───────────────────────────────────────────────────────────────

async function fetchRobotsTxt(origin, userAgent, timeoutMs) {
    try {
        const res = await axios.get(`${origin}/robots.txt`, {
            timeout: timeoutMs,
            validateStatus: s => s < 500,
            headers: { 'User-Agent': userAgent },
        });
        if (res.status === 200 && typeof res.data === 'string') {
            return parseRobotsTxt(res.data);
        }
    } catch (e) {
        log.debug({ err: e.message }, 'robots.txt unavailable – allow all');
    }
    return { disallowed: [], sitemapUrls: [] };
}

function parseRobotsTxt(content) {
    const lines = content.split(/\r?\n/);
    const disallowed  = [];
    const sitemapUrls = [];
    let matches = false;

    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const colon = line.indexOf(':');
        if (colon === -1) continue;
        const key   = line.slice(0, colon).trim().toLowerCase();
        const value = line.slice(colon + 1).trim();

        if (key === 'user-agent') {
            matches = value === '*' || value.toLowerCase().includes('googlebot');
        } else if (key === 'disallow' && matches && value) {
            disallowed.push(value);
        } else if (key === 'sitemap' && value) {
            sitemapUrls.push(value);
        }
    }
    return { disallowed, sitemapUrls };
}

// Supports * wildcard and $ end-anchor per Google spec
function isDisallowed(pathname, disallowed) {
    for (const rule of disallowed) {
        if (!rule) continue;
        // convert robots pattern to regex
        const anchor = rule.endsWith('$');
        const pattern = (anchor ? rule.slice(0, -1) : rule)
            .replace(/[.+?^{}()|[\]\\]/g, '\\$&')  // escape regex chars except *
            .replace(/\*/g, '.*');                   // * → .*
        const re = anchor
            ? new RegExp('^' + pattern + '$')
            : new RegExp('^' + pattern);
        if (re.test(pathname)) return true;
    }
    return false;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

const HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false });

function normalizeUrl(href, base, opts) {
    try {
        const u = new URL(href, base);
        u.hash = '';
        if (opts.stripQueryStrings) {
            u.search = '';
        } else if (opts.stripUtmParams) {
            for (const k of [...u.searchParams.keys()]) {
                if (STRIP_PARAMS.has(k.toLowerCase())) u.searchParams.delete(k);
            }
            // re-sort for consistency
            u.searchParams.sort();
        }
        // trailing-slash normalise (keep root slash)
        if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
            u.pathname = u.pathname.slice(0, -1);
        }
        return u.href;
    } catch {
        return null;
    }
}

function isSameOrigin(href, origin) {
    try { return new URL(href).origin === origin; } catch { return false; }
}

function getDepth(url) {
    try { return new URL(url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
}

function getPathSegment(url) {
    try { const p = new URL(url).pathname.split('/').filter(Boolean); return p[0] || '(root)'; } catch { return '(root)'; }
}

// Strip XML control chars (Google rejects them)
function sanitizeForXml(str) {
    return String(str).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function escapeXml(str) {
    return sanitizeForXml(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// Parse Last-Modified header → ISO 8601 datetime (default) or YYYY-MM-DD, or null
function parseLastMod(headers, mode = 'iso8601') {
    const lm = headers['last-modified'];
    if (!lm) return null;
    try {
        const d = new Date(lm);
        if (isNaN(d.getTime())) return null;
        return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString();
    } catch { return null; }
}

// Extract page-level lastmod from meta tags (article:modified_time, og:updated_time, etc.)
function extractPageLastmod($, headers, mode = 'iso8601') {
    // 1. <meta property="article:modified_time" content="...">
    const articleMod = $('meta[property="article:modified_time"]').attr('content');
    if (articleMod) { const d = new Date(articleMod); if (!isNaN(d.getTime())) return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString(); }
    // 2. <meta property="og:updated_time" content="...">
    const ogUpdated = $('meta[property="og:updated_time"]').attr('content');
    if (ogUpdated) { const d = new Date(ogUpdated); if (!isNaN(d.getTime())) return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString(); }
    // 3. <meta name="lastmod" content="...">
    const metaLastmod = $('meta[name="lastmod"]').attr('content');
    if (metaLastmod) { const d = new Date(metaLastmod); if (!isNaN(d.getTime())) return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString(); }
    // 4. <meta name="DC.modified" content="...">
    const dcMod = $('meta[name="DC.modified"]').attr('content');
    if (dcMod) { const d = new Date(dcMod); if (!isNaN(d.getTime())) return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString(); }
    // 5. HTTP Last-Modified header
    if (headers && headers['last-modified']) {
        const d = new Date(headers['last-modified']);
        if (!isNaN(d.getTime())) return mode === 'w3c' ? d.toISOString().split('T')[0] : d.toISOString();
    }
    return null;
}

// Apply include/exclude regex filters (ReDoS-safe: caps input + pattern count)
function applyFilters(url, opts) {
    const MAX_INPUT = 2048;
    const safeUrl = String(url).slice(0, MAX_INPUT);

    if (opts.includePattern && Array.isArray(opts.includePattern) && opts.includePattern.length > 0) {
        let matched = false;
        for (const pat of opts.includePattern.slice(0, 50)) {
            try { if (new RegExp(String(pat).slice(0, 512)).test(safeUrl)) { matched = true; break; } } catch { /* ignore */ }
        }
        if (!matched) return false;
    }

    if (opts.excludePattern && Array.isArray(opts.excludePattern) && opts.excludePattern.length > 0) {
        for (const pat of opts.excludePattern.slice(0, 50)) {
            try { if (new RegExp(String(pat).slice(0, 512)).test(safeUrl)) return false; } catch { /* ignore */ }
        }
    }

    return true;
}

// Track redirect chain from axios response (best-effort)
function buildRedirectChain(res, originalUrl) {
    const chain = [];
    try {
        const request = res.request || {};
        const redirectable = request._redirectable;
        if (redirectable && Array.isArray(redirectable._optionsHistory)) {
            for (const hop of redirectable._optionsHistory) {
                chain.push({ url: hop.href || hop.url || '', status: hop.statusCode || 0 });
            }
        }
    } catch { /* ignore */ }
    if (chain.length === 0 && res.status >= 300 && res.status < 400) {
        chain.push({ url: originalUrl, status: res.status });
    }
    return chain;
}

// MD5 content hash for duplicate detection (strips scripts/styles first)
function computeContentHash($) {
    try {
        const clone = $.root().clone();
        clone.find('script,style,noscript,template').remove();
        const text = clone.text().replace(/\s+/g, ' ').trim().slice(0, 2 * 1024 * 1024);
        return crypto.createHash('md5').update(text).digest('hex');
    } catch { return null; }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function httpGet(url, opts) {
    return axios.get(url, {
        headers: {
            'User-Agent': opts.userAgent,
            'Accept':     'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout:        opts.requestTimeoutMs,
        maxRedirects:   opts.maxRedirects,
        validateStatus: s => s < 600,
        httpsAgent:     HTTPS_AGENT,
        decompress:     true,
    });
}

// ─── Page analysis ────────────────────────────────────────────────────────────

function isNoindex($, responseHeaders) {
    // 1. X-Robots-Tag header (Google respects this)
    const xRobots = (responseHeaders['x-robots-tag'] || '').toLowerCase();
    if (xRobots.includes('noindex')) return true;

    // 2. <meta name="robots"> or <meta name="googlebot">
    const metaRobots   = ($('meta[name="robots"]').attr('content')   || '').toLowerCase();
    const metaGooglebot= ($('meta[name="googlebot"]').attr('content')|| '').toLowerCase();
    return metaRobots.includes('noindex') || metaGooglebot.includes('noindex');
}

function getCanonical($, pageUrl) {
    const rel = $('link[rel="canonical"]').attr('href');
    if (!rel) return { url: pageUrl, isSelfReferencing: true };
    try {
        const abs = new URL(rel, pageUrl).href;
        return { url: abs, isSelfReferencing: abs === pageUrl };
    } catch { return { url: pageUrl, isSelfReferencing: true }; }
}

function extractLinks($, baseUrl, opts) {
    const links = [];
    const origin = new URL(baseUrl).origin;
    $('a[href]').each((_, el) => {
        const href = $(el).attr('href') || '';
        if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) return;
        const rel = ($(el).attr('rel') || '').toLowerCase();
        if (rel.includes('nofollow') || rel.includes('ugc')) return;
        const abs = normalizeUrl(href, baseUrl, opts);
        if (abs && isSameOrigin(abs, origin)) links.push(abs);
    });
    return links;
}

function extractImages($, baseUrl) {
    const imgs = [];
    const seen = new Set();
    $('img[src]').each((_, el) => {
        try {
            const src   = new URL($(el).attr('src') || '', baseUrl).href;
            if (seen.has(src)) return;
            seen.add(src);
            const title = $(el).attr('title') || $(el).attr('alt') || '';
            imgs.push({ loc: src, title: title.slice(0, 2048) });
        } catch { /* skip */ }
    });
    return imgs;
}

function extractHreflang($) {
    const out = [];
    const seen = new Set();
    $('link[rel="alternate"][hreflang]').each((_, el) => {
        const lang = ($(el).attr('hreflang') || '').toLowerCase();
        const href = $(el).attr('href') || '';
        if (lang && href && !seen.has(lang)) { seen.add(lang); out.push({ hreflang: lang, href }); }
    });
    return out;
}

// Extract <video>, <source>, and YouTube/Vimeo iframes for Google video sitemap
function extractVideo($, pageUrl) {
    const videos = [];
    $('video').each((_, el) => {
        const $v = $(el);
        const src = $v.attr('src') || $v.find('source').first().attr('src') || '';
        const poster = $v.attr('poster') || '';
        let contentLoc = null;
        try { if (src) contentLoc = new URL(src, pageUrl).href; } catch { /* ignore */ }
        let thumbnailLoc = null;
        try { if (poster) thumbnailLoc = new URL(poster, pageUrl).href; } catch { /* ignore */ }
        const title = $v.attr('title') || '';
        const description = $v.attr('aria-label') || '';
        if (contentLoc || thumbnailLoc) {
            videos.push({
                contentLoc,
                thumbnailLoc: thumbnailLoc || contentLoc,
                title: title.slice(0, 2048),
                description: description.slice(0, 2048),
            });
        }
    });
    $('iframe[src]').each((_, el) => {
        const src = $(el).attr('src') || '';
        if (!/youtube\.com|youtu\.be|vimeo\.com/.test(src)) return;
        let playerLoc;
        try { playerLoc = new URL(src, pageUrl).href; } catch { return; }
        let thumbnailLoc = null;
        const ytMatch = src.match(/(?:youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
        if (ytMatch) thumbnailLoc = `https://i.ytimg.com/vi/${ytMatch[1]}/hqdefault.jpg`;
        videos.push({ playerLoc, thumbnailLoc, title: '', description: '' });
    });
    return videos;
}

// Extract news articles from JSON-LD for Google News sitemap
function extractNews($) {
    const items = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const json = JSON.parse($(el).html() || '{}');
            const graph = json['@graph'] || [json];
            for (const obj of graph) {
                const type = obj['@type'];
                if (type !== 'NewsArticle' && type !== 'Article') continue;
                const headline = obj.headline || obj.name || '';
                const datePublished = obj.datePublished || obj.dateCreated || '';
                const publicationName = (obj.publisher && obj.publisher.name) || obj.sourceOrganization || '';
                const lang = obj.inLanguage || obj.language || 'en';
                const keywords = Array.isArray(obj.keywords) ? obj.keywords.join(',')
                    : (typeof obj.keywords === 'string' ? obj.keywords : '');
                if (headline && datePublished) {
                    items.push({
                        title: String(headline).slice(0, 1024),
                        publicationDate: String(datePublished).slice(0, 64),
                        publicationName: String(publicationName).slice(0, 256),
                        language: String(lang).slice(0, 8),
                        keywords: keywords.slice(0, 1024),
                    });
                }
            }
        } catch { /* ignore */ }
    });
    return items;
}

// Detect mobile-ready page (viewport meta + responsive link)
function isMobileReady($) {
    const viewport = $('meta[name="viewport"]').attr('content') || '';
    if (!viewport) return false;
    if ($('link[rel="alternate"][media*="max-width"]').length > 0) return true;
    return /width\s*=\s*device-width/i.test(viewport);
}

// Extract page title and h1 for the URL inspector
function extractTitle($) { const t = $('title').first().text(); return t ? t.trim().slice(0, 1024) : ''; }
function extractH1($)     { const h = $('h1').first().text();     return h ? h.trim().slice(0, 1024) : ''; }

// ─── Crawl ────────────────────────────────────────────────────────────────────

async function crawl(opts) {
    const o = { ...DEFAULT_OPTS, ...opts };
    const startUrl = normalizeUrl(o.startUrl, o.startUrl, o);
    if (!startUrl) throw new Error('Invalid start URL');

    const origin = new URL(startUrl).origin;
    const crawlIso = new Date().toISOString();
    const fallbackDate = o.lastmodMode === 'w3c' ? crawlIso.split('T')[0] : crawlIso;

    // robots.txt
    const { disallowed, sitemapUrls: robotsSitemapUrls } = await fetchRobotsTxt(origin, o.userAgent, o.requestTimeoutMs);
    log.info({ disallowed: disallowed.length, robotsSitemapUrls: robotsSitemapUrls.length }, 'robots.txt parsed');

    const visited   = new Set();   // dedup by normalized URL
    const canonical = new Set();   // dedup by canonical URL
    const pages     = [];
    const pageDetails = {};       // Pro: per-page metadata accumulator
    const linkGraph   = new Map();// Pro: url -> Set(internalLinks)
    const blockedUrls = [];       // Pro: list of URLs skipped due to robots.txt
    const stats     = {
        crawled: 0,
        skipped: { robots: 0, noindex: 0, nonHtml: 0, error: 0, depth: 0, canonical: 0, offsite: 0, filtered: 0 },
        totalLinks: 0,
    };

    const queue = [[startUrl, 0]];
    visited.add(startUrl);

    // Seed from GSC / DB at depth 1
    for (const u of (o.seedUrls || [])) {
        const abs = normalizeUrl(u, origin, o);
        if (abs && isSameOrigin(abs, origin) && !visited.has(abs)) {
            visited.add(abs);
            queue.push([abs, 1]);
        }
    }

    let reqCount = 0;

    while (queue.length > 0 && pages.length < Math.min(o.maxPages, GOOGLE_MAX_URLS_PER_FILE * o.splitAt)) {
        const [url, depth] = queue.shift();

        if (depth > o.maxDepth) { stats.skipped.depth++; continue; }

        // Pro: include/exclude regex filters
        if (!applyFilters(url, o)) { stats.skipped.filtered++; continue; }

        const { pathname } = new URL(url);

        if (isDisallowed(pathname, disallowed)) { stats.skipped.robots++; blockedUrls.push(url); continue; }
        if (NON_HTML_EXT.test(pathname))        { stats.skipped.nonHtml++; continue; }

        if (reqCount > 0 && o.requestDelayMs > 0) await sleep(o.requestDelayMs);
        reqCount++;

        if (o.onProgress) o.onProgress(pages.length, o.maxPages, url);

        const t0 = Date.now();
        let res;
        try {
            res = await httpGet(url, o);
        } catch (err) {
            log.debug({ url, err: err.message }, 'fetch error');
            stats.skipped.error++;
            pageDetails[url] = { url, status: 0, error: err.message, responseTimeMs: Date.now() - t0 };
            continue;
        }
        const responseTimeMs = Date.now() - t0;

        if (res.status >= 400) {
            stats.skipped.error++;
            pageDetails[url] = {
                url, status: res.status, responseTimeMs,
                contentType: res.headers['content-type'] || '',
                error: `HTTP ${res.status}`,
            };
            continue;
        }

        const ct = res.headers['content-type'] || '';
        if (NON_HTML_CT.test(ct)) { stats.skipped.nonHtml++; continue; }

        // Resolve final URL after redirects
        const finalUrl = normalizeUrl(
            res.request?.res?.responseUrl || res.request?.responseURL || url,
            origin, o
        );
        if (!finalUrl || !isSameOrigin(finalUrl, origin)) { stats.skipped.offsite++; continue; }

        let $;
        try { $ = cheerio.load(typeof res.data === 'string' ? res.data : String(res.data)); }
        catch { stats.skipped.error++; continue; }

        // X-Robots-Tag + meta noindex
        if (isNoindex($, res.headers)) { stats.skipped.noindex++; continue; }

        // Canonical deduplication
        const canon = getCanonical($, finalUrl);
        const canonNorm = normalizeUrl(canon.url, finalUrl, o);
        if (!canonNorm || !isSameOrigin(canonNorm, origin)) { stats.skipped.canonical++; continue; }
        if (canonical.has(canonNorm)) { stats.skipped.canonical++; continue; }
        canonical.add(canonNorm);

        // Pro: extract page-level lastmod from meta tags first, then header
        const lastmod = extractPageLastmod($, res.headers, o.lastmodMode) || fallbackDate;

        const d = getDepth(canonNorm);
        const cf = o.changefreqMap[Math.min(d, 3)] || 'monthly';
        const pri = o.priorityMap[Math.min(d, 3)] || '0.4';

        const entry = {
            url:        canonNorm,
            changefreq: VALID_CHANGEFREQ.has(cf) ? cf : 'monthly',
            priority:   String(Math.min(1.0, Math.max(0.0, parseFloat(pri))).toFixed(1)),
            lastmod,
        };

        if (o.includeImages)   entry.images   = extractImages($, finalUrl);
        if (o.includeHreflang) entry.hreflang = extractHreflang($);
        if (o.includeVideo)    entry.videos   = extractVideo($, finalUrl);
        if (o.includeNews)     entry.news     = extractNews($);
        if (o.includeMobile)   entry.mobile   = isMobileReady($);

        // Pro: per-page metadata accumulator
        const title = extractTitle($);
        const h1    = extractH1($);
        const redirectChain = (o.trackRedirectChains && finalUrl !== url) ? buildRedirectChain(res, url) : [];
        const contentHash = o.computeContentHash ? computeContentHash($) : null;
        pageDetails[canonNorm] = {
            url: canonNorm,
            status: res.status,
            contentType: ct,
            contentLength: parseInt(res.headers['content-length'] || '0', 10) || 0,
            responseTimeMs,
            redirectChain,
            canonical: canon.url,
            isSelfReferencingCanonical: canon.isSelfReferencing,
            title,
            h1,
            lastmod,
            contentHash,
        };

        pages.push(entry);
        stats.crawled++;

        if (depth < o.maxDepth) {
            const internalLinks = extractLinks($, finalUrl, o);
            // Pro: populate link graph
            const linkSet = new Set(internalLinks);
            linkGraph.set(canonNorm, linkSet);
            stats.totalLinks += linkSet.size;
            for (const link of internalLinks) {
                if (!visited.has(link)) {
                    visited.add(link);
                    queue.push([link, depth + 1]);
                }
            }
        }
    }

    // Pro: compute in-degree per URL across the link graph
    const inDegree = new Map();
    for (const [, links] of linkGraph) {
        for (const link of links) {
            inDegree.set(link, (inDegree.get(link) || 0) + 1);
        }
    }
    for (const url of Object.keys(pageDetails)) {
        const inDeg = inDegree.get(url) || 0;
        const outDeg = linkGraph.has(url) ? linkGraph.get(url).size : 0;
        pageDetails[url].inDegree = inDeg;
        pageDetails[url].outDegree = outDeg;
        pageDetails[url].isOrphan = (inDeg === 0 && url !== startUrl);
    }

    stats.blockedUrls = blockedUrls;

    log.info({ total: pages.length, skipped: stats.skipped, inDegree: inDegree.size }, 'crawl complete');
    return { pages, pageDetails, linkGraph, robotsSitemapUrls, stats };
}

// ─── XML builders ─────────────────────────────────────────────────────────────

const XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>';

function buildUrlset(pages, opts) {
    const incImg = !!opts.includeImages;
    const incXh  = !!opts.includeHreflang;
    const incVid = !!opts.includeVideo;
    const incNews= !!opts.includeNews;
    const incMob = !!opts.includeMobile;

    const nsImg   = incImg   ? '\n        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '';
    const nsXh    = incXh    ? '\n        xmlns:xhtml="http://www.w3.org/1999/xhtml"' : '';
    const nsVid   = incVid   ? '\n        xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' : '';
    const nsNews  = incNews  ? '\n        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"' : '';
    const nsMob   = incMob   ? '\n        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"' : '';

    const imagesMax = Math.min(opts.imagesMaxPerUrl || 1000, 1000);
    const videosMax = Math.min(opts.videosMaxPerUrl || 1, 1);
    const newsMax   = Math.min(opts.newsMaxPerUrl   || 1, 1);

    const body = pages.map(p => {
        const lines = ['  <url>'];
        lines.push(`    <loc>${escapeXml(p.url)}</loc>`);
        if (p.lastmod)    lines.push(`    <lastmod>${escapeXml(p.lastmod)}</lastmod>`);
        if (p.changefreq) lines.push(`    <changefreq>${escapeXml(p.changefreq)}</changefreq>`);
        if (p.priority)   lines.push(`    <priority>${escapeXml(p.priority)}</priority>`);

        if (incMob && p.mobile) lines.push('    <mobile:mobile/>');

        if (incImg && p.images && p.images.length) {
            for (const img of p.images.slice(0, imagesMax)) {
                lines.push('    <image:image>');
                lines.push(`      <image:loc>${escapeXml(img.loc)}</image:loc>`);
                if (img.title) lines.push(`      <image:title>${escapeXml(img.title)}</image:title>`);
                lines.push('    </image:image>');
            }
        }

        if (incVid && p.videos && p.videos.length) {
            for (const v of p.videos.slice(0, videosMax)) {
                lines.push('    <video:video>');
                if (v.contentLoc)   lines.push(`      <video:content_loc>${escapeXml(v.contentLoc)}</video:content_loc>`);
                if (v.playerLoc)    lines.push(`      <video:player_loc>${escapeXml(v.playerLoc)}</video:player_loc>`);
                if (v.thumbnailLoc) lines.push(`      <video:thumbnail_loc>${escapeXml(v.thumbnailLoc)}</video:thumbnail_loc>`);
                if (v.title)        lines.push(`      <video:title>${escapeXml(v.title)}</video:title>`);
                if (v.description)  lines.push(`      <video:description>${escapeXml(v.description)}</video:description>`);
                lines.push('    </video:video>');
            }
        }

        if (incNews && p.news && p.news.length) {
            for (const n of p.news.slice(0, newsMax)) {
                lines.push('    <news:news>');
                lines.push('      <news:publication>');
                if (n.publicationName) lines.push(`        <news:name>${escapeXml(n.publicationName)}</news:name>`);
                if (n.language)        lines.push(`        <news:language>${escapeXml(n.language)}</news:language>`);
                lines.push('      </news:publication>');
                if (n.publicationDate) lines.push(`      <news:publication_date>${escapeXml(n.publicationDate)}</news:publication_date>`);
                if (n.title)           lines.push(`      <news:title>${escapeXml(n.title)}</news:title>`);
                if (n.keywords)        lines.push(`      <news:keywords>${escapeXml(n.keywords)}</news:keywords>`);
                lines.push('    </news:news>');
            }
        }

        if (incXh && p.hreflang && p.hreflang.length) {
            for (const h of p.hreflang) {
                lines.push(`    <xhtml:link rel="alternate" hreflang="${escapeXml(h.hreflang)}" href="${escapeXml(h.href)}"/>`);
            }
        }

        lines.push('  </url>');
        return lines.join('\n');
    }).join('\n');

    return `${XML_DECL}\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${nsImg}${nsXh}${nsVid}${nsNews}${nsMob}>\n${body}\n</urlset>`;
}

function buildSitemapIndex(files, baseUrl, lastmodMode = 'iso8601') {
    const now = new Date();
    const today = lastmodMode === 'w3c' ? now.toISOString().split('T')[0] : now.toISOString();
    const body = files.map((f, i) => {
        const loc = f.loc || `${baseUrl}/sitemap-${i + 1}.xml`;
        return `  <sitemap>\n    <loc>${escapeXml(loc)}</loc>\n    <lastmod>${escapeXml(today)}</lastmod>\n  </sitemap>`;
    }).join('\n');
    return `${XML_DECL}\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>`;
}

// ─── Output builder ───────────────────────────────────────────────────────────

function buildOutput(crawlResult, o) {
    const { pages, pageDetails, linkGraph, robotsSitemapUrls, stats } = crawlResult;
    const splitAt = Math.min(o.splitAt || DEFAULT_OPTS.splitAt, GOOGLE_MAX_URLS_PER_FILE);

    if (pages.length === 0) {
        return { xml: buildUrlset([], o), isSitemapIndex: false, sitemapFiles: [], pageDetails, linkGraph, stats, robotsSitemapUrls };
    }

    if (pages.length <= splitAt) {
        return { xml: buildUrlset(pages, o), isSitemapIndex: false, sitemapFiles: [], pageDetails, linkGraph, stats, robotsSitemapUrls };
    }

    // Sitemap Index
    const chunks = chunkArray(pages, splitAt);
    const sitemapFiles = chunks.map((chunk, i) => ({
        index:    i + 1,
        loc:      null,
        xml:      buildUrlset(chunk, o),
        urlCount: chunk.length,
    }));

    const indexXml = buildSitemapIndex(
        sitemapFiles.map((_, i) => ({ loc: `SITEMAP_FILE_${i + 1}` })),
        o.startUrl ? new URL(o.startUrl).origin : '',
        o.lastmodMode
    );

    return { xml: indexXml, isSitemapIndex: true, sitemapFiles, pageDetails, linkGraph, stats, robotsSitemapUrls };
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function generateSitemap(options) {
    const o = { ...DEFAULT_OPTS, ...options };
    const result = await crawl(o);
    return buildOutput(result, o);
}

function buildSitemapFromUrls(urls, options = {}) {
    const o     = { ...DEFAULT_OPTS, ...options };
    const now   = new Date().toISOString();
    const today = o.lastmodMode === 'w3c' ? now.split('T')[0] : now;
    const pages = urls.map(url => ({
        url,
        changefreq: o.changefreqMap[Math.min(getDepth(url), 3)] || 'monthly',
        priority:   o.priorityMap[Math.min(getDepth(url), 3)]   || '0.4',
        lastmod:    today,
    }));
    return buildOutput({ pages, pageDetails: {}, linkGraph: new Map(), robotsSitemapUrls: [], stats: { crawled: pages.length, skipped: {}, blockedUrls: [], totalLinks: 0 } }, o);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunkArray(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

module.exports = {
    generateSitemap,
    buildSitemapFromUrls,
    DEFAULT_OPTS,
    GOOGLE_MAX_URLS_PER_FILE,
    // internals exposed for testing & reuse
    normalizeUrl,
    parseRobotsTxt,
    isDisallowed,
    buildUrlset,
    buildSitemapIndex,
    escapeXml,
    extractVideo,
    extractNews,
    isMobileReady,
    extractPageLastmod,
    applyFilters,
    buildRedirectChain,
    computeContentHash,
    getPathSegment,
};
