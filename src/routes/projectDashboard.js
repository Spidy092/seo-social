/**
 * Project SEO Dashboard Route
 * Aggregates target keywords, current rank, rank change, technical score,
 * content gaps, top competitors, alerts, and next recommended actions
 * for a single project.
 */

const { createLogger } = require('../utils/logger');
const { syncGscPerformance, isoDate, buildSummary } = require('../services/gscService');
const { checkProjectRankings } = require('../workers/rankTracker');
const { getAgencyContext } = require('../utils/authHelper');
const rankedKeywords = require('../services/rankedKeywordsService');

const log = createLogger('routes:project-dashboard');

const PROJECT_TYPES = new Set([
    'keyword-research',
    'local-seo',
    'content-plan',
    'competitor-gap',
    'service-pages',
]);

function normalizeDomain(input) {
    if (!input) return null;
    let value = String(input).trim().toLowerCase();
    if (!value) return null;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
        const url = new URL(value);
        return url.hostname.replace(/^www\./, '');
    } catch (err) {
        return value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    }
}

function deriveAction(project, metrics) {
    const actions = [];

    if (metrics.technicalScore === null) {
        actions.push({
            id: 'run-technical-audit',
            priority: 'high',
            title: 'Run a technical SEO audit',
            detail: 'No technical audit found for this client\'s site. Run a crawl to surface crawlability, indexability, and sitemap issues.',
        });
    } else if (metrics.technicalScore < 60) {
        actions.push({
            id: 'fix-technical-issues',
            priority: 'high',
            title: `Fix technical issues (current score ${metrics.technicalScore}/100)`,
            detail: 'Resolve the highest-severity crawlability, indexability, and sitemap issues surfaced by the last audit.',
        });
    } else if (metrics.technicalScore < 80) {
        actions.push({
            id: 'improve-technical',
            priority: 'medium',
            title: `Polish technical SEO (score ${metrics.technicalScore}/100)`,
            detail: 'Address remaining architecture and sitemap polish items to reach a healthy 80+ score.',
        });
    }

    if (metrics.droppedRankings > 0) {
        actions.push({
            id: 'recover-drops',
            priority: 'high',
            title: `Recover ${metrics.droppedRankings} dropped keyword ranking${metrics.droppedRankings === 1 ? '' : 's'}`,
            detail: 'Review the dropped keywords below and refresh on-page content, internal links, and backlinks for the worst movers.',
        });
    }

    if (metrics.newRankings > 0) {
        actions.push({
            id: 'boost-new',
            priority: 'medium',
            title: `Push ${metrics.newRankings} new ranking${metrics.newRankings === 1 ? '' : 's'} into the top 10`,
            detail: 'Strengthen on-page signals and internal links for newly ranking pages to break into page one.',
        });
    }

    const top10Gap = metrics.top10Potential.filter(k => k.rank_position && k.rank_position > 10 && k.rank_position <= 20);
    if (top10Gap.length) {
        actions.push({
            id: 'page-one-push',
            priority: 'medium',
            title: `Move ${top10Gap.length} page-two keyword${top10Gap.length === 1 ? '' : 's'} onto page one`,
            detail: 'Keywords in positions 11–20 are easiest to push. Tighten title tags, add supporting content, and build 2–3 internal links each.',
        });
    }

    if (metrics.unreadAlerts > 0) {
        actions.push({
            id: 'review-alerts',
            priority: 'medium',
            title: `Triage ${metrics.unreadAlerts} unread alert${metrics.unreadAlerts === 1 ? '' : 's'}`,
            detail: 'Open the Alerts tab for this project to mark items reviewed and assign owners.',
        });
    }

    if (metrics.unranked > 0 && project.project_type === 'local-seo') {
        actions.push({
            id: 'publish-local',
            priority: 'high',
            title: `Publish or optimise ${metrics.unranked} unranked target keyword${metrics.unranked === 1 ? '' : 's'}`,
            detail: 'For local SEO, every target keyword should map to a live, optimised page. Create or refresh the missing pages.',
        });
    }

    if (metrics.gapCount > 0) {
        actions.push({
            id: 'fill-content-gaps',
            priority: 'medium',
            title: `Close ${metrics.gapCount} content gap${metrics.gapCount === 1 ? '' : 's'}`,
            detail: 'Add missing questions, subtopics, and entity coverage that top-ranking competitors already include.',
        });
    }

    if (!actions.length) {
        actions.push({
            id: 'maintain',
            priority: 'low',
            title: 'Maintain momentum',
            detail: 'No critical issues detected. Continue publishing, monitoring, and refreshing priority pages monthly.',
        });
    }

    return actions.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.priority] - order[b.priority];
    });
}

async function projectDashboardRoutes(fastify, options) {
    const { db } = options;

    fastify.get('/api/projects/:id/dashboard', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;

        try {
            const projectRes = await db.query(
                `SELECT p.*, c.name AS client_name, c.website_url AS client_website,
                        c.industry, c.audience, c.competitors AS client_competitors,
                        c.target_locations, c.goals AS client_goals, c.gsc_site_url
                 FROM seo_projects p
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );

            if (!projectRes.rows.length) {
                return reply.code(404).send({ error: 'Project not found' });
            }

            const project = projectRes.rows[0];
            project.project_type = PROJECT_TYPES.has(project.project_type) ? project.project_type : 'keyword-research';

            const targetDomain = normalizeDomain(project.client_website);

            const [keywordsRes, ranksRes, historyRes, alertsRes, techRes, competitorRes, gscRes, rankedKwRes] = await Promise.all([
                db.query(
                    `SELECT pk.id AS link_id, pk.intent, pk.priority_score, pk.notes, pk.created_at AS linked_at,
                            k.id AS keyword_id, k.keyword, k.location, k.search_volume,
                            k.competition, k.cpc, k.difficulty
                     FROM seo_project_keywords pk
                     JOIN keywords k ON k.id = pk.keyword_id
                     WHERE pk.project_id = $1
                     ORDER BY pk.priority_score DESC, k.search_volume DESC, pk.created_at DESC`,
                    [id]
                ),
                db.query(
                    `SELECT DISTINCT ON (dr.keyword_id)
                            dr.keyword_id, dr.rank_position, dr.url, dr.checked_at
                     FROM domain_rankings dr
                     WHERE dr.project_id = $1
                     ORDER BY dr.keyword_id, dr.checked_at DESC`,
                    [id]
                ),
                db.query(
                    `SELECT DISTINCT ON (rh.keyword_id)
                            rh.keyword_id, rh.rank_position, rh.previous_rank, rh.change_direction, rh.checked_at
                     FROM rank_history rh
                     WHERE rh.project_id = $1
                     ORDER BY rh.keyword_id, rh.checked_at DESC`,
                    [id]
                ),
                db.query(
                    `SELECT a.*, k.keyword
                     FROM alerts a
                     JOIN keywords k ON k.id = a.keyword_id
                     WHERE a.project_id = $1
                     ORDER BY a.created_at DESC
                     LIMIT 25`,
                    [id]
                ),
                targetDomain
                    ? db.query(
                        `SELECT id, site_url, overall_score, pages_crawled, created_at,
                                summary, issues
                         FROM technical_audits
                         WHERE site_url ILIKE $1 OR site_url ILIKE $2
                         ORDER BY created_at DESC
                         LIMIT 5`,
                        [`%${targetDomain}%`, `%www.${targetDomain}%`]
                    )
                    : Promise.resolve({ rows: [] }),
                db.query(
                    `SELECT c.domain, COUNT(*) AS keyword_count,
                            ROUND(AVG(c.rank_position)::numeric, 1) AS avg_position,
                            MIN(c.rank_position) AS best_position,
                            MAX(c.discovered_at) AS latest_discovered_at
                     FROM competitors c
                     WHERE c.keyword_id IN (SELECT keyword_id FROM seo_project_keywords WHERE project_id = $1)
                     GROUP BY c.domain
                     ORDER BY keyword_count DESC, avg_position ASC
                     LIMIT 10`,
                    [id]
                ),
                db.query(
                    `SELECT *
                     FROM gsc_search_analytics
                     WHERE client_id = $1
                       AND date_start = (SELECT MAX(date_start) FROM gsc_search_analytics WHERE client_id = $1)
                     ORDER BY impressions DESC
                     LIMIT 1200`,
                    [project.client_id]
                ).catch(() => ({ rows: [] })),
                // Ranked keywords (cache-first). Tolerant of any failure —
                // we never want a missing snapshot to break the dashboard.
                rankedKeywords.getRankedKeywords(db, {
                    projectId: id,
                    clientId: project.client_id,
                    agencyId: ctx.agencyId,
                    forceRefresh: false,
                }).catch((err) => {
                    log.warn({ err: err.message, projectId: id }, 'ranked-keywords lookup failed inside dashboard; returning empty');
                    return { source: 'none', url: '', count: 0, keywords: [], checkedAt: null, cached: false };
                }),
            ]);

            const rankByKeyword = new Map();
            ranksRes.rows.forEach(row => rankByKeyword.set(row.keyword_id, row));

            const historyByKeyword = new Map();
            historyRes.rows.forEach(row => historyByKeyword.set(row.keyword_id, row));

            const targetKeywords = keywordsRes.rows.map(kw => {
                const rank = rankByKeyword.get(kw.keyword_id) || null;
                const history = historyByKeyword.get(kw.keyword_id) || null;

                let change = null;
                if (rank && history) {
                    if (rank.rank_position === 0 && history.rank_position > 0) {
                        change = { delta: null, direction: 'lost' };
                    } else if (rank.rank_position > 0 && history.previous_rank > 0) {
                        const delta = history.previous_rank - rank.rank_position;
                        change = { delta, direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'same' };
                    } else if (history.change_direction === 'new' && rank.rank_position > 0) {
                        change = { delta: null, direction: 'new' };
                    }
                }

                return {
                    id: kw.keyword_id,
                    linkId: kw.link_id,
                    keyword: kw.keyword,
                    location: kw.location,
                    intent: kw.intent,
                    priorityScore: parseInt(kw.priority_score, 10) || 0,
                    notes: kw.notes,
                    searchVolume: parseInt(kw.search_volume, 10) || 0,
                    competition: kw.competition,
                    cpc: parseFloat(kw.cpc) || 0,
                    difficulty: parseInt(kw.difficulty, 10) || 0,
                    rank: rank ? {
                        position: rank.rank_position,
                        url: rank.url,
                        checkedAt: rank.checked_at,
                    } : null,
                    change,
                };
            });

            const totalSearchVolume = targetKeywords.reduce((sum, k) => sum + (k.searchVolume || 0), 0);
            const rankedTargetKeywords = targetKeywords.filter(k => k.rank && k.rank.position > 0);
            const unranked = targetKeywords.length - rankedTargetKeywords.length;
            const top10 = rankedTargetKeywords.filter(k => k.rank.position <= 10).length;
            const top3 = rankedTargetKeywords.filter(k => k.rank.position <= 3).length;
            const avgPosition = rankedTargetKeywords.length
                ? Math.round((rankedTargetKeywords.reduce((sum, k) => sum + k.rank.position, 0) / rankedTargetKeywords.length) * 10) / 10
                : null;

            const droppedRankings = targetKeywords.filter(k => k.change && k.change.direction === 'down').length;
            const improvedRankings = targetKeywords.filter(k => k.change && k.change.direction === 'up').length;
            const newRankings = targetKeywords.filter(k => k.change && k.change.direction === 'new').length;
            const lostRankings = targetKeywords.filter(k => k.change && k.change.direction === 'lost').length;

            const top10Potential = targetKeywords
                .filter(k => k.rank && k.rank.position > 10 && k.rank.position <= 20)
                .sort((a, b) => (a.rank.position - b.rank.position))
                .slice(0, 5);

            const latestTech = techRes.rows[0] || null;
            const technicalScore = latestTech ? parseInt(latestTech.overall_score, 10) : null;
            const technicalIssues = latestTech ? (Array.isArray(latestTech.issues) ? latestTech.issues : []) : [];
            const technicalSummary = latestTech ? (latestTech.summary && typeof latestTech.summary === 'object' ? latestTech.summary : {}) : {};
            const criticalIssues = technicalIssues.filter(i => (i.severity || '').toLowerCase() === 'critical' || (i.severity || '').toLowerCase() === 'high');

            const contentGaps = targetKeywords
                .filter(k => !k.rank || k.rank.position === 0)
                .sort((a, b) => (b.priorityScore + b.searchVolume / 1000) - (a.priorityScore + a.searchVolume / 1000))
                .slice(0, 8)
                .map(k => ({
                    keyword: k.keyword,
                    searchVolume: k.searchVolume,
                    difficulty: k.difficulty,
                    intent: k.intent,
                    priorityScore: k.priorityScore,
                }));

            const topCompetitors = competitorRes.rows.map(row => ({
                domain: row.domain,
                keywordCount: parseInt(row.keyword_count, 10),
                avgPosition: parseFloat(row.avg_position) || null,
                bestPosition: parseInt(row.best_position, 10) || null,
                latestDiscoveredAt: row.latest_discovered_at,
            }));

            const recentAlerts = alertsRes.rows.map(a => ({
                id: a.id,
                type: a.alert_type,
                message: a.message,
                oldValue: a.old_value,
                newValue: a.new_value,
                isRead: a.is_read,
                keyword: a.keyword,
                createdAt: a.created_at,
            }));

            const unreadAlerts = recentAlerts.filter(a => !a.isRead).length;

            const gscRows = gscRes.rows.map(row => ({
                dateStart: row.date_start,
                dateEnd: row.date_end,
                dimensionType: row.dimension_type,
                query: row.query,
                page: row.page,
                device: row.device,
                country: row.country,
                clicks: parseInt(row.clicks, 10) || 0,
                impressions: parseInt(row.impressions, 10) || 0,
                ctr: parseFloat(row.ctr) || 0,
                position: parseFloat(row.position) || 0,
            }));
            const gscSummary = gscRows.length ? buildSummary(gscRows) : null;
            const gscPerformanceScore = gscSummary
                ? Math.max(0, Math.min(100, Math.round((gscSummary.ctr * 1000) + Math.max(0, 40 - (gscSummary.position || 40)))))
                : null;

            const metrics = {
                technicalScore,
                droppedRankings,
                newRankings,
                improvedRankings,
                lostRankings,
                top10Potential,
                unreadAlerts,
                unranked,
                gapCount: contentGaps.length,
                gscClicks: gscSummary?.clicks || 0,
                lowCtrCount: gscSummary?.lowCtrPages?.length || 0,
            };

            const actions = deriveAction(project, metrics);

            const clientCompetitors = Array.isArray(project.client_competitors) ? project.client_competitors : [];

            return {
                project: {
                    id: project.id,
                    name: project.name,
                    projectType: project.project_type,
                    targetLocation: project.target_location,
                    goals: project.goals,
                    status: project.status,
                    updatedAt: project.updated_at,
                    client: {
                        id: project.client_id,
                        name: project.client_name,
                        website: project.client_website,
                        domain: targetDomain,
                        gscSiteUrl: project.gsc_site_url,
                        industry: project.industry,
                        audience: project.audience,
                        competitors: clientCompetitors,
                        targetLocations: Array.isArray(project.target_locations) ? project.target_locations : [],
                        goals: project.client_goals,
                    },
                },
                summary: {
                    keywordCount: targetKeywords.length,
                    totalSearchVolume,
                    rankedKeywords: rankedTargetKeywords.length,
                    unranked,
                    top3,
                    top10,
                    avgPosition,
                    improvedRankings,
                    droppedRankings,
                    newRankings,
                    lostRankings,
                    gscClicks: gscSummary?.clicks || 0,
                    gscImpressions: gscSummary?.impressions || 0,
                    gscCtr: gscSummary?.ctr || 0,
                    gscPosition: gscSummary?.position || null,
                    gscPerformanceScore,
                    lowCtrOpportunities: gscSummary?.lowCtrPages?.length || 0,
                    quickWinKeywords: gscSummary?.quickWinKeywords?.length || 0,
                },
                targetKeywords,
                contentGaps,
                topCompetitors,
                gsc: gscSummary ? {
                    siteUrl: project.gsc_site_url || project.client_website,
                    dateStart: gscRows[0]?.dateStart,
                    dateEnd: gscRows[0]?.dateEnd,
                    clicks: gscSummary.clicks,
                    impressions: gscSummary.impressions,
                    ctr: gscSummary.ctr,
                    position: gscSummary.position,
                    performanceScore: gscPerformanceScore,
                    topQueries: gscSummary.topQueries,
                    topPages: gscSummary.topPages,
                    lowCtrPages: gscSummary.lowCtrPages,
                    quickWinKeywords: gscSummary.quickWinKeywords,
                    pageOpportunities: gscSummary.pageOpportunities,
                } : null,
                technical: latestTech ? {
                    auditId: latestTech.id,
                    siteUrl: latestTech.site_url,
                    score: technicalScore,
                    pagesCrawled: parseInt(latestTech.pages_crawled, 10) || 0,
                    auditedAt: latestTech.created_at,
                    issueCount: technicalIssues.length,
                    criticalIssueCount: criticalIssues.length,
                    topIssues: technicalIssues.slice(0, 5),
                    summary: technicalSummary,
                } : null,
                alerts: {
                    unreadCount: unreadAlerts,
                    recent: recentAlerts,
                },
                rankedKeywords: rankedKwRes || { source: 'none', url: '', count: 0, keywords: [], checkedAt: null, cached: false },
                actions,
                generatedAt: new Date().toISOString(),
            };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to build project dashboard');
            return reply.code(500).send({ error: err.message });
        }
    });


    fastify.get('/api/projects/:id/rankings', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const limit = Math.max(1, Math.min(200, Number(request.query.limit) || 100));
        const offset = Math.max(0, Number(request.query.offset) || 0);
        try {
            const projectRes = await db.query(
                `SELECT p.id, p.client_id, COALESCE(NULLIF(p.tracking_domain, ''), c.website_url) AS tracking_domain
                 FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id
                 WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );
            if (!projectRes.rows.length) return reply.code(404).send({ error: 'Project not found' });
            const countRes = await db.query('SELECT COUNT(*) AS total FROM seo_project_keywords WHERE project_id = $1', [id]);
            const result = await db.query(
                `SELECT k.id AS keyword_id, k.keyword, k.location, k.search_volume, k.difficulty,
                        spk.intent, spk.priority_score, dr.rank_position, dr.url, dr.checked_at,
                        rh.previous_rank, rh.change_direction, rh.checked_at AS changed_at
                 FROM seo_project_keywords spk
                 JOIN keywords k ON k.id = spk.keyword_id
                 LEFT JOIN domain_rankings dr ON dr.project_id = spk.project_id AND dr.keyword_id = spk.keyword_id
                 LEFT JOIN LATERAL (
                    SELECT previous_rank, change_direction, checked_at FROM rank_history
                    WHERE project_id = spk.project_id AND keyword_id = spk.keyword_id
                    ORDER BY checked_at DESC LIMIT 1
                 ) rh ON TRUE
                 WHERE spk.project_id = $1
                 ORDER BY spk.priority_score DESC, k.search_volume DESC, k.keyword ASC
                 LIMIT $2 OFFSET $3`,
                [id, limit, offset]
            );
            return { success: true, projectId: id, trackingDomain: normalizeDomain(projectRes.rows[0].tracking_domain), rankings: result.rows, total: parseInt(countRes.rows[0].total, 10) || 0, limit, offset };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to load project rankings');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/projects/:id/rankings/check', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        try {
            const result = await checkProjectRankings(db, request.params.id, { agencyId: ctx.agencyId });
            return { success: true, ...result };
        } catch (err) {
            log.error({ err: err.message, projectId: request.params.id }, 'project rank check failed');
            return reply.code(/not found/i.test(err.message) ? 404 : 500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects/:id/alerts', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
        const offset = Math.max(0, Number(request.query.offset) || 0);
        const filters = ['a.project_id = $1'];
        const params = [id];
        try {
            const projectRes = await db.query(`SELECT p.id FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`, [id, ctx.agencyId]);
            if (!projectRes.rows.length) return reply.code(404).send({ error: 'Project not found' });
            if (request.query.unreadOnly === 'true') filters.push('a.is_read = FALSE');
            if (request.query.type) { params.push(request.query.type); filters.push(`a.alert_type = $${params.length}`); }
            if (request.query.severity) { params.push(request.query.severity); filters.push(`a.severity = $${params.length}`); }
            const where = filters.join(' AND ');
            const count = await db.query(`SELECT COUNT(*) AS total FROM alerts a WHERE ${where}`, params);
            const unread = await db.query('SELECT COUNT(*) AS total FROM alerts WHERE project_id = $1 AND is_read = FALSE', [id]);
            const result = await db.query(
                `SELECT a.*, k.keyword, c.name AS client_name, p.name AS project_name
                 FROM alerts a
                 LEFT JOIN keywords k ON k.id = a.keyword_id
                 LEFT JOIN seo_clients c ON c.id = a.client_id
                 LEFT JOIN seo_projects p ON p.id = a.project_id
                 WHERE ${where}
                 ORDER BY a.created_at DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, limit, offset]
            );
            return { success: true, alerts: result.rows, total: parseInt(count.rows[0].total, 10) || 0, unreadCount: parseInt(unread.rows[0].total, 10) || 0, limit, offset };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to load project alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects/:id/competitors', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
        const offset = Math.max(0, Number(request.query.offset) || 0);
        try {
            const projectRes = await db.query(`SELECT p.id FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`, [id, ctx.agencyId]);
            if (!projectRes.rows.length) return reply.code(404).send({ error: 'Project not found' });
            const count = await db.query(`SELECT COUNT(DISTINCT c.domain) AS total FROM competitors c JOIN seo_project_keywords spk ON spk.keyword_id = c.keyword_id WHERE spk.project_id = $1`, [id]);
            const result = await db.query(
                `SELECT c.domain, COUNT(DISTINCT c.keyword_id) AS keyword_overlap,
                        ROUND(AVG(c.rank_position)::numeric, 1) AS avg_position,
                        MIN(c.rank_position) AS best_position,
                        MAX(c.discovered_at) AS latest_discovered_at
                 FROM competitors c JOIN seo_project_keywords spk ON spk.keyword_id = c.keyword_id
                 WHERE spk.project_id = $1
                 GROUP BY c.domain
                 ORDER BY keyword_overlap DESC, avg_position ASC
                 LIMIT $2 OFFSET $3`,
                [id, limit, offset]
            );
            return { success: true, competitors: result.rows, total: parseInt(count.rows[0].total, 10) || 0, limit, offset };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to load project competitors');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects/:id/setup-checklist', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        try {
            const projectRes = await db.query(
                `SELECT p.id, p.name, p.client_id, p.tracking_domain, c.website_url, c.gsc_site_url, c.ga4_property_id
                 FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id
                 WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );
            if (!projectRes.rows.length) return reply.code(404).send({ error: 'Project not found' });
            const project = projectRes.rows[0];
            const domain = normalizeDomain(project.tracking_domain || project.website_url);
            const [keywords, rankings, onpage, technical, pagespeed, gscRows, ga4Rows, competitors, tasks] = await Promise.all([
                db.query('SELECT COUNT(*) AS total FROM seo_project_keywords WHERE project_id = $1', [id]),
                db.query('SELECT COUNT(*) AS total, MAX(checked_at) AS last_checked_at FROM domain_rankings WHERE project_id = $1', [id]),
                db.query('SELECT COUNT(*) AS total, MAX(created_at) AS last_run_at FROM onpage_audits WHERE project_id = $1', [id]),
                domain ? db.query('SELECT COUNT(*) AS total, MAX(created_at) AS last_run_at FROM technical_audits WHERE site_url ILIKE $1 OR site_url ILIKE $2', [`%${domain}%`, `%www.${domain}%`]) : Promise.resolve({ rows: [{ total: 0, last_run_at: null }] }),
                db.query('SELECT COUNT(*) AS total, MAX(created_at) AS last_run_at FROM page_speed_checks WHERE client_id = $1', [project.client_id]),
                db.query('SELECT COUNT(*) AS total, MAX(created_at) AS last_synced_at FROM gsc_search_analytics WHERE client_id = $1', [project.client_id]),
                db.query('SELECT COUNT(*) AS total, MAX(created_at) AS last_synced_at FROM ga4_page_analytics WHERE client_id = $1', [project.client_id]),
                db.query('SELECT COUNT(DISTINCT c.domain) AS total FROM competitors c JOIN seo_project_keywords spk ON spk.keyword_id = c.keyword_id WHERE spk.project_id = $1', [id]),
                db.query('SELECT COUNT(*) AS total FROM seo_tasks WHERE project_id = $1', [id]),
            ]);
            const item = (id, label, status, action, meta = {}) => ({ id, label, status, action, ...meta });
            const checklist = [
                item('client-domain', 'Client website / tracking domain', domain ? 'complete' : 'required', 'Add client website or project tracking domain', { actionPage: 'clients', actionLabel: 'Edit client', domain }),
                item('keywords', 'Project keywords', Number(keywords.rows[0].total) > 0 ? 'complete' : 'required', 'Run keyword research and save keywords to this project', { actionPage: 'research', actionLabel: 'Find keywords', count: Number(keywords.rows[0].total) || 0 }),
                item('rank-check', 'Project rank check', Number(rankings.rows[0].total) > 0 ? 'complete' : 'recommended', 'Run project rank check', { actionPage: 'tracking', actionType: 'run-rank-check', actionLabel: 'Run check', count: Number(rankings.rows[0].total) || 0, lastRunAt: rankings.rows[0].last_checked_at }),
                item('onpage', 'On-page SEO audit', Number(onpage.rows[0].total) > 0 ? 'complete' : 'recommended', 'Run on-page audit for priority URL', { actionPage: 'onpage', actionLabel: 'Open audit', lastRunAt: onpage.rows[0].last_run_at }),
                item('technical', 'Technical and security audit', Number(technical.rows[0].total) > 0 ? 'complete' : 'recommended', 'Run technical audit with security headers enabled', { actionPage: 'technical', actionLabel: 'Open audit', lastRunAt: technical.rows[0].last_run_at }),
                item('pagespeed', 'PageSpeed / Core Web Vitals', Number(pagespeed.rows[0].total) > 0 ? 'complete' : 'recommended', 'Run PageSpeed check', { actionPage: 'page-speed', actionLabel: 'Open check', lastRunAt: pagespeed.rows[0].last_run_at }),
                item('gsc', 'Google Search Console', project.gsc_site_url ? (Number(gscRows.rows[0].total) > 0 ? 'complete' : 'recommended') : 'recommended', project.gsc_site_url ? 'Sync GSC data' : 'Connect GSC property', { actionPage: 'search-visibility', actionType: 'gsc', actionLabel: project.gsc_site_url ? 'Open sync' : 'Connect', connected: Boolean(project.gsc_site_url), lastSyncedAt: gscRows.rows[0].last_synced_at }),
                item('ga4', 'Google Analytics 4', project.ga4_property_id ? (Number(ga4Rows.rows[0].total) > 0 ? 'complete' : 'recommended') : 'recommended', project.ga4_property_id ? 'Sync GA4 data' : 'Connect GA4 property', { actionPage: 'search-visibility', actionType: 'ga4', actionLabel: project.ga4_property_id ? 'Open sync' : 'Connect', connected: Boolean(project.ga4_property_id), lastSyncedAt: ga4Rows.rows[0].last_synced_at }),
                item('competitors', 'Competitor review', Number(competitors.rows[0].total) > 0 ? 'complete' : 'recommended', 'Review project competitors', { actionPage: 'competitors', actionLabel: 'Review', count: Number(competitors.rows[0].total) || 0 }),
                item('tasks', 'SEO task plan', Number(tasks.rows[0].total) > 0 ? 'complete' : 'recommended', 'Generate or create SEO tasks from confirmed data', { actionPage: 'tasks', actionLabel: 'Open tasks', count: Number(tasks.rows[0].total) || 0 }),
            ];
            return { success: true, projectId: id, clientId: project.client_id, domain, checklist };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to build setup checklist');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/projects/:id/gsc/sync', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { id } = request.params;
        const body = request.body || {};

        try {
            const projectRes = await db.query(
                `SELECT p.id, p.client_id, c.website_url, c.gsc_site_url
                 FROM seo_projects p
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );
            if (!projectRes.rows.length) return reply.code(404).send({ error: 'Project not found' });
            const project = projectRes.rows[0];
            const siteUrl = body.siteUrl || project.gsc_site_url || project.website_url;
            if (!siteUrl) return reply.code(400).send({ error: 'Add a client website or GSC site URL first' });

            const result = await syncGscPerformance(db, {
                clientId: project.client_id,
                userId: ctx.userId,
                siteUrl,
                days: Number(body.days) || Number(process.env.GSC_SYNC_DAYS) || 30,
            });
            return { success: true, result };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'failed to sync GSC performance');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = projectDashboardRoutes;
