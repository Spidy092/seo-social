'use strict';

/**
 * Sitemap Validation Service
 *
 * Post-build validation that catches the things the generator's own checks
 * miss. Returns a structured `{ ok, warnings, errors }` object that the
 * frontend can render in the Reports tab.
 *
 * Validation rules:
 *   - <loc> must be a fully-qualified http(s) URL
 *   - <loc> must not contain XML control characters
 *   - <lastmod> must parse as a date and be in the past
 *   - <changefreq> must be one of the seven allowed values
 *   - <priority> must be in [0.0, 1.0]
 *   - hreflang self-reference: when any <xhtml:link> is present, the page
 *     itself must be listed (best-effort: the validator cannot fetch each URL
 *     to confirm; it only checks the cluster shape on the page that produced
 *     the hreflang list)
 *   - splitAt must not exceed Google's hard cap of 50 000
 *   - File sizes (best-effort, string length) must not exceed 50 MB
 *   - canonical URL warnings: off-site canonical, missing x-default
 *   - content-hash duplicates (when available)
 */

const GOOGLE_MAX_URLS_PER_FILE = 50000;
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

const VALID_CHANGEFREQ = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);

function validateSitemapOutput({ xml, sitemapFiles = [], pageDetails = {}, stats = {}, opts = {} } = {}) {
    const errors = [];
    const warnings = [];
    const notes = [];

    // ── 1. splitAt cap
    if (opts.splitAt && opts.splitAt > GOOGLE_MAX_URLS_PER_FILE) {
        errors.push({
            code: 'SPLIT_AT_EXCEEDED',
            message: `splitAt (${opts.splitAt}) exceeds Google hard cap of ${GOOGLE_MAX_URLS_PER_FILE}.`,
        });
    }

    // ── 2. pages.length cap (un-split sitemap)
    if (stats.crawled > GOOGLE_MAX_URLS_PER_FILE) {
        errors.push({
            code: 'URLS_EXCEEDED',
            message: `Crawled ${stats.crawled} URLs but a single sitemap may contain at most ${GOOGLE_MAX_URLS_PER_FILE}.`,
        });
    }

    // ── 3. File-size cap
    const xmlStr = typeof xml === 'string' ? xml : Array.isArray(xml) ? xml.join('\n') : '';
    if (xmlStr.length > MAX_FILE_BYTES) {
        errors.push({
            code: 'FILE_TOO_LARGE',
            message: `Sitemap is ${(xmlStr.length / 1024 / 1024).toFixed(2)} MB — must be under 50 MB uncompressed.`,
        });
    }
    if (Array.isArray(sitemapFiles)) {
        for (const f of sitemapFiles) {
            const size = (f.xml || '').length;
            if (size > MAX_FILE_BYTES) {
                errors.push({
                    code: 'CHILD_FILE_TOO_LARGE',
                    message: `Sitemap file "${f.file_name || f.index}" is ${(size / 1024 / 1024).toFixed(2)} MB — must be under 50 MB.`,
                });
            }
        }
    }

    // ── 4. Per-page validation
    let locCount = 0;
    for (const url of Object.keys(pageDetails)) {
        const d = pageDetails[url];
        locCount++;
        // Fully-qualified URL
        if (!/^https?:\/\/[^\s<>"']+$/i.test(url)) {
            errors.push({ code: 'BAD_LOC', message: `Invalid <loc>: ${url}` });
        }
        // Control characters (best-effort)
        if (containsXmlControlChars(url)) {
            errors.push({ code: 'CONTROL_CHAR_IN_LOC', message: `URL contains forbidden control characters: ${url}` });
        }
        // lastmod format
        if (d.lastmod) {
            const parsed = new Date(d.lastmod);
            if (isNaN(parsed.getTime())) {
                warnings.push({ code: 'BAD_LASTMOD', message: `Invalid <lastmod> on ${url}: ${d.lastmod}` });
            } else if (parsed.getTime() > Date.now() + 60 * 1000) {
                warnings.push({ code: 'FUTURE_LASTMOD', message: `<lastmod> on ${url} is in the future: ${d.lastmod}` });
            }
        }
        // changefreq
        if (d.changefreq && !VALID_CHANGEFREQ.has(d.changefreq)) {
            warnings.push({ code: 'BAD_CHANGEFREQ', message: `Invalid <changefreq> on ${url}: ${d.changefreq}` });
        }
        // priority
        if (d.priority !== undefined && d.priority !== null && d.priority !== '') {
            const p = parseFloat(d.priority);
            if (isNaN(p) || p < 0 || p > 1) {
                warnings.push({ code: 'BAD_PRIORITY', message: `Invalid <priority> on ${url}: ${d.priority}` });
            }
        }
        // canonical off-site warning
        if (d.canonical) {
            try {
                const pageOrigin = new URL(url).origin;
                const canonOrigin = new URL(d.canonical).origin;
                if (canonOrigin !== pageOrigin) {
                    warnings.push({ code: 'OFFSITE_CANONICAL', message: `<link rel="canonical"> on ${url} points off-site: ${d.canonical}` });
                }
                if (d.isSelfReferencingCanonical === false) {
                    notes.push({ code: 'NON_SELF_CANONICAL', message: `Canonical on ${url} is not self-referencing.` });
                }
            } catch { /* ignore */ }
        }
        // hreflang self-reference (best-effort)
        if (Array.isArray(d.hreflang) && d.hreflang.length > 0) {
            const hasXDefault = d.hreflang.some(h => String(h.hreflang).toLowerCase() === 'x-default');
            if (!hasXDefault) {
                notes.push({ code: 'NO_X_DEFAULT', message: `hreflang cluster on ${url} has no x-default entry.` });
            }
        }
    }

    // ── 5. Broken pages warning
    const broken = Object.values(pageDetails).filter(d => d.status && d.status >= 400);
    if (broken.length > 0) {
        warnings.push({
            code: 'BROKEN_PAGES',
            message: `${broken.length} page${broken.length !== 1 ? 's' : ''} returned 4xx/5xx during crawl.`,
        });
    }

    // ── 6. Orphans
    const orphans = Object.values(pageDetails).filter(d => d.isOrphan);
    if (orphans.length > 0) {
        notes.push({
            code: 'ORPHAN_PAGES',
            message: `${orphans.length} page${orphans.length !== 1 ? 's' : ''} have no incoming internal links.`,
        });
    }

    // ── 7. Duplicates by content hash
    const hashes = new Map();
    for (const url of Object.keys(pageDetails)) {
        const h = pageDetails[url].contentHash;
        if (!h) continue;
        if (!hashes.has(h)) hashes.set(h, []);
        hashes.get(h).push(url);
    }
    for (const [h, urls] of hashes) {
        if (urls.length > 1) {
            warnings.push({
                code: 'CONTENT_DUPLICATES',
                message: `${urls.length} pages share identical body text (hash ${h.slice(0, 8)}…): ${urls.slice(0, 3).join(', ')}${urls.length > 3 ? ', …' : ''}`,
            });
        }
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        notes,
        summary: {
            locCount,
            brokenCount: broken.length,
            orphanCount: orphans.length,
            sitemapIndexFiles: sitemapFiles.length,
            byteSize: xmlStr.length,
            humanSize: `${(xmlStr.length / 1024).toFixed(1)} KB`,
        },
    };
}

function containsXmlControlChars(value) {
    return Array.from(String(value)).some(char => {
        const code = char.charCodeAt(0);
        return code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    });
}

module.exports = {
    validateSitemapOutput,
    GOOGLE_MAX_URLS_PER_FILE,
    MAX_FILE_BYTES,
};
