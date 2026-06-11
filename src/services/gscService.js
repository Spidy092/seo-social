/**
 * Google Search Console Service — Service Account Auth
 *
 * Uses the googleapis library with a service account JSON key.
 * No OAuth popup, no token expiry — server-to-server authentication.
 *
 * Setup (one-time):
 *  1. Google Cloud Console → IAM → Service Accounts → Create Service Account
 *  2. Keys → Add Key → JSON → download the file
 *  3. Paste the entire JSON content (as one line) into .env as GSC_SERVICE_ACCOUNT_JSON
 *  4. In each client's GSC → Settings → Users and permissions → Add user
 *     → paste the service account email → Restricted permission
 */

const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');
const { readServiceAccountJson } = require('../utils/googleServiceAccount');
const { normalizeUrl } = require('../utils/urlNormalize');

const log = createLogger('gsc-service');

// ─── Helper: ISO date string offset from today ────────────────────────────────
function isoDate(daysAgo = 0) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
}

// ─── Helper: normalise GSC property URL ──────────────────────────────────────
function normalizeSiteUrl(raw) {
    const v = String(raw || '').trim();
    if (!v) return '';
    if (v.startsWith('sc-domain:')) return v;
    const url = v.startsWith('http') ? v : `https://${v}`;
    return url.endsWith('/') ? url : `${url}/`;
}

// ─── Build Google Auth from env ───────────────────────────────────────────────
function getAuthClient() {
    const credentials = readServiceAccountJson({
        fallbackEnv: 'GSC_SERVICE_ACCOUNT_JSON',
        label: 'GSC',
    });
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
}

// ─── List all properties accessible to the service account ───────────────────
async function listProperties() {
    const auth = getAuthClient();
    const sc = google.searchconsole({ version: 'v1', auth });
    const res = await sc.sites.list();
    return (res.data.siteEntry || []).map(s => ({
        url: s.siteUrl,
        permissionLevel: s.permissionLevel,
    }));
}

// ─── Fetch search analytics rows ──────────────────────────────────────────────
async function querySearchAnalytics({ siteUrl, startDate, endDate, dimensions, rowLimit = 1000 }) {
    const auth = getAuthClient();
    const sc = google.searchconsole({ version: 'v1', auth });
    const res = await sc.searchanalytics.query({
        siteUrl: normalizeSiteUrl(siteUrl),
        requestBody: {
            startDate,
            endDate,
            dimensions,
            rowLimit,
            dataState: 'all',
        },
    });
    return res.data.rows || [];
}

// ─── Fetch submitted sitemaps ─────────────────────────────────────────────────
async function fetchSitemaps(siteUrl) {
    try {
        const auth = getAuthClient();
        const sc = google.searchconsole({ version: 'v1', auth });
        const res = await sc.sitemaps.list({ siteUrl: normalizeSiteUrl(siteUrl) });
        return res.data.sitemap || [];
    } catch (err) {
        log.warn({ err: err.message }, 'sitemap fetch failed');
        return [];
    }
}

// ─── Build in-memory summary from raw rows ───────────────────────────────────
function buildSummary(rows) {
    const queryRows = rows.filter(r => r.dimensionType === 'query');
    const pageRows  = rows.filter(r => r.dimensionType === 'page');
    const totalClicks = queryRows.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = queryRows.reduce((s, r) => s + r.impressions, 0);
    const weightedPos = queryRows.reduce((s, r) => s + r.position * r.impressions, 0);

    return {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: totalImpressions ? totalClicks / totalImpressions : 0,
        position: totalImpressions ? weightedPos / totalImpressions : null,
        topQueries: queryRows.sort((a, b) => b.clicks - a.clicks).slice(0, 10),
        topPages: pageRows.sort((a, b) => b.clicks - a.clicks).slice(0, 10),
        lowCtrPages: pageRows
            .filter(r => r.impressions >= 100 && r.ctr < 0.02)
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 10),
        quickWinKeywords: queryRows
            .filter(r => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
            .sort((a, b) => b.impressions - a.impressions)
            .slice(0, 15),
    };
}

// ─── Map raw API row to flat object ──────────────────────────────────────────
function mapRow(row, dimensionType, startDate, endDate) {
    const keys = row.keys || [];
    const page = dimensionType === 'page'
        ? keys[0] || null
        : dimensionType === 'query_page'
            ? keys[1] || null
            : null;

    return {
        dateStart: startDate,
        dateEnd: endDate,
        dimensionType,
        query: dimensionType === 'query' ? keys[0] || null : dimensionType === 'query_page' ? keys[0] || null : null,
        page,
        device: dimensionType === 'device' ? keys[0] || null : null,
        country: dimensionType === 'country' ? keys[0] || null : null,
        normalizedUrl: page ? normalizeUrl(page) : null,
        clicks: Number(row.clicks) || 0,
        impressions: Number(row.impressions) || 0,
        ctr: Number(row.ctr) || 0,
        position: Number(row.position) || 0,
    };
}

// ─── Full sync for one client (fetch + upsert into DB) ───────────────────────
async function syncGscPerformance(db, { clientId, userId, siteUrl, days = 30 }) {
    const normalizedSiteUrl = normalizeSiteUrl(siteUrl);
    if (!normalizedSiteUrl) throw new Error('siteUrl is required for GSC sync');

    // GSC data has a ~3-day lag
    const endDate   = isoDate(3);
    const startDate = isoDate(days + 3 - 1);

    log.info({ clientId, siteUrl: normalizedSiteUrl, startDate, endDate, days }, 'GSC sync started');

    const dimensions = [
        ['query', ['query'], 1000],
        ['page', ['page'], 500],
        ['query_page', ['query', 'page'], 2000],
        ['device', ['device'], 10],
        ['country', ['country'], 100],
    ];

    const resultSets = await Promise.all(
        dimensions.map(async ([dimType, dims, rowLimit]) => {
            const rawRows = await querySearchAnalytics({
                siteUrl: normalizedSiteUrl, startDate, endDate, dimensions: dims, rowLimit,
            });
            return rawRows.map(r => mapRow(r, dimType, startDate, endDate));
        })
    );
    const rows = resultSets.flat();

    // Delete old data for this sync window before inserting
    await db.query(
        `DELETE FROM gsc_search_analytics
         WHERE client_id = $1 AND site_url = $2 AND date_start = $3 AND date_end = $4`,
        [clientId, normalizedSiteUrl, startDate, endDate]
    );

    // Batch insert
    for (const row of rows) {
        await db.query(
            `INSERT INTO gsc_search_analytics
             (user_id, client_id, site_url, date_start, date_end, dimension_type,
              query, page, device, country, normalized_url, clicks, impressions, ctr, position, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
            [
                userId || null, clientId, normalizedSiteUrl,
                row.dateStart, row.dateEnd, row.dimensionType,
                row.query, row.page, row.device, row.country,
                row.normalizedUrl,
                row.clicks, row.impressions, row.ctr, row.position,
                JSON.stringify(row),
            ]
        );
    }

    // Update gsc_site_url on client
    await db.query(
        `UPDATE seo_clients SET gsc_site_url = $1, updated_at = NOW() WHERE id = $2`,
        [normalizedSiteUrl, clientId]
    );

    const summary = buildSummary(rows);
    log.info({ clientId, rows: rows.length }, 'GSC sync complete');
    return { siteUrl: normalizedSiteUrl, startDate, endDate, rows: rows.length, summary };
}

// ─── DB query helpers (for routes) ───────────────────────────────────────────

async function getOverview(db, clientId) {
    const res = await db.query(
        `SELECT
            COALESCE(SUM(clicks), 0)                              AS total_clicks,
            COALESCE(SUM(impressions), 0)                         AS total_impressions,
            ROUND(COALESCE(AVG(ctr), 0)::numeric * 100, 2)        AS avg_ctr_pct,
            ROUND(COALESCE(AVG(position), 0)::numeric, 1)         AS avg_position
         FROM gsc_search_analytics
         WHERE client_id = $1 AND dimension_type = 'query'`,
        [clientId]
    );
    return res.rows[0] || {};
}

async function getTopQueries(db, clientId, limit = 20) {
    const res = await db.query(
        `SELECT query,
            SUM(clicks)                              AS clicks,
            SUM(impressions)                         AS impressions,
            ROUND(AVG(ctr)::numeric * 100, 2)        AS ctr_pct,
            ROUND(AVG(position)::numeric, 1)         AS avg_position
         FROM gsc_search_analytics
         WHERE client_id = $1 AND dimension_type = 'query' AND query IS NOT NULL
         GROUP BY query
         ORDER BY clicks DESC
         LIMIT $2`,
        [clientId, limit]
    );
    return res.rows;
}

async function getTopPages(db, clientId, limit = 20) {
    const res = await db.query(
        `SELECT page,
            SUM(clicks)                              AS clicks,
            SUM(impressions)                         AS impressions,
            ROUND(AVG(ctr)::numeric * 100, 2)        AS ctr_pct,
            ROUND(AVG(position)::numeric, 1)         AS avg_position
         FROM gsc_search_analytics
         WHERE client_id = $1 AND dimension_type = 'page' AND page IS NOT NULL
         GROUP BY page
         ORDER BY clicks DESC
         LIMIT $2`,
        [clientId, limit]
    );
    return res.rows;
}

async function getLowCtrPages(db, clientId, minImpressions = 100, maxCtrDecimal = 0.02) {
    const res = await db.query(
        `SELECT page,
            SUM(clicks)                              AS clicks,
            SUM(impressions)                         AS impressions,
            ROUND(AVG(ctr)::numeric * 100, 2)        AS ctr_pct,
            ROUND(AVG(position)::numeric, 1)         AS avg_position
         FROM gsc_search_analytics
         WHERE client_id = $1 AND dimension_type = 'page' AND page IS NOT NULL
         GROUP BY page
         HAVING SUM(impressions) >= $2 AND AVG(ctr) < $3
         ORDER BY impressions DESC`,
        [clientId, minImpressions, maxCtrDecimal]
    );
    return res.rows;
}

async function getOpportunities(db, clientId, minPos = 8, maxPos = 20, minImpressions = 30) {
    const res = await db.query(
        `SELECT query,
            SUM(clicks)                              AS clicks,
            SUM(impressions)                         AS impressions,
            ROUND(AVG(ctr)::numeric * 100, 2)        AS ctr_pct,
            ROUND(AVG(position)::numeric, 1)         AS avg_position
         FROM gsc_search_analytics
         WHERE client_id = $1 AND dimension_type = 'query' AND query IS NOT NULL
         GROUP BY query
         HAVING AVG(position) BETWEEN $2 AND $3 AND SUM(impressions) >= $4
         ORDER BY impressions DESC`,
        [clientId, minPos, maxPos, minImpressions]
    );
    return res.rows;
}

module.exports = {
    normalizeSiteUrl,
    isoDate,
    listProperties,
    querySearchAnalytics,
    fetchSitemaps,
    buildSummary,
    syncGscPerformance,
    getOverview,
    getTopQueries,
    getTopPages,
    getLowCtrPages,
    getOpportunities,
};
