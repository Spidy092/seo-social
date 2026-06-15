/**
 * Ranked Keywords Service
 *
 * Answers: "What keywords is this URL/domain ACTUALLY ranking for right now,
 * including ones we never explicitly tracked?"
 *
 * Tries three sources in order, returns the first one that yields data:
 *   1. Google Search Console (gsc_search_analytics, by-page rows)
 *   2. Serper.dev (site:domain searches using the project's seed keywords)
 *   3. Internal rank tracker (domain_rankings joined to keywords)
 *
 * Caches results in `ranked_keyword_snapshots` for `rankedKwCacheHours`
 * (default 6, configurable via audit_settings_global). The Refresh button
 * bypasses the cache via `forceRefresh: true`.
 *
 * The response always carries `source` so the UI can render an honest badge
 * — `gsc` / `serper` / `rank_tracker` / `cache`. An empty result with a
 * non-cache source means "this source ran and returned no data" (NOT a
 * hard error), so we return 200 + an empty list, never a 500.
 */

const { createLogger } = require('../utils/logger');
const auditSettings = require('./auditSettings');
const keywordService = require('./keywordService');

const log = createLogger('ranked-kw');

// ─── URL normalisation ─────────────────────────────────────────────────────

/**
 * Canonicalise a URL/domain to a string suitable for comparison and for use
 * as a snapshot cache key. We accept either "example.com",
 * "https://example.com", "example.com/path", etc. and return
 *   "example.com"            (when input is host-only)
 *   "example.com/path/..."   (when input has a path; lowercased host,
 *                             trailing slash preserved as-is)
 */
function normalizeTargetUrl(input) {
    if (input === null || input === undefined) return '';
    let value = String(input).trim().toLowerCase();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
        const url = new URL(value);
        const host = url.hostname.replace(/^www\./, '');
        const path = url.pathname || '';
        const query = url.search || '';
        // Drop empty "/" suffix for host-only; keep it for sub-paths
        const tail = path === '/' && !query ? '' : path + query;
        return `${host}${tail}`;
    } catch {
        // Fallback: strip scheme and trailing slash
        return value.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    }
}

function extractHost(input) {
    const norm = normalizeTargetUrl(input);
    if (!norm) return '';
    const slash = norm.indexOf('/');
    return slash === -1 ? norm : norm.slice(0, slash);
}

function _buildSiteUrlVariants(input) {
    // GSC `page` strings can be either https://www.example.com/path or
    // https://example.com/path — we want to match both shapes.
    const norm = normalizeTargetUrl(input);
    if (!norm) return [];
    const variants = new Set([norm]);
    if (!norm.startsWith('www.')) variants.add(`www.${norm}`);
    return Array.from(variants);
}

// ─── Project context loader ───────────────────────────────────────────────

async function loadProjectContext(db, projectId) {
    const { rows } = await db.query(
        `SELECT p.id, p.name, p.client_id, p.tracking_domain,
                c.name AS client_name, c.website_url, c.gsc_site_url,
                c.ga4_property_id, c.agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1`,
        [projectId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
        projectId: r.id,
        projectName: r.name,
        clientId: r.client_id,
        agencyId: r.agency_id,
        clientName: r.client_name,
        clientWebsite: r.website_url,
        clientGscSiteUrl: r.gsc_site_url,
        trackingDomain: r.tracking_domain,
    };
}

// ─── Cache helpers ─────────────────────────────────────────────────────────

async function getCachedSnapshot(db, { projectId, targetUrl }) {
    const { rows } = await db.query(
        `SELECT id, source, count, payload, checked_at, expires_at
         FROM ranked_keyword_snapshots
         WHERE project_id = $1 AND target_url = $2
           AND expires_at > NOW()
         ORDER BY checked_at DESC
         LIMIT 1`,
        [projectId, targetUrl],
    );
    return rows[0] || null;
}

async function persistSnapshot(db, snapshot) {
    const { rows } = await db.query(
        `INSERT INTO ranked_keyword_snapshots
            (project_id, client_id, agency_id, target_url, source, count, payload, checked_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
         RETURNING id, checked_at, expires_at`,
        [
            snapshot.projectId,
            snapshot.clientId,
            snapshot.agencyId,
            snapshot.targetUrl,
            snapshot.source,
            snapshot.count,
            JSON.stringify({ keywords: snapshot.keywords }),
            snapshot.expiresAt,
        ],
    );
    return rows[0];
}

// ─── Source 1: Google Search Console ───────────────────────────────────────

/**
 * Group GSC `query` rows by query for a given page filter. We don't have a
 * reliable "page = $url" match in the table — `page` can have a trailing
 * slash, fragment, or query string we didn't type. So we use `LIKE` against
 * the host + leading-path portion of the input URL.
 */
async function lookupByGsc(db, { clientId, targetUrl }) {
    if (!clientId || !targetUrl) return { source: 'gsc', keywords: [] };

    const norm = normalizeTargetUrl(targetUrl);
    const host = extractHost(targetUrl);
    if (!host) return { source: 'gsc', keywords: [] };

    // We try two strategies: exact path-prefix match, then host-wide scan.
    // Whichever yields rows is used; if both yield rows, prefer the more
    // specific (path-prefix) one.
    const pathPart = norm.slice(host.length); // includes leading "/" or ""
    const isPathScoped = pathPart && pathPart !== '/';
    const likePattern = isPathScoped
        ? `%${host}${pathPart.replace(/'/g, "''")}%`
        : `%${host}%`;

    try {
        const { rows } = await db.query(
            `SELECT query,
                    SUM(clicks)                              AS clicks,
                    SUM(impressions)                         AS impressions,
                    ROUND(AVG(ctr)::numeric, 4)              AS ctr,
                    ROUND(AVG(position)::numeric, 1)         AS position
             FROM gsc_search_analytics
             WHERE client_id = $1
               AND dimension_type = 'query'
               AND query IS NOT NULL
               AND (page ILIKE $2 OR normalized_url ILIKE $2)
             GROUP BY query
             ORDER BY impressions DESC, clicks DESC
             LIMIT 200`,
            [clientId, likePattern],
        );

        if (!rows.length) return { source: 'gsc', keywords: [] };

        const keywords = rows.map((r) => ({
            keyword: r.query,
            position: r.position ? Number(r.position) : null,
            url: null,
            clicks: r.clicks ? Number(r.clicks) : 0,
            impressions: r.impressions ? Number(r.impressions) : 0,
        }));
        return { source: 'gsc', keywords };
    } catch (err) {
        log.warn({ err: err.message, clientId, targetUrl }, 'gsc lookup failed');
        return { source: 'gsc', keywords: [], error: err.message };
    }
}

// ─── Source 2: Serper ──────────────────────────────────────────────────────

/**
 * Use Serper to ask "what queries does this URL appear on?". We do this by:
 *   - taking up to 5 of the project's highest-priority target keywords as seeds
 *   - searching `site:domain <seed>` for each
 *   - filtering: keep only organic results whose `link` matches our target URL
 *   - the seed keyword IS the keyword this URL ranks for, at Serper's position
 *
 * If the project has zero target keywords, we run a single `site:domain`
 * search and return the searchQuery as a single "the domain ranks for this
 * navigational query" entry.
 */
async function lookupBySerper(db, { projectId, targetUrl }) {
    const norm = normalizeTargetUrl(targetUrl);
    const host = extractHost(targetUrl);
    if (!host) return { source: 'serper', keywords: [] };

    // Pull up to 5 target keyword seeds
    let seeds = [];
    try {
        const { rows } = await db.query(
            `SELECT k.keyword
             FROM seo_project_keywords spk
             JOIN keywords k ON k.id = spk.keyword_id
             WHERE spk.project_id = $1
             ORDER BY spk.priority_score DESC, k.search_volume DESC NULLS LAST
             LIMIT 5`,
            [projectId],
        );
        seeds = rows.map((r) => r.keyword).filter(Boolean);
    } catch (err) {
        log.warn({ err: err.message, projectId }, 'serper seed keyword fetch failed');
    }

    // If no project seeds, fall back to brand-ish queries derived from host
    if (!seeds.length) {
        const brand = host.split('.')[0];
        seeds = [host, brand, `${brand} services`].filter(Boolean);
    }

    const seen = new Set(); // dedupe by keyword
    const matched = [];

    for (const seed of seeds) {
        const query = `site:${host} ${seed}`.trim();
        try {
            const data = await keywordService.postSerperSearch(
                { q: query, gl: 'in', hl: 'en', num: 20 },
                { source: 'ranked-kw', projectId, host },
            );
            const organic = Array.isArray(data.organic) ? data.organic : [];
            for (const row of organic) {
                if (!row || !row.link) continue;
                if (!urlMatchesTarget(row.link, norm, host)) continue;
                const pos = Number(row.position);
                if (!Number.isFinite(pos) || pos <= 0) continue;
                const key = (row.title || seed).toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                matched.push({
                    keyword: seed,
                    position: pos,
                    url: row.link,
                    title: row.title || null,
                });
            }
        } catch (err) {
            // Quota exhausted, no keys, etc. — log and keep trying the next seed
            log.warn({ err: err.message, query, projectId }, 'serper seed search failed');
        }
    }

    // Sort by position ascending
    matched.sort((a, b) => (a.position || 999) - (b.position || 999));

    return { source: 'serper', keywords: matched.slice(0, 200) };
}

function urlMatchesTarget(link, targetUrl, host) {
    if (!link) return false;
    try {
        const u = new URL(link);
        const linkHost = u.hostname.replace(/^www\./, '').toLowerCase();
        if (linkHost !== host) return false;
        // If target is host-only, any path on the same host matches
        if (!targetUrl.includes('/')) return true;
        // If target has a path, accept any link whose path starts with it
        const targetPath = targetUrl.slice(host.length);
        const linkPath = u.pathname || '/';
        return linkPath === targetPath || linkPath.startsWith(targetPath.replace(/\/$/, '') + '/') || linkPath === targetPath + '/';
    } catch {
        return false;
    }
}

// ─── Source 3: Internal rank tracker ───────────────────────────────────────

async function lookupByRankTracker(db, { projectId, targetUrl }) {
    const host = extractHost(targetUrl);
    if (!host) return { source: 'rank_tracker', keywords: [] };

    try {
        // First try the project's own domain_rankings (preferred — fresh)
        const { rows: projectRows } = await db.query(
            `SELECT DISTINCT ON (dr.keyword_id)
                    dr.keyword_id, dr.rank_position, dr.url, dr.checked_at,
                    k.keyword, k.location, k.search_volume, k.difficulty
             FROM domain_rankings dr
             JOIN keywords k ON k.id = dr.keyword_id
             WHERE dr.project_id = $1
               AND (dr.domain = $2 OR dr.domain LIKE '%' || $2)
               AND dr.rank_position > 0
             ORDER BY dr.keyword_id, dr.checked_at DESC`,
            [projectId, host],
        );

        if (projectRows.length) {
            return {
                source: 'rank_tracker',
                keywords: projectRows
                    .map((r) => ({
                        keyword: r.keyword,
                        position: r.rank_position ? Number(r.rank_position) : null,
                        url: r.url || null,
                        searchVolume: r.search_volume || 0,
                        difficulty: r.difficulty || 0,
                    }))
                    .sort((a, b) => (a.position || 999) - (b.position || 999))
                    .slice(0, 200),
            };
        }

        // Fall back to the legacy `competitors` / `ranking_pages` tables
        // for projects that haven't been re-tracked under the new schema
        const { rows: rankRows } = await db.query(
            `SELECT DISTINCT ON (rp.keyword_id)
                    rp.keyword_id, rp.rank_position, rp.url, rp.analyzed_at,
                    k.keyword, k.location, k.search_volume, k.difficulty
             FROM ranking_pages rp
             JOIN keywords k ON k.id = rp.keyword_id
             WHERE rp.domain = $1 AND rp.rank_position > 0
             ORDER BY rp.keyword_id, rp.analyzed_at DESC
             LIMIT 200`,
            [host],
        );
        return {
            source: 'rank_tracker',
            keywords: rankRows
                .map((r) => ({
                    keyword: r.keyword,
                    position: r.rank_position ? Number(r.rank_position) : null,
                    url: r.url || null,
                    searchVolume: r.search_volume || 0,
                    difficulty: r.difficulty || 0,
                }))
                .sort((a, b) => (a.position || 999) - (b.position || 999)),
        };
    } catch (err) {
        log.warn({ err: err.message, projectId, host }, 'rank tracker lookup failed');
        return { source: 'rank_tracker', keywords: [], error: err.message };
    }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Get the keywords a URL/domain ranks for right now.
 *
 * @param {object} db
 * @param {object} opts
 * @param {string} opts.projectId   required
 * @param {string} [opts.clientId]  auto-fetched from projectId
 * @param {string} [opts.agencyId]  auto-fetched from projectId
 * @param {string} [opts.url]       override; defaults to project.tracking_domain || client.website_url
 * @param {boolean} [opts.forceRefresh]  bypass cache
 * @returns {Promise<{
 *   source: 'cache' | 'gsc' | 'serper' | 'rank_tracker',
 *   url: string,
 *   count: number,
 *   keywords: Array<{ keyword, position, url, clicks?, impressions?, searchVolume?, difficulty? }>,
 *   checkedAt: string|null,
 *   cached: boolean,
 * }>}
 */
async function getRankedKeywords(db, opts = {}) {
    const { projectId, forceRefresh = false, url: urlOverride } = opts;
    if (!projectId) throw new Error('projectId is required');

    const ctx = await loadProjectContext(db, projectId);
    if (!ctx) return { source: 'none', url: '', count: 0, keywords: [], checkedAt: null, cached: false };

    const clientId = opts.clientId || ctx.clientId;
    const agencyId = opts.agencyId || ctx.agencyId;

    // Resolve URL: explicit override → project tracking_domain → client website
    const rawUrl = urlOverride || ctx.trackingDomain || ctx.clientWebsite || '';
    const targetUrl = normalizeTargetUrl(rawUrl);
    if (!targetUrl) {
        return {
            source: 'none',
            url: '',
            count: 0,
            keywords: [],
            checkedAt: null,
            cached: false,
        };
    }

    // 1. Cache hit?
    if (!forceRefresh) {
        try {
            const cached = await getCachedSnapshot(db, { projectId, targetUrl });
            if (cached) {
                const payload = cached.payload || {};
                const keywords = Array.isArray(payload.keywords) ? payload.keywords : [];
                return {
                    source: 'cache',
                    url: targetUrl,
                    count: Number(cached.count) || keywords.length,
                    keywords,
                    checkedAt: cached.checked_at,
                    cached: true,
                };
            }
        } catch (err) {
            log.warn({ err: err.message, projectId, targetUrl }, 'cache read failed; proceeding to live lookup');
        }
    }

    // 2. Run the fallback chain
    let result = { source: 'gsc', keywords: [] };

    if (ctx.clientGscSiteUrl) {
        result = await lookupByGsc(db, { clientId, targetUrl });
        if (result.error) {
            log.info({ err: result.error, projectId }, 'ranked-kw: gsc errored, falling back to serper');
        } else if (result.keywords.length === 0) {
            log.info({ projectId, targetUrl }, 'ranked-kw: gsc had no data, falling back to serper');
        }
    } else {
        log.info({ projectId, targetUrl }, 'ranked-kw: no gsc_site_url on client, skipping to serper');
    }

    if (result.keywords.length === 0 && !result.error) {
        result = await lookupBySerper(db, { projectId, targetUrl });
        if (result.keywords.length === 0) {
            log.info({ projectId, targetUrl }, 'ranked-kw: serper had no data, falling back to rank_tracker');
        }
    }

    if (result.keywords.length === 0 && !result.error) {
        result = await lookupByRankTracker(db, { projectId, targetUrl });
        if (result.keywords.length === 0) {
            log.info({ projectId, targetUrl }, 'ranked-kw: all sources returned no data');
        }
    }

    // 3. Compute expiry from global setting (default 6h)
    let ttlHours = 6;
    try {
        const g = await auditSettings.getGlobalSettings(db);
        ttlHours = g.rankedKwCacheHours ?? 6;
    } catch (err) {
        log.warn({ err: err.message }, 'failed to read rankedKwCacheHours; using default 6');
    }
    if (!Number.isFinite(ttlHours) || ttlHours <= 0) ttlHours = 6;
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

    // 4. Persist the snapshot
    let checkedAt = new Date().toISOString();
    try {
        const inserted = await persistSnapshot(db, {
            projectId,
            clientId,
            agencyId,
            targetUrl,
            source: result.source,
            count: result.keywords.length,
            keywords: result.keywords,
            expiresAt,
        });
        checkedAt = inserted.checked_at || checkedAt;
    } catch (err) {
        log.warn({ err: err.message, projectId, targetUrl }, 'snapshot persist failed; returning live result anyway');
    }

    return {
        source: result.source,
        url: targetUrl,
        count: result.keywords.length,
        keywords: result.keywords,
        checkedAt,
        cached: false,
    };
}

module.exports = {
    getRankedKeywords,
    normalizeTargetUrl,
    extractHost,
    // exported for tests
    _lookupByGsc: lookupByGsc,
    _lookupBySerper: lookupBySerper,
    _lookupByRankTracker: lookupByRankTracker,
};
