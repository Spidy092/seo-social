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
        `SELECT p.id, p.name, p.client_id, p.tracking_domain, p.target_location,
                c.name AS client_name, c.website_url, c.gsc_site_url,
                c.ga4_property_id, c.agency_id, c.target_locations
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
        projectTargetLocation: r.target_location,
        clientTargetLocations: Array.isArray(r.target_locations) ? r.target_locations : [],
    };
}

// ─── Location resolution ───────────────────────────────────────────────────

/**
 * Resolve the most specific client location to use for Serper.
 *   1. Most common `keywords.location` value across the project's tracked keywords
 *   2. `seo_projects.target_location` (TEXT, the project's primary market)
 *   3. First element of `seo_clients.target_locations` (JSONB array)
 *   4. "India" (final fallback — most clients are India-based)
 *
 * Returns the resolved location string. Always returns non-null.
 */
async function resolveClientLocation(db, ctx) {
    try {
        const { rows } = await db.query(
            `SELECT k.location, COUNT(*) AS n
             FROM seo_project_keywords spk
             JOIN keywords k ON k.id = spk.keyword_id
             WHERE spk.project_id = $1 AND k.location IS NOT NULL AND k.location <> ''
             GROUP BY k.location
             ORDER BY n DESC, k.location ASC
             LIMIT 1`,
            [ctx.projectId],
        );
        if (rows.length && rows[0].location) return rows[0].location;
    } catch {
        // table may not exist on legacy DBs — fall through
    }
    if (ctx.projectTargetLocation) return ctx.projectTargetLocation;
    if (ctx.clientTargetLocations && ctx.clientTargetLocations.length) {
        return ctx.clientTargetLocations[0];
    }
    return 'India';
}

/**
 * Build the `gl` (country code) and `hl` (interface language) for Serper
 * from a free-form location string. Falls back to in/en for India.
 */
function locationToSerperParams(location) {
    const v = String(location || '').toLowerCase().trim();
    if (!v) return { gl: 'in', hl: 'en' };
    // India + most Indian cities → gl=in, hl=en
    if (v.includes('india') || v.includes('bengaluru') || v.includes('bangalore')
        || v.includes('mumbai') || v.includes('delhi') || v.includes('chennai')
        || v.includes('hyderabad') || v.includes('kolkata') || v.includes('pune')
        || v.includes('coimbatore') || v.includes('tamil nadu') || v.includes('karnataka')
        || v.includes('maharashtra') || v.includes('gujarat') || v.includes('kerala')) {
        return { gl: 'in', hl: 'en' };
    }
    if (v.includes('united states') || v === 'us' || v.includes('usa')) return { gl: 'us', hl: 'en' };
    if (v.includes('united kingdom') || v === 'uk') return { gl: 'gb', hl: 'en' };
    if (v.includes('canada')) return { gl: 'ca', hl: 'en' };
    if (v.includes('australia')) return { gl: 'au', hl: 'en' };
    if (v.includes('germany') || v.includes('deutschland')) return { gl: 'de', hl: 'de' };
    if (v.includes('france')) return { gl: 'fr', hl: 'fr' };
    if (v.includes('spain') || v.includes('españa')) return { gl: 'es', hl: 'es' };
    if (v.includes('italy') || v.includes('italia')) return { gl: 'it', hl: 'it' };
    if (v.includes('brazil') || v.includes('brasil')) return { gl: 'br', hl: 'pt' };
    if (v.includes('japan') || v.includes('日本')) return { gl: 'jp', hl: 'ja' };
    if (v.includes('singapore')) return { gl: 'sg', hl: 'en' };
    if (v.includes('uae') || v.includes('dubai')) return { gl: 'ae', hl: 'en' };
    return { gl: 'in', hl: 'en' };
}

function serperLocationString(location) {
    // Serper's `location` param expects "City, State, Country" or "City, Country"
    // We always append ", India" if no country is in the string and the
    // resolved gl is 'in' (the default). For other regions, append a sensible
    // country string.
    const v = String(location || '').trim();
    if (!v) return 'India';
    const lower = v.toLowerCase();
    const hasCountry = ['india', 'united states', 'usa', 'us', 'united kingdom', 'uk',
        'canada', 'australia', 'germany', 'france', 'spain', 'italy', 'brazil',
        'japan', 'singapore', 'uae'].some(c => lower.includes(c));
    if (hasCountry) return v;
    // No country in the string → assume India (the dominant client base)
    return `${v}, India`;
}

// ─── Cache helpers ─────────────────────────────────────────────────────────

async function getCachedSnapshot(db, { projectId, targetUrl, location }) {
    // Location is part of the cache key — "ENT surgery" from Chennai and
    // "ENT surgery" from Coimbatore return different rankings. When the
    // caller didn't specify a location, we fall back to '' so all
    // location-less lookups share the same cache slot.
    const loc = location || '';
    const { rows } = await db.query(
        `SELECT id, source, count, payload, checked_at, expires_at, location
         FROM ranked_keyword_snapshots
         WHERE project_id = $1 AND target_url = $2 AND COALESCE(location, '') = $3
           AND expires_at > NOW()
         ORDER BY checked_at DESC
         LIMIT 1`,
        [projectId, targetUrl, loc],
    );
    return rows[0] || null;
}

async function persistSnapshot(db, snapshot) {
    const { rows } = await db.query(
        `INSERT INTO ranked_keyword_snapshots
            (project_id, client_id, agency_id, target_url, source, count, payload, location, checked_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
         RETURNING id, checked_at, expires_at`,
        [
            snapshot.projectId,
            snapshot.clientId,
            snapshot.agencyId,
            snapshot.targetUrl,
            snapshot.source,
            snapshot.count,
            JSON.stringify({ keywords: snapshot.keywords }),
            snapshot.location || null,
            snapshot.expiresAt,
        ],
    );
    return rows[0];
}

/**
 * Get the *previous* (non-expired) snapshot for the same (project, url, location),
 * used to compute the "vs last check" delta. Returns the most recent snapshot
 * whose `checked_at` is older than the current one — i.e. the immediately
 * preceding live lookup.
 */
async function getPreviousSnapshot(db, { projectId, targetUrl, location, before }) {
    const loc = location || '';
    const { rows } = await db.query(
        `SELECT id, source, count, payload, checked_at, expires_at, location
         FROM ranked_keyword_snapshots
         WHERE project_id = $1 AND target_url = $2 AND COALESCE(location, '') = $3
           AND checked_at < $4
         ORDER BY checked_at DESC
         LIMIT 1`,
        [projectId, targetUrl, loc, before || new Date()],
    );
    return rows[0] || null;
}

/**
 * Look up the set of keyword strings already tracked for this project.
 * Returns a Set of lowercased keyword strings. Used for the
 * "show untracked only" filter and for the promote endpoint.
 */
async function getProjectTrackedKeywords(db, projectId) {
    try {
        const { rows } = await db.query(
            `SELECT LOWER(k.keyword) AS k
             FROM seo_project_keywords spk
             JOIN keywords k ON k.id = spk.keyword_id
             WHERE spk.project_id = $1`,
            [projectId],
        );
        return new Set(rows.map((r) => r.k).filter(Boolean));
    } catch {
        return new Set();
    }
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
async function lookupBySerper(db, { projectId, targetUrl, location }) {
    const norm = normalizeTargetUrl(targetUrl);
    const host = extractHost(targetUrl);
    if (!host) return { source: 'serper', keywords: [] };

    // Resolve search geo from the project's most-specific location
    const { gl, hl } = locationToSerperParams(location);
    const serperLocation = serperLocationString(location);

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
    } catch {
        // table may not exist on legacy DBs
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
                {
                    q: query,
                    gl,
                    hl,
                    location: serperLocation,
                    num: 100,
                },
                { source: 'ranked-kw', projectId, host, location: serperLocation },
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
    const { projectId, forceRefresh = false, url: urlOverride, location: locationOverride } = opts;
    if (!projectId) throw new Error('projectId is required');

    const ctx = await loadProjectContext(db, projectId);
    if (!ctx) return { source: 'none', url: '', count: 0, keywords: [], checkedAt: null, cached: false, location: null };

    const clientId = opts.clientId || ctx.clientId;
    const agencyId = opts.agencyId || ctx.agencyId;

    // Resolve URL: explicit override → project tracking_domain → client website
    const rawUrl = urlOverride || ctx.trackingDomain || ctx.clientWebsite || '';
    const targetUrl = normalizeTargetUrl(rawUrl);

    // Resolve location: explicit override → most-common keyword location
    // → project target_location → first client target_locations element → "India"
    const location = (locationOverride && String(locationOverride).trim())
        || await resolveClientLocation(db, ctx);

    if (!targetUrl) {
        return {
            source: 'none',
            url: '',
            count: 0,
            keywords: [],
            checkedAt: null,
            cached: false,
            location,
        };
    }

    // 1. Cache hit?
    if (!forceRefresh) {
        try {
            const cached = await getCachedSnapshot(db, { projectId, targetUrl, location });
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
                    location: cached.location || location,
                };
            }
        } catch (err) {
            log.warn({ err: err.message, projectId, targetUrl, location }, 'cache read failed; proceeding to live lookup');
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
        result = await lookupBySerper(db, { projectId, targetUrl, location });
        if (result.keywords.length === 0) {
            log.info({ projectId, targetUrl, location }, 'ranked-kw: serper had no data, falling back to rank_tracker');
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
            location,
            expiresAt,
        });
        checkedAt = inserted.checked_at || checkedAt;
    } catch (err) {
        log.warn({ err: err.message, projectId, targetUrl }, 'snapshot persist failed; returning live result anyway');
    }

    // 5. Compute delta against the previous snapshot for the same key
    let delta = null;
    try {
        const prev = await getPreviousSnapshot(db, { projectId, targetUrl, location, before: checkedAt });
        if (prev) {
            const prevPayload = prev.payload || {};
            const prevKeywords = Array.isArray(prevPayload.keywords) ? prevPayload.keywords : [];
            const prevSet = new Set(prevKeywords.map((k) => String(k.keyword).toLowerCase()));
            const currSet = new Set(result.keywords.map((k) => String(k.keyword).toLowerCase()));
            const newKeywords = result.keywords.filter((k) => !prevSet.has(String(k.keyword).toLowerCase()));
            const lostKeywords = prevKeywords
                .filter((k) => !currSet.has(String(k.keyword).toLowerCase()))
                .map((k) => k.keyword);
            delta = {
                previousCheckedAt: prev.checked_at,
                previousCount: Number(prev.count) || prevKeywords.length,
                delta: result.keywords.length - (Number(prev.count) || prevKeywords.length),
                newCount: newKeywords.length,
                lostCount: lostKeywords.length,
                newKeywords: newKeywords.slice(0, 10).map((k) => k.keyword),
                lostKeywords: lostKeywords.slice(0, 10),
            };
        }
    } catch (err) {
        log.warn({ err: err.message, projectId, targetUrl }, 'delta computation failed; continuing without it');
    }

    // 6. Compute the set of already-tracked keywords (for the
    //    "show untracked only" filter in the UI)
    let trackedKeywords = [];
    try {
        const tracked = await getProjectTrackedKeywords(db, projectId);
        trackedKeywords = Array.from(tracked);
    } catch {
        // tolerate missing table
    }

    return {
        source: result.source,
        url: targetUrl,
        count: result.keywords.length,
        keywords: result.keywords,
        checkedAt,
        cached: false,
        location,
        delta,
        trackedKeywords,
    };
}

module.exports = {
    getRankedKeywords,
    normalizeTargetUrl,
    extractHost,
    resolveClientLocation,
    locationToSerperParams,
    serperLocationString,
    getProjectTrackedKeywords,
    // exported for tests
    _lookupByGsc: lookupByGsc,
    _lookupBySerper: lookupBySerper,
    _lookupByRankTracker: lookupByRankTracker,
};
