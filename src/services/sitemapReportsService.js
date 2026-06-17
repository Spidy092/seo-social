'use strict';

/**
 * Sitemap Reports Service
 *
 * Derives the Pro-sitemaps.com reports from the raw crawl output produced by
 * `sitemapGeneratorService.generateSitemap()`:
 *
 *   - brokenLinks    — pages whose HTTP status is ≥ 400
 *   - redirects      — pages whose final URL differs from the requested URL
 *                      (redirect chain captured per page)
 *   - blocked        — URLs the crawler skipped because of robots.txt
 *   - orphans        — pages in the URL set with no incoming internal link
 *   - duplicates     — pages grouped by canonical (and optionally by content hash)
 *   - linkAnalysis   — per-page internal/external link counts, depth, orphan flag
 *
 * All functions are pure — they take the crawl result + options and return
 * serialisable JSON, so the service is easy to unit-test.
 */

const { /* re-use local helper */ } = require('./sitemapGeneratorService');

/**
 * @param {object} args
 * @param {Array}  args.pages         — page entries from the crawl
 * @param {object} args.pageDetails   — url → PageDetail map
 * @param {Map}    [args.linkGraph]   — url → Set<internalLinks>
 * @param {object} args.stats         — crawl stats (with skipped / blockedUrls)
 * @param {object} [opts]
 * @param {boolean} [opts.includeContentHashDuplicates=true]
 * @returns {object}
 */
function buildReports({ pages = [], pageDetails = {}, linkGraph, stats = {} } = {}, opts = {}) {
    return {
        brokenLinks:  findBrokenLinks(pageDetails),
        redirects:    findRedirectChains(pageDetails),
        blocked:      findBlockedUrls(stats),
        orphans:      findOrphans(pages, pageDetails, linkGraph),
        duplicates:   findDuplicates(pageDetails, opts),
        linkAnalysis: buildLinkAnalysis(pages, pageDetails, linkGraph),
        summary:      buildSummary({ pages, pageDetails, stats }),
    };
}

function findBrokenLinks(pageDetails) {
    const out = [];
    for (const url of Object.keys(pageDetails)) {
        const d = pageDetails[url];
        if (d.status && d.status >= 400) {
            out.push({
                url,
                status: d.status,
                error: d.error || `HTTP ${d.status}`,
                responseTimeMs: d.responseTimeMs || 0,
            });
        }
    }
    return out.sort((a, b) => b.status - a.status);
}

function findRedirectChains(pageDetails) {
    const out = [];
    for (const url of Object.keys(pageDetails)) {
        const d = pageDetails[url];
        if (Array.isArray(d.redirectChain) && d.redirectChain.length > 0) {
            out.push({
                startUrl: url,
                chain: d.redirectChain,
                finalUrl: url,
                hopCount: d.redirectChain.length,
            });
        }
    }
    return out.sort((a, b) => b.hopCount - a.hopCount);
}

function findBlockedUrls(stats) {
    if (!stats) return [];
    const urls = Array.isArray(stats.blockedUrls) ? stats.blockedUrls : [];
    return urls.map(url => ({ url, reason: 'blocked by robots.txt' }));
}

function findOrphans(pages, pageDetails, linkGraph) {
    const out = [];
    for (const page of pages) {
        const d = pageDetails[page.url];
        if (d && d.isOrphan) {
            out.push({ url: page.url, lastmod: page.lastmod, depth: getDepthFromLinkGraph(linkGraph, page.url) });
        }
    }
    return out;
}

function findDuplicates(pageDetails, opts = {}) {
    const includeContentHash = opts.includeContentHashDuplicates !== false;
    // Group by canonical
    const byCanonical = new Map();
    for (const url of Object.keys(pageDetails)) {
        const d = pageDetails[url];
        const canon = d.canonical || url;
        if (!byCanonical.has(canon)) byCanonical.set(canon, []);
        byCanonical.get(canon).push({ url, contentHash: d.contentHash || null });
    }
    const groups = [];
    for (const [canon, urls] of byCanonical) {
        if (urls.length <= 1) continue;
        // canonical-group duplicates
        groups.push({ type: 'canonical', canonical: canon, urls: urls.map(u => u.url) });
    }
    if (includeContentHash) {
        // content-hash duplicates
        const byHash = new Map();
        for (const url of Object.keys(pageDetails)) {
            const h = pageDetails[url].contentHash;
            if (!h) continue;
            if (!byHash.has(h)) byHash.set(h, []);
            byHash.get(h).push(url);
        }
        for (const [hash, urls] of byHash) {
            if (urls.length <= 1) continue;
            groups.push({ type: 'content', contentHash: hash, urls });
        }
    }
    return groups;
}

function buildLinkAnalysis(pages, pageDetails, linkGraph) {
    return pages.map(p => {
        const d = pageDetails[p.url] || {};
        const links = linkGraph && linkGraph.get(p.url) ? Array.from(linkGraph.get(p.url)) : [];
        let internalCount = links.length;
        let externalCount = d.externalLinkCount || 0;
        return {
            url: p.url,
            lastmod: p.lastmod,
            changefreq: p.changefreq,
            priority: p.priority,
            depth: getDepthFromLinkGraph(linkGraph, p.url),
            inDegree: d.inDegree || 0,
            outDegree: internalCount,
            internalLinkCount: internalCount,
            externalLinkCount: externalCount,
            status: d.status || null,
            responseTimeMs: d.responseTimeMs || 0,
            isOrphan: !!d.isOrphan,
            title: d.title || '',
            section: getPathSegmentLocal(p.url),
        };
    });
}

function getDepthFromLinkGraph(_linkGraph, url) {
    try { return new URL(url).pathname.split('/').filter(Boolean).length; } catch { return 0; }
}

function buildSummary({ pages, pageDetails, stats }) {
    const totalPages = pages.length;
    const broken = Object.values(pageDetails).filter(d => d.status && d.status >= 400).length;
    const redirected = Object.values(pageDetails).filter(d => Array.isArray(d.redirectChain) && d.redirectChain.length > 0).length;
    const orphans = Object.values(pageDetails).filter(d => d.isOrphan).length;
    const blocked = (stats.blockedUrls || []).length;
    const withImages = pages.filter(p => p.images && p.images.length > 0).length;
    const withVideos = pages.filter(p => p.videos && p.videos.length > 0).length;
    const withNews   = pages.filter(p => p.news   && p.news.length   > 0).length;
    const withHreflang = pages.filter(p => p.hreflang && p.hreflang.length > 0).length;
    return {
        totalPages,
        broken,
        redirected,
        orphans,
        blocked,
        withImages,
        withVideos,
        withNews,
        withHreflang,
        skipped: stats.skipped || {},
        totalLinks: stats.totalLinks || 0,
    };
}

function getPathSegmentLocal(url) {
    try { const p = new URL(url).pathname.split('/').filter(Boolean); return p[0] || '(root)'; } catch { return '(root)'; }
}

module.exports = {
    buildReports,
    findBrokenLinks,
    findRedirectChains,
    findBlockedUrls,
    findOrphans,
    findDuplicates,
    buildLinkAnalysis,
};
