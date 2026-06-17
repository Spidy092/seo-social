/**
 * 🗺️ Sitemap Generator Routes
 *
 * Endpoints:
 *   POST /api/sitemap/generate              — No auth. Crawl any public URL.
 *   POST /api/sitemap/generate-client       — Auth required. Client-linked, merges GSC/DB data.
 *   GET  /api/sitemap/history/:clientId     — Auth required. List saved sitemaps for a client.
 *   DELETE /api/sitemap/history/:id         — Auth required. Delete a saved sitemap.
 */

'use strict';

const { generateSitemap, buildSitemapFromUrls, DEFAULT_OPTS } = require('../services/sitemapGeneratorService');
const { requireAgencyContext } = require('../utils/authHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:sitemap');

// ─── Rate-limit store for anonymous generation (IP → { count, windowStart }) ─
const anonRateStore = new Map();
const ANON_MAX_REQUESTS = 3;        // 3 crawls per window
const ANON_WINDOW_MS    = 60 * 60 * 1000; // 1 hour

// R1: bound how many crawls can run at once across the process. Heavy crawls
// (5 000+ pages) can saturate CPU; with no cap, 5 concurrent anonymous users
// would each take ~80s. We allow 3 in parallel — same as our rate-limit budget.
const MAX_CONCURRENT_CRAWLS = 3;
let _activeCrawls = 0;
const _crawlWaiters = [];

function acquireCrawlSlot() {
    if (_activeCrawls < MAX_CONCURRENT_CRAWLS) {
        _activeCrawls++;
        return Promise.resolve(() => releaseCrawlSlot());
    }
    return new Promise(resolve => {
        _crawlWaiters.push(() => {
            _activeCrawls++;
            resolve(() => releaseCrawlSlot());
        });
    });
}

function releaseCrawlSlot() {
    _activeCrawls--;
    if (_crawlWaiters.length > 0) {
        const next = _crawlWaiters.shift();
        next();
    }
}

function checkAnonRateLimit(ip) {
    const now = Date.now();
    const entry = anonRateStore.get(ip);
    if (!entry || now - entry.windowStart > ANON_WINDOW_MS) {
        anonRateStore.set(ip, { count: 1, windowStart: now });
        return { allowed: true, remaining: ANON_MAX_REQUESTS - 1 };
    }
    if (entry.count >= ANON_MAX_REQUESTS) {
        const resetIn = Math.ceil((ANON_WINDOW_MS - (now - entry.windowStart)) / 1000 / 60);
        return { allowed: false, remaining: 0, resetInMinutes: resetIn };
    }
    entry.count++;
    return { allowed: true, remaining: ANON_MAX_REQUESTS - entry.count };
}

// Cleanup old entries every hour. `unref()` keeps the timer from holding the
// event loop open in tests / workers (R3 / R7).
const _anonCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - ANON_WINDOW_MS;
    for (const [ip, entry] of anonRateStore) {
        if (entry.windowStart < cutoff) anonRateStore.delete(ip);
    }
}, ANON_WINDOW_MS);
if (_anonCleanupTimer && typeof _anonCleanupTimer.unref === 'function') _anonCleanupTimer.unref();

// ─── Shared option parser ─────────────────────────────────────────────────────

// Parse <urlset> / <sitemapindex> XML using cheerio (already a project dep).
// cheerio's xmlMode + decodeEntities correctly handles &amp; / &lt; / &quot; in URLs
// — the previous regex-based parser silently produced broken URLs.
const cheerio = require('cheerio');

function extractUrlsFromXml(xml) {
    if (!xml || typeof xml !== 'string') return [];
    let $;
    try { $ = cheerio.load(xml, { xmlMode: true, decodeEntities: true }); } catch { return []; }
    const out = [];
    $('urlset > url').each((_, el) => {
        const $u = $(el);
        const loc = ($u.find('> loc').first().text() || '').trim();
        if (!loc) return;
        out.push({
            url:        loc,
            lastmod:    ($u.find('> lastmod').first().text()    || '').trim(),
            changefreq: ($u.find('> changefreq').first().text() || '').trim(),
            priority:   ($u.find('> priority').first().text()   || '').trim(),
        });
    });
    if (out.length) return out;
    $('sitemapindex > sitemap').each((_, el) => {
        const $s = $(el);
        const loc = ($s.find('> loc').first().text() || '').trim();
        if (loc) out.push({ url: loc, lastmod: '', changefreq: '', priority: '' });
    });
    return out;
}

function parseOptions(body) {
    const o = {};
    if (typeof body.maxPages          === 'number')  o.maxPages          = Math.min(body.maxPages, 10000);
    if (typeof body.maxDepth          === 'number')  o.maxDepth          = Math.min(body.maxDepth, 10);
    if (typeof body.requestDelayMs    === 'number')  o.requestDelayMs    = Math.max(body.requestDelayMs, 0);
    if (typeof body.splitAt           === 'number')  o.splitAt           = Math.min(body.splitAt, 50000); // Google hard cap
    if (typeof body.includeImages     === 'boolean') o.includeImages     = body.includeImages;
    if (typeof body.includeHreflang   === 'boolean') o.includeHreflang   = body.includeHreflang;
    if (typeof body.includeVideo      === 'boolean') o.includeVideo      = body.includeVideo;
    if (typeof body.includeNews       === 'boolean') o.includeNews       = body.includeNews;
    if (typeof body.includeMobile     === 'boolean') o.includeMobile     = body.includeMobile;
    if (typeof body.stripQueryStrings === 'boolean') o.stripQueryStrings = body.stripQueryStrings;
    if (typeof body.stripUtmParams    === 'boolean') o.stripUtmParams    = body.stripUtmParams;
    if (typeof body.computeContentHash === 'boolean') o.computeContentHash = body.computeContentHash;
    if (body.lastmodMode === 'iso8601' || body.lastmodMode === 'w3c') o.lastmodMode = body.lastmodMode;
    if (Array.isArray(body.includePattern)) o.includePattern = body.includePattern.slice(0, 50);
    if (Array.isArray(body.excludePattern)) o.excludePattern = body.excludePattern.slice(0, 50);
    if (typeof body.imagesMaxPerUrl === 'number')  o.imagesMaxPerUrl = Math.min(body.imagesMaxPerUrl, 1000);

    // changefreq override per depth (only valid Google values)
    if (body.changefreqMap && typeof body.changefreqMap === 'object') {
        const valid = ['always','hourly','daily','weekly','monthly','yearly','never'];
        const map = {};
        for (const [depth, val] of Object.entries(body.changefreqMap)) {
            if (valid.includes(val)) map[parseInt(depth, 10)] = val;
        }
        if (Object.keys(map).length > 0) o.changefreqMap = { ...DEFAULT_OPTS.changefreqMap, ...map };
    }

    // priority override per depth — clamped 0.0–1.0
    if (body.priorityMap && typeof body.priorityMap === 'object') {
        const map = {};
        for (const [depth, val] of Object.entries(body.priorityMap)) {
            const f = parseFloat(val);
            if (!isNaN(f) && f >= 0 && f <= 1) map[parseInt(depth, 10)] = f.toFixed(1);
        }
        if (Object.keys(map).length > 0) o.priorityMap = { ...DEFAULT_OPTS.priorityMap, ...map };
    }

    return o;
}

// ─── Route Plugin ─────────────────────────────────────────────────────────────

const { EventEmitter } = require('events');
const crawlEmitter = new EventEmitter();
crawlEmitter.setMaxListeners(100);

async function sitemapRoutes(fastify, options) {
    const { db } = options;

    // ── GET /api/sitemap/progress — Server-Sent Events ───────────────────────
    fastify.get('/api/sitemap/progress', {
        handler: (request, reply) => {
            const { url } = request.query;
            if (!url) return reply.code(400).send({ error: 'url query param required' });
            
            let startUrl;
            try {
                startUrl = new URL(url.startsWith('http') ? url : `https://${url}`).href;
            } catch {
                return reply.code(400).send({ error: 'invalid url format' });
            }

            reply.raw.setHeader('Content-Type', 'text/event-stream');
            reply.raw.setHeader('Cache-Control', 'no-cache');
            reply.raw.setHeader('Connection', 'keep-alive');
            reply.raw.write(': connected\\n\\n');

            const onProgress = (data) => {
                reply.raw.write(`data: ${JSON.stringify(data)}\\n\\n`);
            };
            const eventName = `progress:${startUrl}`;
            crawlEmitter.on(eventName, onProgress);

            request.raw.on('close', () => {
                crawlEmitter.off(eventName, onProgress);
            });
        }
    });

    // ── POST /api/sitemap/generate — No auth ─────────────────────────────────
    fastify.post('/api/sitemap/generate', {
        config: { rateLimit: false },   // we handle our own rate-limiting
        schema: {
            body: {
                type: 'object',
                required: ['url'],
                properties: {
                    url:               { type: 'string' },
                    maxPages:          { type: 'number', minimum: 1,   maximum: 2000  },
                    maxDepth:          { type: 'number', minimum: 0,   maximum: 10   },
                    requestDelayMs:    { type: 'number', minimum: 0,   maximum: 5000 },
                    splitAt:           { type: 'number', minimum: 100, maximum: 50000 },
                    includeImages:     { type: 'boolean' },
                    includeVideo:      { type: 'boolean' },
                    includeNews:       { type: 'boolean' },
                    includeMobile:     { type: 'boolean' },
                    includeHreflang:   { type: 'boolean' },
                    stripQueryStrings: { type: 'boolean' },
                    computeContentHash:  { type: 'boolean' },
                    trackRedirectChains: { type: 'boolean' },
                    saveAnonymously:   { type: 'boolean' },
                    changefreqMap:     { type: 'object' },
                    priorityMap:       { type: 'object' },
                },
            },
        },
        handler: async (request, reply) => {
            const ip = request.ip;
            const rl = checkAnonRateLimit(ip);
            reply.header('X-RateLimit-Limit',     String(ANON_MAX_REQUESTS));
            reply.header('X-RateLimit-Remaining', String(rl.remaining));

            if (!rl.allowed) {
                return reply.code(429).send({
                    success: false,
                    error: `Rate limit exceeded. You can generate ${ANON_MAX_REQUESTS} sitemaps per hour. Reset in ${rl.resetInMinutes} minute(s).`,
                });
            }

            const { url } = request.body;
            let startUrl;
            try {
                startUrl = new URL(url.startsWith('http') ? url : `https://${url}`).href;
            } catch {
                return reply.code(400).send({ success: false, error: 'Invalid URL format.' });
            }

            const opts = {
                ...DEFAULT_OPTS,
                maxPages: 500,
                maxDepth: 3,
                ...parseOptions(request.body),
                startUrl,
                onProgress: (crawled, max, currentUrl) => crawlEmitter.emit(`progress:${startUrl}`, { crawled, max, currentUrl })
            };

            log.info({ startUrl, ip, opts: { maxPages: opts.maxPages, maxDepth: opts.maxDepth } }, 'anon sitemap generation started');

            // R1: queue if too many crawls in flight
            const release = await acquireCrawlSlot();
            try {
                const start = Date.now();
                // R2 / R8: per-crawl wall-clock cap. If a single crawl takes longer
                // than 5 min, abort — the request gets a clear timeout response
                // instead of blocking the event loop.
                const CRAWL_TIMEOUT_MS = 5 * 60 * 1000;
                const result = await Promise.race([
                    generateSitemap(opts),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Crawl timeout: the site took longer than 5 minutes to respond. Try a lower maxPages or maxDepth.')), CRAWL_TIMEOUT_MS)),
                ]);
                const durationMs = Date.now() - start;

                log.info({ startUrl, urls: result.stats.crawled, durationMs }, 'anon sitemap complete');

                // Build a lightweight url list for the frontend table
                const urlList = result.sitemapFiles && result.sitemapFiles.length > 0
                    ? result.sitemapFiles.flatMap(f => extractUrlsFromXml(f.xml).map(u => ({ url: u.url })))
                    : extractUrlsFromXml(result.xml).map(u => ({ url: u.url }));

                // Quick-mode save: persist via sitemap_anon_clients keyed by an `sm_anon` cookie.
                // Required so /sitemap.xml?clientId=… , /api/sitemap/reports/…/…, /api/sitemap/validate,
                // /api/sitemap/export all work in Quick mode (B9).
                let savedId = null;
                let anonClientId = null;
                if (request.body.saveAnonymously !== false) {
                    try {
                        const crypto = require('crypto');
                        const token = (request.cookies && request.cookies['sm_anon']) || null;
                        let anonRow;
                        if (token) {
                            const r = await db.query(
                                `SELECT id FROM sitemap_anon_clients
                                  WHERE owner_token = $1 AND last_used > NOW() - INTERVAL '7 days'
                                  ORDER BY last_used DESC LIMIT 1`,
                                [token]
                            );
                            if (r.rows.length) anonRow = r.rows[0];
                        }
                        if (!anonRow) {
                            const newToken = crypto.randomBytes(24).toString('hex');
                            const c = await db.query(
                                `INSERT INTO sitemap_anon_clients (owner_token, site_url, label)
                                 VALUES ($1, $2, $3) RETURNING id, owner_token`,
                                [newToken, startUrl, `Anonymous — ${startUrl}`]
                            );
                            anonRow = c.rows[0];
                            reply.setCookie('sm_anon', newToken, {
                                path: '/', maxAge: 7 * 24 * 60 * 60 * 1000,
                                httpOnly: true, sameSite: 'lax',
                            });
                        } else {
                            await db.query(`UPDATE sitemap_anon_clients SET last_used = NOW() WHERE id = $1`, [anonRow.id]);
                        }
                        anonClientId = anonRow.id;

                        const fileCount = result.sitemapFiles?.length || 0;
                        const saveRes = await db.query(
                            `INSERT INTO sitemap_generations
                               (client_id, site_url, total_urls, xml_content, options, is_index, site_origin, total_pages, broken_count, redirect_count, orphan_count, options_v2)
                             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                             RETURNING id`,
                            [
                                anonClientId, startUrl, result.stats.crawled, result.xml,
                                JSON.stringify({ ...opts, seedUrls: undefined, isSitemapIndex: result.isSitemapIndex, sitemapFileCount: fileCount, anonymous: true }),
                                result.isSitemapIndex, new URL(startUrl).origin,
                                result.stats.crawled,
                                (result.stats.skipped && result.stats.skipped.error) || 0,
                                Object.values(result.pageDetails || {}).filter(d => Array.isArray(d.redirectChain) && d.redirectChain.length).length,
                                Object.values(result.pageDetails || {}).filter(d => d.isOrphan).length,
                                JSON.stringify({
                                    sitemapFilesCount: fileCount,
                                    pageDetailsCount: Object.keys(result.pageDetails || {}).length,
                                    linkGraphSize: (result.linkGraph && result.linkGraph.size) || 0,
                                    blockedUrlsCount: (result.stats.blockedUrls || []).length,
                                    discoveredNonHtmlCount: (result.stats.discoveredNonHtml || []).length,
                                    anonymous: true,
                                }),
                            ]
                        );
                        savedId = saveRes.rows[0]?.id;

                        if (savedId) {
                            // Per-file XML + gzipped bytes (B7 / P2)
                            const allFiles = result.isSitemapIndex && result.sitemapFiles && result.sitemapFiles.length
                                ? result.sitemapFiles
                                : [{ index: 1, xml: result.xml, urlCount: result.stats.crawled }];
                            const zlib = require('zlib');
                            for (const f of allFiles) {
                                try {
                                    let gzipBuf = null;
                                    try { gzipBuf = zlib.gzipSync(Buffer.from(f.xml || '', 'utf8'), { level: 9 }); } catch {}
                                    await db.query(
                                        `INSERT INTO sitemap_saved_files
                                           (generation_id, file_index, file_name, file_kind, xml_content, gzip_content, url_count, byte_size)
                                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                                        [savedId, f.index, `sitemap-${f.index}.xml`, 'urlset', f.xml, gzipBuf, f.urlCount, (f.xml || '').length]
                                    );
                                } catch (e) { log.debug({ err: e.message }, 'anon file insert failed'); }
                            }

                            // P1 — batch INSERT for per-page details
                            const details = result.pageDetails || {};
                            const detailRows = Object.keys(details).map(url => {
                                const d = details[url];
                                return [
                                    savedId, url, d.canonical, d.status, d.contentType, d.contentLength, d.responseTimeMs,
                                    JSON.stringify(d.redirectChain || []), d.outDegree || 0, d.externalLinkCount || 0, d.inDegree || 0,
                                    d.isOrphan || false, d.contentHash, d.title, d.h1, d.lastmod ? new Date(d.lastmod) : null,
                                ];
                            });
                            const DETAIL_BATCH = 200;
                            for (let i = 0; i < detailRows.length; i += DETAIL_BATCH) {
                                const slice = detailRows.slice(i, i + DETAIL_BATCH);
                                const placeholders = slice.map((_, idx) => {
                                    const off = idx * 16;
                                    return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8},$${off+9},$${off+10},$${off+11},$${off+12},$${off+13},$${off+14},$${off+15},$${off+16})`;
                                }).join(',');
                                try {
                                    await db.query(
                                        `INSERT INTO sitemap_crawl_details
                                           (generation_id, url, canonical, status, content_type, content_length, response_time_ms,
                                            redirect_chain, internal_link_count, external_link_count, in_degree, is_orphan, content_hash, title, h1, lastmod)
                                         VALUES ${placeholders}
                                         ON CONFLICT DO NOTHING`,
                                        slice.flat()
                                    );
                                } catch (e) { log.debug({ err: e.message }, 'anon detail batch insert failed'); }
                            }

                            // A10 — fire-and-forget ping to Bing (Google deprecated their API in 2023)
                            try {
                                const publicBase = process.env.PUBLIC_BASE_URL || '';
                                if (publicBase) {
                                    const pingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(`${publicBase}/sitemap.xml?clientId=${anonClientId}`)}`;
                                    require('https').get(pingUrl, () => {}).on('error', () => {});
                                }
                            } catch { /* ignore */ }
                        }
                    } catch (saveErr) {
                        log.error({ err: saveErr.message }, 'Failed to save anonymous sitemap — returning result anyway');
                    }
                }

                return {
                    success: true,
                    savedId,
                    clientId: anonClientId,
                    xml:              result.xml,
                    isSitemapIndex:   result.isSitemapIndex,
                    sitemapFiles:     result.sitemapFiles,
                    robotsSitemapUrls: result.robotsSitemapUrls,
                    pages:            result.pages,
                    pageDetails:      result.pageDetails,
                    urls:             urlList,
                    stats: { ...result.stats, durationMs },
                };
            } catch (err) {
                log.error({ err: err.message, startUrl }, 'anon sitemap generation failed');
                if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('Could not fetch')) {
                    return reply.code(422).send({ success: false, error: `Could not reach ${startUrl}. Check the URL is publicly accessible.` });
                }
                return reply.code(500).send({ success: false, error: 'Sitemap generation failed: ' + err.message });
            } finally {
                release();
            }
        },
    });

    // ── POST /api/sitemap/generate-client — Auth required ────────────────────
    fastify.post('/api/sitemap/generate-client', {
        schema: {
            body: {
                type: 'object',
                required: ['clientId'],
                properties: {
                    clientId:          { type: ['string', 'number'] },
                    startUrl:          { type: 'string' },
                    maxPages:          { type: 'number', minimum: 1,   maximum: 10000 },
                    maxDepth:          { type: 'number', minimum: 0,   maximum: 10   },
                    requestDelayMs:    { type: 'number', minimum: 0,   maximum: 5000 },
                    splitAt:           { type: 'number', minimum: 100, maximum: 50000 },
                    includeImages:     { type: 'boolean' },
                    includeVideo:      { type: 'boolean' },
                    includeNews:       { type: 'boolean' },
                    includeMobile:     { type: 'boolean' },
                    includeHreflang:   { type: 'boolean' },
                    stripQueryStrings: { type: 'boolean' },
                    computeContentHash:  { type: 'boolean' },
                    trackRedirectChains: { type: 'boolean' },
                    includeGscUrls:    { type: 'boolean' },
                    includeRankingUrls:{ type: 'boolean' },
                    includeAuditUrls:  { type: 'boolean' },
                    saveResult:        { type: 'boolean' },
                    changefreqMap:     { type: 'object' },
                    priorityMap:       { type: 'object' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;

            const body = request.body;
            const clientId = body.clientId;
            if (!clientId) {
                return reply.code(400).send({ success: false, error: 'Invalid clientId.' });
            }

            // Verify client belongs to this agency
            const clientRow = await db.query(
                `SELECT id, website_url, name FROM seo_clients WHERE id = $1 AND agency_id = $2 LIMIT 1`,
                [clientId, ctx.agencyId]
            );
            if (!clientRow.rows.length) {
                return reply.code(404).send({ success: false, error: 'Client not found.' });
            }

            const client    = clientRow.rows[0];
            const siteUrl   = body.startUrl || client.website_url;
            if (!siteUrl) {
                return reply.code(400).send({ success: false, error: 'No URL provided and client has no website_url.' });
            }

            let startUrl;
            try {
                startUrl = new URL(siteUrl.startsWith('http') ? siteUrl : `https://${siteUrl}`).href;
            } catch {
                return reply.code(400).send({ success: false, error: 'Invalid URL format.' });
            }

            // ── Collect seed URLs from DB sources ─────────────────────────
            const seedUrls = new Set();

            if (body.includeGscUrls !== false) {
                try {
                    const gscRows = await db.query(
                        `SELECT DISTINCT page FROM gsc_search_analytics
                         WHERE client_id = $1 AND page IS NOT NULL AND page != ''
                         LIMIT 2000`,
                        [clientId]
                    );
                    gscRows.rows.forEach(r => seedUrls.add(r.page));
                    log.debug({ count: gscRows.rows.length }, 'GSC seed URLs loaded');
                } catch (e) {
                    log.warn({ err: e.message }, 'Failed to load GSC seed URLs');
                }
            }

            if (body.includeRankingUrls !== false) {
                try {
                    const origin = new URL(startUrl).origin;
                    const domain = new URL(startUrl).hostname.replace('www.', '');
                    const rpRows = await db.query(
                        `SELECT DISTINCT url FROM ranking_pages WHERE domain LIKE $1 LIMIT 2000`,
                        [`%${domain}%`]
                    );
                    rpRows.rows.forEach(r => {
                        try { new URL(r.url); seedUrls.add(r.url); } catch { /* ignore */ }
                    });
                    log.debug({ count: rpRows.rows.length }, 'Ranking pages seed URLs loaded');
                } catch (e) {
                    log.warn({ err: e.message }, 'Failed to load ranking page seed URLs');
                }
            }

            if (body.includeAuditUrls !== false) {
                try {
                    const auditRows = await db.query(
                        `SELECT pages FROM technical_audits
                         WHERE user_id = $1 AND site_url LIKE $2
                         ORDER BY created_at DESC LIMIT 1`,
                        [ctx.userId, `%${new URL(startUrl).hostname}%`]
                    );
                    if (auditRows.rows.length && auditRows.rows[0].pages) {
                        const auditPages = Array.isArray(auditRows.rows[0].pages)
                            ? auditRows.rows[0].pages
                            : JSON.parse(auditRows.rows[0].pages || '[]');
                        auditPages.forEach(p => {
                            if (p && p.url) {
                                try { new URL(p.url); seedUrls.add(p.url); } catch { /* ignore */ }
                            }
                        });
                        log.debug({ count: auditPages.length }, 'Technical audit seed URLs loaded');
                    }
                } catch (e) {
                    log.warn({ err: e.message }, 'Failed to load audit seed URLs');
                }
            }

            const opts = {
                ...DEFAULT_OPTS,
                maxPages: 2000,
                maxDepth: 5,
                ...parseOptions(body),
                startUrl,
                seedUrls: Array.from(seedUrls),
                onProgress: (crawled, max, currentUrl) => crawlEmitter.emit(`progress:${startUrl}`, { crawled, max, currentUrl })
            };

            log.info({
                startUrl,
                clientId,
                seedUrls: seedUrls.size,
                maxPages: opts.maxPages,
                maxDepth: opts.maxDepth,
            }, 'client sitemap generation started');

            let result;
            try {
                const start = Date.now();
                result = await generateSitemap(opts);
                result.stats.durationMs = Date.now() - start;
            } catch (err) {
                log.error({ err: err.message, startUrl }, 'client sitemap generation failed');
                if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND') || err.message.includes('Could not fetch')) {
                    return reply.code(422).send({ success: false, error: `Could not reach ${startUrl}. Check the URL is publicly accessible.` });
                }
                return reply.code(500).send({ success: false, error: 'Sitemap generation failed: ' + err.message });
            }

            // ── Optionally save to DB ──────────────────────────────────────
            let savedId = null;
            if (body.saveResult !== false) {
                try {
                    const startUrlOrigin = (() => { try { return new URL(startUrl).origin; } catch { return null; } })();
                    const fileCount = result.sitemapFiles?.length || 0;
                    const allDetails = Object.values(result.pageDetails || {});
                    const redirectCount = allDetails.filter(d => Array.isArray(d.redirectChain) && d.redirectChain.length > 0).length;
                    const orphanCount = allDetails.filter(d => d.isOrphan).length;
                    const brokenCount = (result.stats.skipped && result.stats.skipped.error) || 0;
                    const saveRes = await db.query(
                        `INSERT INTO sitemap_generations
                           (user_id, agency_id, client_id, site_url, total_urls, xml_content, options, is_index, site_origin, total_pages, broken_count, redirect_count, orphan_count, options_v2)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                         RETURNING id`,
                        [
                            ctx.userId,
                            ctx.agencyId,
                            clientId,
                            startUrl,
                            result.stats.crawled,
                            result.xml,
                            JSON.stringify({
                                ...opts,
                                seedUrls: undefined,
                                isSitemapIndex: result.isSitemapIndex,
                                sitemapFileCount: fileCount,
                            }),
                            result.isSitemapIndex,
                            startUrlOrigin,
                            result.stats.crawled,
                            brokenCount,
                            redirectCount,
                            orphanCount,
                            JSON.stringify({
                                sitemapFilesCount: fileCount,
                                pageDetailsCount: allDetails.length,
                                linkGraphSize: (result.linkGraph && result.linkGraph.size) || 0,
                                blockedUrlsCount: (result.stats.blockedUrls || []).length,
                            }),
                        ]
                    );
                    savedId = saveRes.rows[0]?.id;

                    // Persist per-file XML (for split sitemaps) and per-page details
                    if (savedId) {
                        const allFiles = result.isSitemapIndex && result.sitemapFiles && result.sitemapFiles.length
                            ? result.sitemapFiles
                            : [{ index: 1, xml: result.xml, urlCount: result.stats.crawled }];
                        const zlib = require('zlib');
                        for (const f of allFiles) {
                            try {
                                // Pre-compute gzip bytes now so /sitemap-:id.xml.gz can stream
                                // them directly (B7 / P2 — no on-the-fly recomputation per request).
                                let gzipBuf = null;
                                try { gzipBuf = zlib.gzipSync(Buffer.from(f.xml || '', 'utf8'), { level: 9 }); } catch { /* ignore */ }
                                await db.query(
                                    `INSERT INTO sitemap_saved_files
                                       (generation_id, agency_id, client_id, file_index, file_name, file_kind, xml_content, gzip_content, url_count, byte_size)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                                    [
                                        savedId,
                                        ctx.agencyId,
                                        clientId,
                                        f.index,
                                        `sitemap-${f.index}.xml`,
                                        'urlset',
                                        f.xml,
                                        gzipBuf,
                                        f.urlCount,
                                        (f.xml || '').length,
                                    ]
                                );
                            } catch (fileErr) {
                                log.error({ err: fileErr.message }, 'Failed to persist sitemap file');
                            }
                        }

                        // P1 — batch insert per-page details instead of one round-trip per row.
                        // For 5 000 pages this is 5 000 fewer queries.
                        const details = result.pageDetails || {};
                        const detailRows = Object.keys(details).map(url => {
                            const d = details[url];
                            return [
                                savedId, clientId, url, d.canonical, d.status, d.contentType, d.contentLength, d.responseTimeMs,
                                JSON.stringify(d.redirectChain || []), d.outDegree || 0, d.externalLinkCount || 0, d.inDegree || 0,
                                d.isOrphan || false, d.contentHash, d.title, d.h1, d.lastmod ? new Date(d.lastmod) : null,
                            ];
                        });
                        const DETAIL_BATCH = 200;
                        for (let i = 0; i < detailRows.length; i += DETAIL_BATCH) {
                            const slice = detailRows.slice(i, i + DETAIL_BATCH);
                            const placeholders = slice.map((_, idx) => {
                                const off = idx * 17;
                                return `($${off+1},$${off+2},$${off+3},$${off+4},$${off+5},$${off+6},$${off+7},$${off+8},$${off+9},$${off+10},$${off+11},$${off+12},$${off+13},$${off+14},$${off+15},$${off+16},$${off+17})`;
                            }).join(',');
                            try {
                                await db.query(
                                    `INSERT INTO sitemap_crawl_details
                                       (generation_id, client_id, url, canonical, status, content_type, content_length, response_time_ms,
                                        redirect_chain, internal_link_count, external_link_count, in_degree, is_orphan, content_hash, title, h1, lastmod)
                                     VALUES ${placeholders}
                                     ON CONFLICT DO NOTHING`,
                                    slice.flat()
                                );
                            } catch (e) { log.debug({ err: e.message }, 'detail batch insert failed'); }
                        }

                        // A10 — ping Bing's sitemap submission endpoint (Google deprecated
                        // their public ping API in 2023; Bing still supports it). Best-effort,
                        // fire-and-forget.
                        try {
                            const publicBase = process.env.PUBLIC_BASE_URL || '';
                            if (publicBase) {
                                const pingUrl = `https://www.bing.com/ping?sitemap=${encodeURIComponent(`${publicBase}/sitemap.xml?clientId=${clientId}`)}`;
                                require('https').get(pingUrl, () => {}).on('error', () => {});
                            }
                        } catch { /* ignore */ }
                    }
                    log.info({ savedId, clientId, urls: result.stats.crawled }, 'sitemap saved to DB');
                } catch (saveErr) {
                    log.error({ err: saveErr.message }, 'Failed to save sitemap — returning result anyway');
                }
            }

            return {
                success: true,
                savedId,
                xml:              result.xml,
                isSitemapIndex:   result.isSitemapIndex,
                sitemapFiles:     result.sitemapFiles,
                robotsSitemapUrls: result.robotsSitemapUrls,
                stats: result.stats,
            };
        },
    });

    // ── GET /api/sitemap/history/:clientId ───────────────────────────────────
    fastify.get('/api/sitemap/history/:clientId', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const clientId = request.params.clientId;
        if (!clientId) {
            return reply.code(400).send({ success: false, error: 'Invalid clientId.' });
        }

        // Verify access
        const clientRow = await db.query(
            `SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2 LIMIT 1`,
            [clientId, ctx.agencyId]
        );
        if (!clientRow.rows.length) {
            return reply.code(404).send({ success: false, error: 'Client not found.' });
        }

        try {
            const rows = await db.query(
                `SELECT id, site_url, total_urls, options, created_at
                 FROM sitemap_generations
                 WHERE client_id = $1 AND agency_id = $2
                 ORDER BY created_at DESC
                 LIMIT 20`,
                [clientId, ctx.agencyId]
            );
            return { success: true, history: rows.rows };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to fetch sitemap history');
            return reply.code(500).send({ success: false, error: 'Failed to fetch history.' });
        }
    });

    // ── GET /api/sitemap/history/:clientId/:id/download ─────────────────────
    fastify.get('/api/sitemap/history/:clientId/:id/download', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const id       = request.params.id;
        const clientId = request.params.clientId;
        if (!clientId || !id) {
            return reply.code(400).send({ success: false, error: 'Invalid parameters.' });
        }

        try {
            const row = await db.query(
                `SELECT xml_content, site_url FROM sitemap_generations
                 WHERE id = $1 AND client_id = $2 AND agency_id = $3 LIMIT 1`,
                [id, clientId, ctx.agencyId]
            );
            if (!row.rows.length) {
                return reply.code(404).send({ success: false, error: 'Sitemap not found.' });
            }
            reply.header('Content-Type', 'application/xml; charset=utf-8');
            reply.header('Content-Disposition', `attachment; filename="sitemap.xml"`);
            return reply.send(row.rows[0].xml_content);
        } catch (err) {
            log.error({ err: err.message }, 'Failed to download sitemap');
            return reply.code(500).send({ success: false, error: 'Download failed.' });
        }
    });

    // ── GET /api/sitemap/audit/:clientId/:id/download ───────────────────────
    fastify.get('/api/sitemap/audit/:clientId/:id/download', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const clientId = request.params.clientId;
        const id       = request.params.id;
        if (!clientId || !id) {
            return reply.code(400).send({ success: false, error: 'Invalid parameters.' });
        }

        try {
            // Verify ownership
            const genRow = await db.query(
                `SELECT id FROM sitemap_generations WHERE id = $1 AND agency_id = $2 AND client_id = $3 LIMIT 1`,
                [id, ctx.agencyId, clientId]
            );
            if (!genRow.rows.length) {
                return reply.code(404).send({ success: false, error: 'Sitemap not found.' });
            }

            const details = await db.query(
                `SELECT url, status, content_type, response_time_ms, redirect_chain, internal_link_count, external_link_count, in_degree, is_orphan, title, h1 
                 FROM sitemap_crawl_details 
                 WHERE generation_id = $1`,
                [id]
            );

            // Build CSV
            const escapeCsv = (str) => {
                if (str === null || str === undefined) return '';
                const s = String(str);
                if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
                    return `"${s.replace(/"/g, '""')}"`;
                }
                return s;
            };

            const header = ['URL', 'Status', 'Content Type', 'Response Time (ms)', 'Inlinks', 'Outlinks', 'Redirect Chain', 'Title', 'H1', 'Is Orphan'];
            const rows = details.rows.map(r => {
                let chainStr = '';
                try {
                    const chain = typeof r.redirect_chain === 'string' ? JSON.parse(r.redirect_chain) : r.redirect_chain;
                    if (Array.isArray(chain) && chain.length > 0) {
                        chainStr = chain.map(c => `${c.status} -> ${c.url}`).join(' | ');
                    }
                } catch(e){}

                return [
                    r.url,
                    r.status,
                    r.content_type || '',
                    r.response_time_ms || 0,
                    r.in_degree || 0,
                    r.internal_link_count || 0,
                    chainStr,
                    r.title || '',
                    r.h1 || '',
                    r.is_orphan ? 'Yes' : 'No'
                ].map(escapeCsv).join(',');
            });

            const csv = [header.join(','), ...rows].join('\n');

            reply.header('Content-Type', 'text/csv; charset=utf-8');
            reply.header('Content-Disposition', `attachment; filename="seo-audit-${id}.csv"`);
            return reply.send(csv);
        } catch (err) {
            log.error({ err: err.message }, 'Failed to generate SEO audit CSV');
            return reply.code(500).send({ success: false, error: 'Download failed.' });
        }
    });

    // ── DELETE /api/sitemap/history/:id ─────────────────────────────────────
    fastify.delete('/api/sitemap/history/:id', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const id = request.params.id;
        if (!id) {
            return reply.code(400).send({ success: false, error: 'Invalid id.' });
        }

        try {
            const res = await db.query(
                `DELETE FROM sitemap_generations
                 WHERE id = $1 AND agency_id = $2
                 RETURNING id`,
                [id, ctx.agencyId]
            );
            if (!res.rows.length) {
                return reply.code(404).send({ success: false, error: 'Sitemap record not found.' });
            }
            return { success: true, deletedId: id };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to delete sitemap record');
            return reply.code(500).send({ success: false, error: 'Delete failed.' });
        }
    });

    // ════════════════════════════════════════════════════════════════════════
    //  PRO-FEATURE ROUTES (sitemapReports, sitemapExport, sitemapValidation,
    //  sitemapPublic, URL filters, per-page details)
    // ════════════════════════════════════════════════════════════════════════

    const { buildReports } = require('../services/sitemapReportsService');
    const { renderXml: wrapXml, renderHtmlSitemap, renderCsv, renderTxt, renderGzipped, renderXslStylesheet, renderRobotsTxt } = require('../services/sitemapExportService');
    const { validateSitemapOutput } = require('../services/sitemapValidationService');
    const { getLatestForClient, getFile, getSitemapFilesForGeneration, getClientSite, buildFallbackUrlsetXml, buildFallbackSitemapIndexXml } = require('../services/sitemapPublicService');

    // ── POST /api/sitemap/validate ──────────────────────────────────────────
    fastify.post('/api/sitemap/validate', {
        schema: {
            body: {
                type: 'object',
                required: ['id'],
                properties: { id: { type: ['string', 'number'] } },
            },
        },
    }, async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const id = parseInt(request.body.id, 10);
        if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id.' });

        try {
            const res = await db.query(
                `SELECT id, site_url, total_urls, xml_content, options, options_v2
                   FROM sitemap_generations
                  WHERE id = $1 AND agency_id = $2
                  LIMIT 1`,
                [id, ctx.agencyId]
            );
            if (!res.rows.length) return reply.code(404).send({ success: false, error: 'Sitemap not found.' });
            const gen = res.rows[0];

            // Pull the saved files for index-style generations
            const files = await getSitemapFilesForGeneration(db, id);

            // Pull per-page details (if any)
            const detailsRes = await db.query(
                `SELECT url, canonical, status, content_type, content_length, response_time_ms,
                        redirect_chain, internal_link_count, external_link_count, in_degree,
                        is_orphan, is_duplicate, duplicate_group, content_hash, title, h1, lastmod
                   FROM sitemap_crawl_details
                  WHERE generation_id = $1`,
                [id]
            );
            const pageDetails = {};
            for (const row of detailsRes.rows) {
                pageDetails[row.url] = {
                    url: row.url,
                    status: row.status,
                    contentType: row.content_type,
                    contentLength: row.content_length,
                    responseTimeMs: row.response_time_ms,
                    redirectChain: row.redirect_chain || [],
                    internalLinkCount: row.internal_link_count,
                    externalLinkCount: row.external_link_count,
                    inDegree: row.in_degree,
                    isOrphan: row.is_orphan,
                    isDuplicate: row.is_duplicate,
                    duplicateGroup: row.duplicate_group,
                    contentHash: row.content_hash,
                    title: row.title,
                    h1: row.h1,
                    lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : null,
                    canonical: row.canonical,
                };
            }

            const validation = validateSitemapOutput({
                xml: gen.xml_content,
                sitemapFiles: files,
                pageDetails,
                stats: { crawled: gen.total_urls },
                opts: { splitAt: (gen.options && gen.options.splitAt) || 50000 },
            });

            return { success: true, validation };
        } catch (err) {
            log.error({ err: err.message }, 'validate failed');
            return reply.code(500).send({ success: false, error: 'Validation failed: ' + err.message });
        }
    });

    // ── POST /api/sitemap/export ────────────────────────────────────────────
    fastify.post('/api/sitemap/export', {
        schema: {
            body: {
                type: 'object',
                required: ['id', 'format'],
                properties: {
                    id: { type: ['string', 'number'] },
                    format: { type: 'string', enum: ['xml', 'html', 'csv', 'txt', 'gz'] },
                },
            },
        },
    }, async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const id = parseInt(request.body.id, 10);
        if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id.' });
        const { format } = request.body;

        try {
            const res = await db.query(
                `SELECT id, site_url, total_urls, xml_content
                   FROM sitemap_generations
                  WHERE id = $1 AND agency_id = $2
                  LIMIT 1`,
                [id, ctx.agencyId]
            );
            if (!res.rows.length) return reply.code(404).send({ success: false, error: 'Sitemap not found.' });
            const gen = res.rows[0];

            // Reconstruct pages from saved XML (urlset mode) or by parsing child files (index mode)
            let pages = [];
            if (gen.xml_content && gen.xml_content.includes('<urlset')) {
                pages = extractUrlsFromXml(gen.xml_content);
            } else if (gen.xml_content && gen.xml_content.includes('<sitemapindex')) {
                // Load child files
                const files = await getSitemapFilesForGeneration(db, id);
                for (const f of files) {
                    pages.push(...extractUrlsFromXml(f.xml_content));
                }
            }
            if (pages.length === 0) {
                return reply.code(422).send({ success: false, error: 'No URLs found in this sitemap.' });
            }

            if (format === 'xml') {
                const wrapped = wrapXml(gen.xml_content);
                reply.header('Content-Type', 'application/xml; charset=utf-8');
                reply.header('Content-Disposition', `attachment; filename="sitemap-${id}.xml"`);
                return reply.send(wrapped);
            }
            if (format === 'gz') {
                const buf = renderGzipped(gen.xml_content);
                reply.header('Content-Type', 'application/gzip');
                reply.header('Content-Disposition', `attachment; filename="sitemap-${id}.xml.gz"`);
                return reply.send(buf);
            }
            if (format === 'html') {
                const html = renderHtmlSitemap(pages, { title: `Sitemap — ${gen.site_url}` });
                reply.header('Content-Type', 'text/html; charset=utf-8');
                reply.header('Content-Disposition', `attachment; filename="sitemap-${id}.html"`);
                return reply.send(html);
            }
            if (format === 'csv') {
                const csv = renderCsv(pages);
                reply.header('Content-Type', 'text/csv; charset=utf-8');
                reply.header('Content-Disposition', `attachment; filename="sitemap-${id}.csv"`);
                return reply.send(csv);
            }
            if (format === 'txt') {
                const txt = renderTxt(pages);
                reply.header('Content-Type', 'text/plain; charset=utf-8');
                reply.header('Content-Disposition', `attachment; filename="sitemap-${id}.txt"`);
                return reply.send(txt);
            }
            return reply.code(400).send({ success: false, error: 'Unsupported format.' });
        } catch (err) {
            log.error({ err: err.message }, 'export failed');
            return reply.code(500).send({ success: false, error: 'Export failed: ' + err.message });
        }
    });

    // ── GET /api/sitemap/reports/:clientId/:id ──────────────────────────────
    fastify.get('/api/sitemap/reports/:clientId/:id', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const clientId = request.params.clientId;
        const id       = request.params.id;
        if (!id) return reply.code(400).send({ success: false, error: 'Invalid id.' });

        // Verify client + sitemap belong to this agency
        const clientRow = await db.query(
            `SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2 LIMIT 1`,
            [clientId, ctx.agencyId]
        );
        if (!clientRow.rows.length) return reply.code(404).send({ success: false, error: 'Client not found.' });

        try {
            const genRes = await db.query(
                `SELECT id, total_urls, options, options_v2
                   FROM sitemap_generations
                  WHERE id = $1 AND client_id = $2 AND agency_id = $3
                  LIMIT 1`,
                [id, clientId, ctx.agencyId]
            );
            if (!genRes.rows.length) return reply.code(404).send({ success: false, error: 'Sitemap not found.' });

            const detailsRes = await db.query(
                `SELECT url, canonical, status, content_type, content_length, response_time_ms,
                        redirect_chain, internal_link_count, external_link_count, in_degree,
                        is_orphan, is_duplicate, duplicate_group, content_hash, title, h1, lastmod
                   FROM sitemap_crawl_details
                  WHERE generation_id = $1`,
                [id]
            );

            // Build reports-shaped structures
            const pageDetails = {};
            for (const row of detailsRes.rows) {
                pageDetails[row.url] = {
                    url: row.url,
                    status: row.status,
                    contentType: row.content_type,
                    contentLength: row.content_length,
                    responseTimeMs: row.response_time_ms,
                    redirectChain: row.redirect_chain || [],
                    internalLinkCount: row.internal_link_count,
                    externalLinkCount: row.external_link_count,
                    inDegree: row.in_degree,
                    isOrphan: row.is_orphan,
                    isDuplicate: row.is_duplicate,
                    duplicateGroup: row.duplicate_group,
                    contentHash: row.content_hash,
                    title: row.title,
                    h1: row.h1,
                    lastmod: row.lastmod ? new Date(row.lastmod).toISOString() : null,
                    canonical: row.canonical,
                };
            }
            const pages = Object.values(pageDetails).map(d => ({
                url: d.url, lastmod: d.lastmod, changefreq: '', priority: '',
            }));
            const reports = buildReports({
                pages,
                pageDetails,
                stats: { blockedUrls: [] },
            });
            return { success: true, reports };
        } catch (err) {
            log.error({ err: err.message }, 'reports fetch failed');
            return reply.code(500).send({ success: false, error: 'Failed to load reports.' });
        }
    });

    // ── GET /api/sitemap/saved-files/:generationId ─────────────────────────
    fastify.get('/api/sitemap/saved-files/:generationId', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const id = parseInt(request.params.generationId, 10);
        if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id.' });
        try {
            const res = await db.query(
                `SELECT f.id, f.file_index, f.file_name, f.file_kind, f.url_count, f.byte_size, f.created_at
                   FROM sitemap_saved_files f
                   JOIN sitemap_generations g ON g.id = f.generation_id
                  WHERE f.generation_id = $1 AND g.agency_id = $2
                  ORDER BY f.file_index ASC`,
                [id, ctx.agencyId]
            );
            return { success: true, files: res.rows };
        } catch (err) {
            log.error({ err: err.message }, 'saved-files fetch failed');
            return reply.code(500).send({ success: false, error: 'Failed to load files.' });
        }
    });

    // ── GET /api/sitemap/filters/:clientId ──────────────────────────────────
    fastify.get('/api/sitemap/filters/:clientId', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const clientId = request.params.clientId;
        try {
            const r = await db.query(
                `SELECT id, include_pattern, exclude_pattern, updated_at
                   FROM sitemap_url_filters
                  WHERE client_id = $1 AND agency_id = $2
                  LIMIT 1`,
                [clientId, ctx.agencyId]
            );
            return { success: true, filters: r.rows[0] || null };
        } catch (err) {
            log.error({ err: err.message }, 'filters fetch failed');
            return reply.code(500).send({ success: false, error: 'Failed to load filters.' });
        }
    });

    // ── POST /api/sitemap/filters/:clientId ─────────────────────────────────
    fastify.post('/api/sitemap/filters/:clientId', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    includePattern: { type: 'array', items: { type: 'string' }, maxItems: 50 },
                    excludePattern: { type: 'array', items: { type: 'string' }, maxItems: 50 },
                },
            },
        },
    }, async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const clientId = request.params.clientId;
        const inc = Array.isArray(request.body.includePattern) ? request.body.includePattern.slice(0, 50) : [];
        const exc = Array.isArray(request.body.excludePattern) ? request.body.excludePattern.slice(0, 50) : [];
        try {
            // Verify ownership
            const c = await db.query(
                `SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2 LIMIT 1`,
                [clientId, ctx.agencyId]
            );
            if (!c.rows.length) return reply.code(404).send({ success: false, error: 'Client not found.' });

            await db.query(
                `INSERT INTO sitemap_url_filters (client_id, agency_id, include_pattern, exclude_pattern, updated_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (client_id) DO UPDATE
                   SET include_pattern = EXCLUDED.include_pattern,
                       exclude_pattern = EXCLUDED.exclude_pattern,
                       updated_at = NOW()`,
                [clientId, ctx.agencyId, inc, exc]
            );
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'filters save failed');
            return reply.code(500).send({ success: false, error: 'Failed to save filters.' });
        }
    });

    // ════════════════════════════════════════════════════════════════════════
    //  PUBLIC ROUTES (no auth) — serve the latest saved sitemap to search engines
    // ════════════════════════════════════════════════════════════════════════

    // ── GET /sitemap.xml?clientId=X ─────────────────────────────────────────
    fastify.get('/sitemap.xml', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const clientId = request.query.clientId;
        try {
            if (!clientId) {
                // Fallback: empty urlset pointing at root
                const xml = buildFallbackUrlsetXml(`${request.protocol}://${request.headers.host}/`);
                reply.header('Content-Type', 'application/xml; charset=utf-8');
                reply.header('Cache-Control', 'public, max-age=300, s-maxage=600');
                reply.header('X-Robots-Tag', 'noindex');
                return reply.send(xml);
            }
            const data = await getLatestForClient(db, clientId);
            if (!data || !data.files.length) {
                const client = await getClientSite(db, clientId);
                const siteUrl = (client && client.website_url) || `${request.protocol}://${request.headers.host}/`;
                const xml = buildFallbackUrlsetXml(siteUrl);
                reply.header('Content-Type', 'application/xml; charset=utf-8');
                reply.header('Cache-Control', 'public, max-age=300, s-maxage=600');
                reply.header('X-Robots-Tag', 'noindex');
                return reply.send(xml);
            }
            // ETag for conditional GET
            const etag = `"${data.generation.id}-${data.generation.created_at instanceof Date ? data.generation.created_at.toISOString() : data.generation.created_at}"`;
            if (request.headers['if-none-match'] === etag) {
                return reply.code(304).send();
            }
            reply.header('ETag', etag);
            reply.header('Cache-Control', 'public, max-age=300, s-maxage=600');
            reply.header('X-Robots-Tag', 'noindex');

            if (data.generation.is_index) {
                // Build a fresh sitemapindex pointing to our public file URLs
                const base = `${request.protocol}://${request.headers.host}`;
                const entries = data.files.map(f => ({
                    loc: `${base}/sitemap-${f.id}.xml`,
                    lastmod: new Date(data.generation.created_at).toISOString(),
                }));
                const { buildSitemapIndex } = require('../services/sitemapGeneratorService');
                return reply.send(buildSitemapIndex(entries, base, 'iso8601'));
            }
            // Single-file: serve the first (and only) file
            const xml = data.files[0].xml_content;
            reply.header('Content-Type', 'application/xml; charset=utf-8');
            return reply.send(wrapXml(xml));
        } catch (err) {
            log.error({ err: err.message, clientId }, 'public sitemap.xml failed');
            return reply.code(500).send({ success: false, error: 'Failed to serve sitemap.' });
        }
    });

    // ── GET /sitemap-:id.xml ────────────────────────────────────────────────
    fastify.get('/sitemap-:id.xml', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id.' });
        try {
            const f = await getFile(db, id);
            if (!f) return reply.code(404).send({ success: false, error: 'Sitemap file not found.' });
            reply.header('Content-Type', 'application/xml; charset=utf-8');
            reply.header('Cache-Control', 'public, max-age=300, s-maxage=600');
            reply.header('X-Robots-Tag', 'noindex');
            return reply.send(wrapXml(f.xml_content));
        } catch (err) {
            log.error({ err: err.message, id }, 'public sitemap file failed');
            return reply.code(500).send({ success: false, error: 'Failed to serve file.' });
        }
    });

    // ── GET /sitemap-:id.xml.gz ────────────────────────────────────────────
    fastify.get('/sitemap-:id.xml.gz', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) return reply.code(400).send({ success: false, error: 'Invalid id.' });
        try {
            const f = await getFile(db, id);
            if (!f) return reply.code(404).send({ success: false, error: 'Sitemap file not found.' });
            // Pre-gzipped bytes were stored at save-time; if missing, gzip on the fly
            let buf;
            if (f.gzip_content && f.gzip_content.length) {
                buf = Buffer.isBuffer(f.gzip_content) ? f.gzip_content : Buffer.from(f.gzip_content);
            } else {
                buf = renderGzipped(f.xml_content);
            }
            reply.header('Content-Type', 'application/gzip');
            reply.header('Cache-Control', 'public, max-age=300, s-maxage=600');
            reply.header('X-Robots-Tag', 'noindex');
            reply.header('Content-Disposition', `inline; filename="sitemap-${id}.xml.gz"`);
            return reply.send(buf);
        } catch (err) {
            log.error({ err: err.message, id }, 'public gz sitemap failed');
            return reply.code(500).send({ success: false, error: 'Failed to serve gz sitemap.' });
        }
    });

    // ── GET /sitemap.xsl ────────────────────────────────────────────────────
    fastify.get('/sitemap.xsl', async (request, reply) => {
        reply.header('Content-Type', 'text/xsl; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=86400, immutable');
        return reply.send(renderXslStylesheet());
    });

    // ── GET /robots.txt?clientId=X ─────────────────────────────────────────
    fastify.get('/robots.txt', {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        const clientId = request.query.clientId;
        const base = `${request.protocol}://${request.headers.host}`;
        const sitemapUrl = clientId ? `${base}/sitemap.xml?clientId=${encodeURIComponent(clientId)}` : `${base}/sitemap.xml`;
        const body = renderRobotsTxt({ sitemapUrl });
        reply.header('Content-Type', 'text/plain; charset=utf-8');
        reply.header('Cache-Control', 'public, max-age=600');
        return reply.send(body);
    });
}

module.exports = sitemapRoutes;
