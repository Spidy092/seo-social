/**
 * Google Analytics 4 Service — Service Account Auth
 *
 * Uses googleapis Analytics Data API with server-to-server service account
 * auth. No OAuth flow is required.
 */

const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');
const { readServiceAccountJson } = require('../utils/googleServiceAccount');
const { normalizeUrl, buildAbsoluteUrl } = require('../utils/urlNormalize');
const { isoDate } = require('./gscService');

const log = createLogger('ga4-service');

function normalizePropertyId(value) {
    return String(value || '').trim().replace(/^properties\//, '');
}

function getAuthClient() {
    const credentials = readServiceAccountJson({
        fallbackEnv: 'GA4_SERVICE_ACCOUNT_JSON',
        label: 'GA4',
    });
    return new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
}

function getAnalyticsDataClient() {
    return google.analyticsdata({ version: 'v1beta', auth: getAuthClient() });
}

async function runReport({ propertyId, startDate, endDate, dimensions = [], metrics = [], limit = 1000 }) {
    const analyticsData = getAnalyticsDataClient();
    const cleanPropertyId = normalizePropertyId(propertyId);
    if (!cleanPropertyId) throw new Error('GA4 propertyId is required');

    const res = await analyticsData.properties.runReport({
        property: `properties/${cleanPropertyId}`,
        requestBody: {
            dateRanges: [{ startDate, endDate }],
            dimensions: dimensions.map(name => ({ name })),
            metrics: metrics.map(name => ({ name })),
            limit,
        },
    });

    return res.data || {};
}

function getDimension(row, headers, name) {
    const index = headers.findIndex(header => header.name === name);
    return index >= 0 ? row.dimensionValues?.[index]?.value || null : null;
}

function getMetric(row, headers, name) {
    const index = headers.findIndex(header => header.name === name);
    const raw = index >= 0 ? row.metricValues?.[index]?.value : null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
}

function mapPageRow(row, response, { propertyId, startDate, endDate, baseUrl }) {
    const dimensionHeaders = response.dimensionHeaders || [];
    const metricHeaders = response.metricHeaders || [];
    const landingPage = getDimension(row, dimensionHeaders, 'landingPagePlusQueryString')
        || getDimension(row, dimensionHeaders, 'pagePath')
        || getDimension(row, dimensionHeaders, 'pageLocation');
    const pageUrl = getDimension(row, dimensionHeaders, 'pageLocation') || buildAbsoluteUrl(landingPage, baseUrl);

    return {
        propertyId: normalizePropertyId(propertyId),
        dateStart: startDate,
        dateEnd: endDate,
        pagePath: getDimension(row, dimensionHeaders, 'pagePath') || landingPage,
        pageUrl,
        normalizedUrl: normalizeUrl(pageUrl || landingPage, baseUrl),
        landingPage,
        sourceMedium: getDimension(row, dimensionHeaders, 'sessionSourceMedium'),
        channelGroup: getDimension(row, dimensionHeaders, 'sessionDefaultChannelGroup'),
        deviceCategory: getDimension(row, dimensionHeaders, 'deviceCategory'),
        country: getDimension(row, dimensionHeaders, 'country'),
        city: getDimension(row, dimensionHeaders, 'city'),
        sessions: Math.round(getMetric(row, metricHeaders, 'sessions')),
        users: Math.round(getMetric(row, metricHeaders, 'totalUsers')),
        newUsers: Math.round(getMetric(row, metricHeaders, 'newUsers')),
        views: Math.round(getMetric(row, metricHeaders, 'screenPageViews')),
        bounceRate: getMetric(row, metricHeaders, 'bounceRate') * 100,
        engagementRate: getMetric(row, metricHeaders, 'engagementRate') * 100,
        avgSessionDuration: getMetric(row, metricHeaders, 'averageSessionDuration'),
        conversions: getMetric(row, metricHeaders, 'conversions'),
        eventCount: Math.round(getMetric(row, metricHeaders, 'eventCount')),
        revenue: getMetric(row, metricHeaders, 'totalRevenue'),
        raw: row,
    };
}

async function syncGa4Performance(db, { clientId, userId = null, agencyId = null, propertyId, baseUrl, days = 30 }) {
    const cleanPropertyId = normalizePropertyId(propertyId);
    if (!clientId) throw new Error('clientId is required for GA4 sync');
    if (!cleanPropertyId) throw new Error('propertyId is required for GA4 sync');

    const endDate = isoDate(1);
    const startDate = isoDate(Math.max(1, Number(days) || 30));

    log.info({ clientId, propertyId: cleanPropertyId, startDate, endDate }, 'GA4 sync started');

    const response = await runReport({
        propertyId: cleanPropertyId,
        startDate,
        endDate,
        dimensions: [
            'landingPagePlusQueryString',
            'pagePath',
            'sessionDefaultChannelGroup',
            'sessionSourceMedium',
            'deviceCategory',
            'country',
            'city',
        ],
        metrics: [
            'sessions',
            'totalUsers',
            'newUsers',
            'screenPageViews',
            'bounceRate',
            'engagementRate',
            'averageSessionDuration',
            'conversions',
            'eventCount',
            'totalRevenue',
        ],
        limit: 5000,
    });

    const rows = (response.rows || [])
        .map(row => mapPageRow(row, response, { propertyId: cleanPropertyId, startDate, endDate, baseUrl }))
        .filter(row => row.normalizedUrl);

    await db.query(
        `DELETE FROM ga4_page_analytics
         WHERE client_id = $1 AND property_id = $2 AND date_start = $3 AND date_end = $4`,
        [clientId, cleanPropertyId, startDate, endDate]
    );

    for (const row of rows) {
        await db.query(
            `INSERT INTO ga4_page_analytics
             (user_id, agency_id, client_id, property_id, date_start, date_end,
              page_path, page_url, normalized_url, landing_page, source_medium, channel_group,
              device_category, country, city, sessions, users, new_users, views,
              bounce_rate, engagement_rate, avg_session_duration, conversions, event_count, revenue, raw)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26::jsonb)`,
            [
                userId, agencyId, clientId, row.propertyId, row.dateStart, row.dateEnd,
                row.pagePath, row.pageUrl, row.normalizedUrl, row.landingPage,
                row.sourceMedium, row.channelGroup, row.deviceCategory, row.country, row.city,
                row.sessions, row.users, row.newUsers, row.views,
                row.bounceRate, row.engagementRate, row.avgSessionDuration,
                row.conversions, row.eventCount, row.revenue, JSON.stringify(row.raw),
            ]
        );
    }

    await db.query(
        `UPDATE seo_clients
         SET ga4_property_id = $1, ga4_last_synced_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [cleanPropertyId, clientId]
    );

    log.info({ clientId, rows: rows.length }, 'GA4 sync complete');
    return { propertyId: cleanPropertyId, startDate, endDate, rows: rows.length };
}

async function getOverview(db, clientId) {
    const res = await db.query(
        `SELECT
            COALESCE(SUM(sessions), 0) AS sessions,
            COALESCE(SUM(users), 0) AS users,
            COALESCE(SUM(new_users), 0) AS new_users,
            COALESCE(SUM(views), 0) AS views,
            ROUND(COALESCE(AVG(bounce_rate), 0)::numeric, 2) AS bounce_rate,
            ROUND(COALESCE(AVG(engagement_rate), 0)::numeric, 2) AS engagement_rate,
            ROUND(COALESCE(AVG(avg_session_duration), 0)::numeric, 2) AS avg_session_duration,
            COALESCE(SUM(conversions), 0) AS conversions,
            COALESCE(SUM(revenue), 0) AS revenue
         FROM ga4_page_analytics
         WHERE client_id = $1
           AND date_start = (SELECT MAX(date_start) FROM ga4_page_analytics WHERE client_id = $1)`,
        [clientId]
    );
    return res.rows[0] || {};
}

async function getTopPages(db, clientId, limit = 20) {
    const res = await db.query(
        `SELECT normalized_url, MAX(page_url) AS page_url,
            SUM(sessions) AS sessions,
            SUM(users) AS users,
            SUM(views) AS views,
            ROUND(AVG(bounce_rate)::numeric, 2) AS bounce_rate,
            ROUND(AVG(avg_session_duration)::numeric, 2) AS avg_session_duration,
            SUM(conversions) AS conversions,
            SUM(revenue) AS revenue
         FROM ga4_page_analytics
         WHERE client_id = $1
           AND date_start = (SELECT MAX(date_start) FROM ga4_page_analytics WHERE client_id = $1)
         GROUP BY normalized_url
         ORDER BY sessions DESC
         LIMIT $2`,
        [clientId, limit]
    );
    return res.rows;
}

async function getBreakdown(db, clientId, field, limit = 20) {
    const allowed = new Set(['device_category', 'country', 'city', 'source_medium', 'channel_group']);
    if (!allowed.has(field)) throw new Error('Unsupported GA4 breakdown field');

    const res = await db.query(
        `SELECT ${field} AS name,
            SUM(sessions) AS sessions,
            SUM(users) AS users,
            ROUND(AVG(bounce_rate)::numeric, 2) AS bounce_rate,
            SUM(conversions) AS conversions
         FROM ga4_page_analytics
         WHERE client_id = $1
           AND ${field} IS NOT NULL
           AND date_start = (SELECT MAX(date_start) FROM ga4_page_analytics WHERE client_id = $1)
         GROUP BY ${field}
         ORDER BY sessions DESC
         LIMIT $2`,
        [clientId, limit]
    );
    return res.rows;
}

module.exports = {
    normalizePropertyId,
    getAuthClient,
    runReport,
    syncGa4Performance,
    getOverview,
    getTopPages,
    getDeviceBreakdown: (db, clientId) => getBreakdown(db, clientId, 'device_category', 20),
    getCountryBreakdown: (db, clientId) => getBreakdown(db, clientId, 'country', 50),
    getSourceBreakdown: (db, clientId) => getBreakdown(db, clientId, 'source_medium', 50),
};
