/**
 * Combined SEO Performance Service
 *
 * Joins GSC search performance with GA4 landing-page behavior by normalized URL.
 */

const db = require('../db');

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function classifyInsight(row) {
    const clicks = toNumber(row.clicks);
    const impressions = toNumber(row.impressions);
    const ctr = toNumber(row.ctr);
    const avgPosition = toNumber(row.avg_position);
    const sessions = toNumber(row.sessions);
    const bounceRate = toNumber(row.bounce_rate);
    const conversions = toNumber(row.conversions);

    if (clicks >= 100 && bounceRate >= 65) {
        return {
            type: 'high_clicks_high_bounce',
            priority: 'high',
            title: 'High clicks but weak landing page engagement',
            action: 'Improve above-the-fold content, search intent match, CTA clarity, trust signals, internal links, and page speed.',
        };
    }

    if (impressions >= 1000 && ctr < 0.02 && avgPosition <= 20) {
        return {
            type: 'high_impressions_low_ctr',
            priority: 'high',
            title: 'High impressions but low CTR',
            action: 'Rewrite the title tag and meta description with a stronger value proposition and test schema/rich result opportunities.',
        };
    }

    if (clicks >= 50 && sessions >= 50 && conversions === 0) {
        return {
            type: 'ranking_no_conversions',
            priority: 'high',
            title: 'SEO traffic is not converting',
            action: 'Add or improve conversion blocks, contact forms, sticky CTAs, proof, FAQs, offers, and lead magnets.',
        };
    }

    if (avgPosition >= 8 && avgPosition <= 20 && impressions >= 300) {
        return {
            type: 'page_two_opportunity',
            priority: 'medium',
            title: 'Page-one growth opportunity',
            action: 'Refresh content, improve topical depth, add internal links, and strengthen authority signals.',
        };
    }

    if (clicks >= 50 && bounceRate < 50 && conversions > 0) {
        return {
            type: 'good_seo_performer',
            priority: 'low',
            title: 'Strong SEO performer',
            action: 'Protect rankings and use this page as a model for weaker landing pages.',
        };
    }

    return {
        type: 'monitor',
        priority: 'low',
        title: 'Monitor performance',
        action: 'Keep monitoring search visibility, engagement, and conversions for meaningful changes.',
    };
}

function mapCombinedRow(row) {
    const insight = classifyInsight(row);
    return {
        page: row.page_url || row.gsc_page || row.normalized_url,
        normalizedUrl: row.normalized_url,
        clicks: toNumber(row.clicks),
        impressions: toNumber(row.impressions),
        ctr: toNumber(row.ctr),
        ctrPct: Math.round(toNumber(row.ctr) * 10000) / 100,
        avgPosition: toNumber(row.avg_position),
        sessions: toNumber(row.sessions),
        users: toNumber(row.users),
        views: toNumber(row.views),
        bounceRate: toNumber(row.bounce_rate),
        engagementRate: toNumber(row.engagement_rate),
        avgSessionDuration: toNumber(row.avg_session_duration),
        conversions: toNumber(row.conversions),
        revenue: toNumber(row.revenue),
        insightType: insight.type,
        priority: insight.priority,
        insightTitle: insight.title,
        recommendedAction: insight.action,
    };
}

async function getPagePerformance(database = db, clientId, { limit = 50 } = {}) {
    const res = await database.query(
        `WITH latest_gsc AS (
            SELECT MAX(date_start) AS date_start FROM gsc_search_analytics WHERE client_id = $1
         ), gsc_pages AS (
            SELECT normalized_url,
                   MAX(page) AS gsc_page,
                   SUM(clicks) AS clicks,
                   SUM(impressions) AS impressions,
                   CASE WHEN SUM(impressions) > 0 THEN SUM(clicks)::numeric / SUM(impressions) ELSE 0 END AS ctr,
                   CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions)::numeric / SUM(impressions) ELSE AVG(position) END AS avg_position
            FROM gsc_search_analytics
            WHERE client_id = $1
              AND dimension_type = 'page'
              AND normalized_url IS NOT NULL
              AND date_start = (SELECT date_start FROM latest_gsc)
            GROUP BY normalized_url
         ), latest_ga4 AS (
            SELECT MAX(date_start) AS date_start FROM ga4_page_analytics WHERE client_id = $1
         ), ga4_pages AS (
            SELECT normalized_url,
                   MAX(page_url) AS page_url,
                   SUM(sessions) AS sessions,
                   SUM(users) AS users,
                   SUM(views) AS views,
                   ROUND(AVG(bounce_rate)::numeric, 2) AS bounce_rate,
                   ROUND(AVG(engagement_rate)::numeric, 2) AS engagement_rate,
                   ROUND(AVG(avg_session_duration)::numeric, 2) AS avg_session_duration,
                   SUM(conversions) AS conversions,
                   SUM(revenue) AS revenue
            FROM ga4_page_analytics
            WHERE client_id = $1
              AND normalized_url IS NOT NULL
              AND date_start = (SELECT date_start FROM latest_ga4)
            GROUP BY normalized_url
         )
         SELECT COALESCE(g.normalized_url, a.normalized_url) AS normalized_url,
                g.gsc_page, a.page_url,
                COALESCE(g.clicks, 0) AS clicks,
                COALESCE(g.impressions, 0) AS impressions,
                COALESCE(g.ctr, 0) AS ctr,
                COALESCE(g.avg_position, 0) AS avg_position,
                COALESCE(a.sessions, 0) AS sessions,
                COALESCE(a.users, 0) AS users,
                COALESCE(a.views, 0) AS views,
                COALESCE(a.bounce_rate, 0) AS bounce_rate,
                COALESCE(a.engagement_rate, 0) AS engagement_rate,
                COALESCE(a.avg_session_duration, 0) AS avg_session_duration,
                COALESCE(a.conversions, 0) AS conversions,
                COALESCE(a.revenue, 0) AS revenue
         FROM gsc_pages g
         FULL OUTER JOIN ga4_pages a ON a.normalized_url = g.normalized_url
         ORDER BY COALESCE(g.clicks, 0) DESC, COALESCE(a.sessions, 0) DESC
         LIMIT $2`,
        [clientId, Math.max(1, Math.min(200, Number(limit) || 50))]
    );
    return res.rows.map(mapCombinedRow);
}

async function getKeywordPagePerformance(database = db, clientId, { limit = 100 } = {}) {
    const res = await database.query(
        `WITH latest_gsc AS (
            SELECT MAX(date_start) AS date_start FROM gsc_search_analytics WHERE client_id = $1
         ), latest_ga4 AS (
            SELECT MAX(date_start) AS date_start FROM ga4_page_analytics WHERE client_id = $1
         ), ga4_pages AS (
            SELECT normalized_url,
                   MAX(page_url) AS page_url,
                   SUM(sessions) AS sessions,
                   ROUND(AVG(bounce_rate)::numeric, 2) AS bounce_rate,
                   ROUND(AVG(avg_session_duration)::numeric, 2) AS avg_session_duration,
                   SUM(conversions) AS conversions
            FROM ga4_page_analytics
            WHERE client_id = $1
              AND normalized_url IS NOT NULL
              AND date_start = (SELECT date_start FROM latest_ga4)
            GROUP BY normalized_url
         )
         SELECT g.query,
                g.page AS gsc_page,
                g.normalized_url,
                a.page_url,
                SUM(g.clicks) AS clicks,
                SUM(g.impressions) AS impressions,
                CASE WHEN SUM(g.impressions) > 0 THEN SUM(g.clicks)::numeric / SUM(g.impressions) ELSE 0 END AS ctr,
                CASE WHEN SUM(g.impressions) > 0 THEN SUM(g.position * g.impressions)::numeric / SUM(g.impressions) ELSE AVG(g.position) END AS avg_position,
                COALESCE(a.sessions, 0) AS sessions,
                COALESCE(a.bounce_rate, 0) AS bounce_rate,
                COALESCE(a.avg_session_duration, 0) AS avg_session_duration,
                COALESCE(a.conversions, 0) AS conversions
         FROM gsc_search_analytics g
         LEFT JOIN ga4_pages a ON a.normalized_url = g.normalized_url
         WHERE g.client_id = $1
           AND g.dimension_type = 'query_page'
           AND g.normalized_url IS NOT NULL
           AND g.date_start = (SELECT date_start FROM latest_gsc)
         GROUP BY g.query, g.page, g.normalized_url, a.page_url, a.sessions, a.bounce_rate, a.avg_session_duration, a.conversions
         ORDER BY clicks DESC, impressions DESC
         LIMIT $2`,
        [clientId, Math.max(1, Math.min(300, Number(limit) || 100))]
    );

    return res.rows.map(row => ({
        keyword: row.query,
        page: row.page_url || row.gsc_page,
        normalizedUrl: row.normalized_url,
        clicks: toNumber(row.clicks),
        impressions: toNumber(row.impressions),
        ctrPct: Math.round(toNumber(row.ctr) * 10000) / 100,
        avgPosition: toNumber(row.avg_position),
        sessions: toNumber(row.sessions),
        bounceRate: toNumber(row.bounce_rate),
        avgSessionDuration: toNumber(row.avg_session_duration),
        conversions: toNumber(row.conversions),
        insight: classifyInsight(row),
    }));
}

async function getOpportunities(database = db, clientId, options = {}) {
    const rows = await getPagePerformance(database, clientId, options);
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return rows
        .filter(row => row.insightType !== 'monitor')
        .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || b.clicks - a.clicks)
        .slice(0, Math.max(1, Math.min(100, Number(options.limit) || 50)));
}

async function getOverview(database = db, clientId) {
    const rows = await getPagePerformance(database, clientId, { limit: 200 });
    const totals = rows.reduce((acc, row) => {
        acc.clicks += row.clicks;
        acc.impressions += row.impressions;
        acc.sessions += row.sessions;
        acc.users += row.users;
        acc.conversions += row.conversions;
        acc.revenue += row.revenue;
        if (row.priority === 'high') acc.highPriorityIssues++;
        return acc;
    }, { clicks: 0, impressions: 0, sessions: 0, users: 0, conversions: 0, revenue: 0, highPriorityIssues: 0 });

    return {
        ...totals,
        ctrPct: totals.impressions ? Math.round((totals.clicks / totals.impressions) * 10000) / 100 : 0,
        pagesAnalyzed: rows.length,
        topOpportunities: rows.filter(row => row.priority === 'high').slice(0, 5),
    };
}

async function createTasksFromOpportunities(database = db, { clientId, projectId, userId, agencyId, limit = 10 }) {
    const opportunities = await getOpportunities(database, clientId, { limit });
    const inserted = [];

    for (const item of opportunities) {
        if (!projectId) break;
        const title = `${item.insightTitle}: ${item.page}`;
        const exists = await database.query(
            `SELECT id FROM seo_tasks WHERE project_id = $1 AND LOWER(title) = LOWER($2) LIMIT 1`,
            [projectId, title]
        );
        if (exists.rows.length) continue;

        const res = await database.query(
            `INSERT INTO seo_tasks
             (user_id, agency_id, client_id, project_id, title, description, category, impact, effort, priority, status, ai_notes)
             VALUES ($1,$2,$3,$4,$5,$6,'on-page','high','medium',$7,'todo',$8::jsonb)
             RETURNING *`,
            [
                userId,
                agencyId,
                clientId,
                projectId,
                title,
                item.recommendedAction,
                item.priority === 'high' ? 'high' : 'medium',
                JSON.stringify({ source: 'seo-performance', insightType: item.insightType, page: item.page, normalizedUrl: item.normalizedUrl }),
            ]
        );
        inserted.push(res.rows[0]);
    }

    return inserted;
}

async function createAlertsFromOpportunities(database = db, { clientId, limit = 10 }) {
    const clientRes = await database.query('SELECT website_url FROM seo_clients WHERE id = $1', [clientId]);
    const domain = String(clientRes.rows[0]?.website_url || clientId || 'unknown-client')
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split('/')[0];
    const opportunities = await getOpportunities(database, clientId, { limit });
    const inserted = [];

    for (const item of opportunities) {
        const message = item.insightTitle + ': ' + item.page + '. ' + item.recommendedAction;
        const existing = await database.query(
            "SELECT id FROM alerts WHERE domain = $1 AND alert_type = $2 AND message = $3 AND created_at > NOW() - INTERVAL '7 days' LIMIT 1",
            [domain, item.insightType, message]
        );
        if (existing.rows.length) continue;

        const res = await database.query(
            'INSERT INTO alerts (domain, keyword_id, alert_type, message, old_value, new_value) VALUES ($1, NULL, $2, $3, $4, $5) RETURNING *',
            [domain, item.insightType, message, String(item.clicks || 0), String(item.sessions || 0)]
        );
        inserted.push(res.rows[0]);
    }

    return inserted;
}

module.exports = {
    classifyInsight,
    getOverview,
    getPagePerformance,
    getKeywordPagePerformance,
    getOpportunities,
    createTasksFromOpportunities,
    createAlertsFromOpportunities,
};
