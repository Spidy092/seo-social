/**
 * 🚨 Alerts & Rank Tracking Routes
 */

const { createLogger } = require('../utils/logger');
const keywordService = require('../services/keywordService');
const { extractDomain } = require('../utils/domainUtils');
const { requireAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:alerts');

function scopedConditions(alias, params, ctx, filters = {}) {
    const prefix = alias ? `${alias}.` : '';
    const conditions = [`(${prefix}agency_id = $${params.length + 1} OR ${prefix}agency_id IS NULL OR $${params.length + 1} IS NULL)`];
    params.push(ctx.agencyId);

    if (filters.domain) {
        conditions.push(`${prefix}domain = $${params.length + 1}`);
        params.push(filters.domain);
    }
    if (filters.projectId) {
        conditions.push(`${prefix}project_id = $${params.length + 1}`);
        params.push(filters.projectId);
    }
    if (filters.clientId) {
        conditions.push(`${prefix}client_id = $${params.length + 1}`);
        params.push(filters.clientId);
    }
    return conditions;
}


async function alertRoutes(fastify, options) {
    const { db } = options;

    // ─── Add Domain to Track ───
    fastify.post('/api/alerts/track', {
        schema: {
            body: {
                type: 'object',
                required: ['domain'],
                properties: {
                    domain: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { domain } = request.body;
            const normalizedDomain = extractDomain(domain);
            
            try {
                await db.query(
                    `INSERT INTO my_domains (agency_id, domain) VALUES ($1, $2)
                     ON CONFLICT (agency_id, domain) DO NOTHING`,
                    [ctx.agencyId, normalizedDomain]
                );

                return {
                    success: true,
                    message: `Now tracking ${normalizedDomain}`,
                };
            } catch (err) {
                log.error({ err: err.message }, 'failed to add domain');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Tracked Domains with Stats ───
    fastify.get('/api/alerts/domains', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        try {
            const result = await db.query(`
                SELECT d.*, 
                    (SELECT COUNT(*) FROM domain_rankings dr WHERE dr.domain = d.domain AND (dr.agency_id = $1 OR dr.agency_id IS NULL OR $1 IS NULL)) as keyword_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'up' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days'
                     AND (rh.agency_id = $1 OR rh.agency_id IS NULL OR $1 IS NULL)) as improved_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'down' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days'
                     AND (rh.agency_id = $1 OR rh.agency_id IS NULL OR $1 IS NULL)) as dropped_count
                FROM my_domains d
                WHERE d.agency_id = $1 OR d.agency_id IS NULL OR $1 IS NULL
                ORDER BY d.added_at DESC
            `, [ctx.agencyId]);

            return {
                domains: result.rows,
                total: result.rows.length,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get domains');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Unread Count ─── (must be before /api/alerts to avoid any prefix matching issues)
    fastify.get('/api/alerts/unread-count', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        try {
            const result = await db.query(
                `SELECT COUNT(*) as count FROM alerts a
                 WHERE a.is_read = FALSE
                   AND (a.agency_id = $1 OR a.agency_id IS NULL OR $1 IS NULL)`,
                [ctx.agencyId]
            );
            return { count: parseInt(result.rows[0].count) };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get unread count');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get All Alerts ───
    fastify.get('/api/alerts', async (request, reply) => {
        const { domain, projectId, clientId, type, severity, unreadOnly = false, limit = 20, offset = 0 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            let baseConditions = [`(a.agency_id = $1 OR a.agency_id IS NULL OR $1 IS NULL)`];
            const params = [ctx.agencyId];

            if (domain) {
                baseConditions.push(`a.domain = $${params.length + 1}`);
                params.push(domain);
            }
            if (projectId) {
                baseConditions.push(`a.project_id = $${params.length + 1}`);
                params.push(projectId);
            }
            if (clientId) {
                baseConditions.push(`a.client_id = $${params.length + 1}`);
                params.push(clientId);
            }
            if (type) {
                baseConditions.push(`a.alert_type = $${params.length + 1}`);
                params.push(type);
            }
            if (severity) {
                baseConditions.push(`a.severity = $${params.length + 1}`);
                params.push(severity);
            }
            if (unreadOnly === 'true') {
                baseConditions.push(`a.is_read = FALSE`);
            }

            const whereClause = baseConditions.length > 0 ? 'WHERE ' + baseConditions.join(' AND ') : '';

            // Total count for pagination
            const countResult = await db.query(
                `SELECT COUNT(*) as total FROM alerts a ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            let query = `
                SELECT a.*, k.keyword, p.name AS project_name, c.name AS client_name
                FROM alerts a
                LEFT JOIN keywords k ON a.keyword_id = k.id
                LEFT JOIN seo_projects p ON p.id = a.project_id
                LEFT JOIN seo_clients c ON c.id = a.client_id
                ${whereClause}
            `;

            query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Get unread count
            const unreadResult = await db.query(
                `SELECT COUNT(*) as count FROM alerts a WHERE a.is_read = FALSE AND (a.agency_id = $1 OR a.agency_id IS NULL OR $1 IS NULL)`,
                [ctx.agencyId]
            );

            return {
                alerts: result.rows,
                total,
                unreadCount: parseInt(unreadResult.rows[0].count),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Mark All as Read ─── (must be BEFORE /:id/read to avoid Fastify matching "read-all" as :id)
    fastify.put('/api/alerts/read-all', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { domain } = request.body || {};

        try {
            if (domain) {
                await db.query(
                    `UPDATE alerts SET is_read = TRUE
                     WHERE domain = $1
                       AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)`,
                    [domain, ctx.agencyId]
                );
            } else {
                await db.query(
                    `UPDATE alerts SET is_read = TRUE
                     WHERE agency_id = $1 OR agency_id IS NULL OR $1 IS NULL`,
                    [ctx.agencyId]
                );
            }

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to mark alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Mark Alert as Read ───
    fastify.put('/api/alerts/:id/read', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { id } = request.params;

        try {
            const result = await db.query(
                `UPDATE alerts SET is_read = TRUE
                 WHERE id = $1
                   AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );
            if (result.rowCount === 0) {
                return reply.code(404).send({ error: 'Alert not found' });
            }

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to mark alert');
            return reply.code(500).send({ error: err.message });
        }
    });



    // ─── Get Rank History ───
    fastify.get('/api/alerts/rank-history', async (request, reply) => {
        const { domain, projectId, clientId, keywordId, days = 30, limit = 50, offset = 0 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            const params = [parseInt(days) || 30];
            const filters = scopedConditions('rh', params, ctx, { domain, projectId, clientId });
            if (keywordId) {
                filters.push(`rh.keyword_id = $${params.length + 1}`);
                params.push(keywordId);
            }
            const whereClause = `WHERE rh.checked_at > NOW() - ($1 || ' days')::interval AND ${filters.join(' AND ')}`;
            const baseQuery = `
                SELECT rh.*, k.keyword, p.name AS project_name, c.name AS client_name
                FROM rank_history rh
                JOIN keywords k ON rh.keyword_id = k.id
                LEFT JOIN seo_projects p ON p.id = rh.project_id
                LEFT JOIN seo_clients c ON c.id = rh.client_id
                ${whereClause}
            `;

            const countResult = await db.query(`SELECT COUNT(*) as total FROM (${baseQuery}) sub`, params);
            const total = parseInt(countResult.rows[0].total, 10) || 0;

            const queryParams = [...params, parseInt(limit), parseInt(offset)];
            const result = await db.query(
                `${baseQuery} ORDER BY rh.checked_at DESC LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
                queryParams
            );

            return { history: result.rows, total };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get rank history');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Current Rankings (deduplicated latest per project+keyword) ───
    fastify.get('/api/rankings/current', async (request, reply) => {
        const { domain, projectId, clientId, limit = 100, offset = 0 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            const params = [ctx.agencyId];
            const filters = ['(dr.agency_id = $1 OR dr.agency_id IS NULL OR $1 IS NULL)'];
            if (domain) { params.push(domain); filters.push(`dr.domain = $${params.length}`); }
            if (projectId) { params.push(projectId); filters.push(`dr.project_id = $${params.length}`); }
            if (clientId) { params.push(clientId); filters.push(`dr.client_id = $${params.length}`); }
            const whereClause = `WHERE ${filters.join(' AND ')}`;

            const countResult = await db.query(
                `SELECT COUNT(*) AS total
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total, 10) || 0;
            const queryParams = [...params, parseInt(limit), parseInt(offset)];
            const result = await db.query(
                `SELECT dr.domain, dr.project_id, dr.client_id, dr.rank_position, dr.url, dr.checked_at,
                        k.keyword, k.search_volume, k.location,
                        p.name AS project_name, c.name AS client_name
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 LEFT JOIN seo_projects p ON p.id = dr.project_id
                 LEFT JOIN seo_clients c ON c.id = dr.client_id
                 ${whereClause}
                 ORDER BY dr.checked_at DESC, dr.rank_position ASC
                 LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
                queryParams
            );

            return { rankings: result.rows, total };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get current rankings');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Rank Changes Summary ───
    fastify.get('/api/alerts/summary', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { domain, projectId, clientId } = request.query;

        try {
            if (!domain && !projectId && !clientId) {
                return reply.code(400).send({ error: 'domain, projectId, or clientId is required' });
            }

            const rankingParams = [];
            const rankingFilters = scopedConditions('dr', rankingParams, ctx, { domain, projectId, clientId });
            const currentRankings = await db.query(
                `SELECT dr.*, k.keyword, k.search_volume, p.name AS project_name, c.name AS client_name
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 LEFT JOIN seo_projects p ON p.id = dr.project_id
                 LEFT JOIN seo_clients c ON c.id = dr.client_id
                 WHERE ${rankingFilters.join(' AND ')}
                 ORDER BY dr.rank_position`,
                rankingParams
            );

            const historyParams = [];
            const historyFilters = scopedConditions('rh', historyParams, ctx, { domain, projectId, clientId });
            const recentChanges = await db.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE change_direction = 'up') as improved,
                    COUNT(*) FILTER (WHERE change_direction = 'down') as dropped,
                    COUNT(*) FILTER (WHERE change_direction = 'same') as stable,
                    COUNT(*) FILTER (WHERE change_direction = 'new') as new_rankings
                 FROM rank_history rh
                 WHERE ${historyFilters.join(' AND ')}
                   AND rh.checked_at > NOW() - INTERVAL '7 days'`,
                historyParams
            );

            const alertParams = [];
            const alertFilters = scopedConditions('a', alertParams, ctx, { domain, projectId, clientId });
            alertFilters.push('a.is_read = FALSE');
            const alertsCount = await db.query(
                `SELECT COUNT(*) as count FROM alerts a WHERE ${alertFilters.join(' AND ')}`,
                alertParams
            );

            return {
                domain: domain || null,
                projectId: projectId || null,
                clientId: clientId || null,
                currentRankings: currentRankings.rows,
                totalKeywords: currentRankings.rows.length,
                changes: recentChanges.rows[0],
                unreadAlerts: parseInt(alertsCount.rows[0].count, 10) || 0,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get summary');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete Alert ───
    fastify.delete('/api/alerts/:id', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { id } = request.params;

        try {
            const result = await db.query(
                `DELETE FROM alerts
                 WHERE id = $1
                   AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)`,
                [id, ctx.agencyId]
            );
            if (result.rowCount === 0) {
                return reply.code(404).send({ error: 'Alert not found' });
            }
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to delete alert');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get My Tracked Domains (agency-scoped compatibility endpoint) ───
    fastify.get('/api/domains', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        try {
            const result = await db.query(
                `SELECT d.*,
                    (SELECT COUNT(*) FROM domain_rankings dr WHERE dr.domain = d.domain AND (dr.agency_id = $1 OR dr.agency_id IS NULL OR $1 IS NULL)) as keyword_count,
                    (SELECT COUNT(*) FROM rank_history rh WHERE rh.domain = d.domain AND rh.change_direction = 'up' AND rh.checked_at > NOW() - INTERVAL '7 days' AND (rh.agency_id = $1 OR rh.agency_id IS NULL OR $1 IS NULL)) as improved_count,
                    (SELECT COUNT(*) FROM rank_history rh WHERE rh.domain = d.domain AND rh.change_direction = 'down' AND rh.checked_at > NOW() - INTERVAL '7 days' AND (rh.agency_id = $1 OR rh.agency_id IS NULL OR $1 IS NULL)) as dropped_count
                 FROM my_domains d
                 WHERE d.agency_id = $1 OR d.agency_id IS NULL OR $1 IS NULL
                 ORDER BY d.added_at DESC`,
                [ctx.agencyId]
            );
            return { domains: result.rows, total: result.rows.length };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get domains');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Add Domain (agency-scoped compatibility endpoint) ───
    fastify.post('/api/domains', {
        schema: {
            body: {
                type: 'object',
                required: ['domain'],
                properties: { domain: { type: 'string' } },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const normalizedDomain = extractDomain(request.body.domain);
            try {
                await db.query(
                    `INSERT INTO my_domains (agency_id, domain) VALUES ($1, $2)
                     ON CONFLICT (agency_id, domain) DO NOTHING`,
                    [ctx.agencyId, normalizedDomain]
                );
                return { success: true, message: `Now tracking ${normalizedDomain}` };
            } catch (err) {
                log.error({ err: err.message }, 'failed to add domain');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Manual Rank Check ───
    fastify.post('/api/rankings/check', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    domain: { type: 'string' },
                    projectId: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { domain, projectId } = request.body || {};
            try {
                log.info({ domain, projectId, agencyId: ctx.agencyId }, 'manual rank check triggered');
                const { manualRankCheck, checkProjectRankings } = require('../workers/rankTracker');
                const results = projectId
                    ? [await checkProjectRankings(db, projectId, { agencyId: ctx.agencyId })]
                    : await manualRankCheck(db, domain, { agencyId: ctx.agencyId });
                return { success: true, domain, projectId, results };
            } catch (err) {
                log.error({ err: err.message }, 'manual rank check failed');
                return reply.code(/not found/i.test(err.message) ? 404 : 500).send({ error: err.message });
            }
        },
    });

    // ─── Get Domain Rankings ───
    fastify.get('/api/rankings/:domain', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { domain } = request.params;
        const { projectId } = request.query || {};
        try {
            const params = [domain, ctx.agencyId];
            let projectFilter = '';
            if (projectId) {
                params.push(projectId);
                projectFilter = ` AND dr.project_id = $${params.length}`;
            }
            const result = await db.query(
                `SELECT dr.*, k.keyword, k.search_volume, k.location, p.name AS project_name, c.name AS client_name
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 LEFT JOIN seo_projects p ON p.id = dr.project_id
                 LEFT JOIN seo_clients c ON c.id = dr.client_id
                 WHERE dr.domain = $1 AND (dr.agency_id = $2 OR dr.agency_id IS NULL OR $2 IS NULL) ${projectFilter}
                 ORDER BY dr.rank_position`,
                params
            );
            return { domain, rankings: result.rows, total: result.rows.length };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get rankings');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete Tracked Domain ───
    fastify.delete('/api/domains', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { domain } = request.query;
        if (!domain) return reply.code(400).send({ error: 'domain is required' });

        try {
            log.info({ domain, agencyId: ctx.agencyId }, 'stopping tracking for domain');
            await db.query('DELETE FROM my_domains WHERE domain = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)', [domain, ctx.agencyId]);
            await db.query('DELETE FROM domain_rankings WHERE domain = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)', [domain, ctx.agencyId]);
            await db.query('DELETE FROM rank_history WHERE domain = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)', [domain, ctx.agencyId]);
            await db.query('DELETE FROM alerts WHERE domain = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)', [domain, ctx.agencyId]);
            return { success: true, message: `Stopped tracking ${domain}` };
        } catch (err) {
            log.error({ err: err.message, domain }, 'failed to delete domain');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Rank Trend (position over time) ───
    fastify.get('/api/rankings/trend', async (request, reply) => {
        const { domain, projectId, clientId, keywordId, days = 30 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        if (!keywordId || (!domain && !projectId && !clientId)) {
            return reply.code(400).send({ error: 'keywordId and one of domain, projectId, or clientId are required' });
        }

        try {
            const params = [parseInt(days) || 30];
            const filters = scopedConditions('rh', params, ctx, { domain, projectId, clientId });
            filters.push(`rh.keyword_id = $${params.length + 1}`);
            params.push(keywordId);

            const result = await db.query(
                `SELECT rh.rank_position, rh.previous_rank, rh.change_direction, rh.checked_at,
                        k.keyword, rh.project_id, rh.client_id
                 FROM rank_history rh
                 JOIN keywords k ON rh.keyword_id = k.id
                 WHERE rh.checked_at > NOW() - ($1 || ' days')::interval
                   AND ${filters.join(' AND ')}
                 ORDER BY rh.checked_at ASC`,
                params
            );

            const history = result.rows;
            if (history.length === 0) {
                return { domain: domain || null, projectId: projectId || null, clientId: clientId || null, keywordId, trend: [], summary: null };
            }

            const positions = history.map(h => h.rank_position).filter(p => p > 0);
            const first = positions[0];
            const last = positions[positions.length - 1];
            const direction = positions.length < 2 ? 'stable' : last < first ? 'improving' : last > first ? 'declining' : 'stable';
            const netChange = positions.length < 2 ? 0 : first - last;
            const avgPosition = positions.length
                ? Math.round(positions.reduce((a, b) => a + b, 0) / positions.length)
                : 0;

            return {
                domain: domain || null,
                projectId: projectId || null,
                clientId: clientId || null,
                keywordId,
                keyword: history[0].keyword,
                trend: history.map(h => ({
                    position: h.rank_position,
                    change: h.change_direction,
                    date: h.checked_at,
                })),
                summary: {
                    direction,
                    netChange,
                    bestPosition: positions.length ? Math.min(...positions) : 0,
                    worstPosition: positions.length ? Math.max(...positions) : 0,
                    avgPosition,
                    dataPoints: positions.length,
                },
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get trend');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Rank Volatility Index ───
    fastify.get('/api/rankings/volatility', async (request, reply) => {
        const { domain, projectId, clientId, days = 30 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        if (!domain && !projectId && !clientId) {
            return reply.code(400).send({ error: 'domain, projectId, or clientId is required' });
        }

        try {
            const keywordParams = [];
            const keywordFilters = scopedConditions('dr', keywordParams, ctx, { domain, projectId, clientId });
            const keywordsResult = await db.query(
                `SELECT DISTINCT k.id, k.keyword
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 WHERE ${keywordFilters.join(' AND ')}`,
                keywordParams
            );

            const keywords = keywordsResult.rows;
            if (keywords.length === 0) {
                return { domain: domain || null, projectId: projectId || null, clientId: clientId || null, volatilityIndex: 0, keywords: [] };
            }

            const historyParams = [parseInt(days) || 30];
            const historyFilters = scopedConditions('rh', historyParams, ctx, { domain, projectId, clientId });
            const historyResult = await db.query(
                `SELECT keyword_id, rank_position
                 FROM rank_history rh
                 WHERE rh.checked_at > NOW() - ($1 || ' days')::interval
                   AND rh.rank_position > 0
                   AND ${historyFilters.join(' AND ')}
                 ORDER BY rh.keyword_id, rh.checked_at ASC`,
                historyParams
            );

            const historyByKeyword = new Map();
            for (const row of historyResult.rows) {
                const list = historyByKeyword.get(row.keyword_id) || [];
                list.push(row.rank_position);
                historyByKeyword.set(row.keyword_id, list);
            }

            const perKeyword = [];
            let totalVolatility = 0;
            for (const kw of keywords) {
                const positions = historyByKeyword.get(kw.id) || [];
                if (positions.length < 2) {
                    perKeyword.push({ keyword: kw.keyword, volatility: 0, dataPoints: positions.length });
                    continue;
                }
                let totalChange = 0;
                for (let i = 1; i < positions.length; i++) totalChange += Math.abs(positions[i] - positions[i - 1]);
                const volatility = Math.round((totalChange / (positions.length - 1)) * 100) / 100;
                totalVolatility += volatility;
                perKeyword.push({ keyword: kw.keyword, volatility, dataPoints: positions.length });
            }

            const volatilityIndex = Math.round((totalVolatility / keywords.length) * 100) / 100;
            perKeyword.sort((a, b) => b.volatility - a.volatility);

            return {
                domain: domain || null,
                projectId: projectId || null,
                clientId: clientId || null,
                volatilityIndex,
                keywordCount: keywords.length,
                periodDays: parseInt(days) || 30,
                keywords: perKeyword,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get volatility');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Compare Rank Periods (this week vs last week, etc.) ───
    fastify.get('/api/rankings/compare-periods', async (request, reply) => {
        const { domain, projectId, clientId, periodDays = 7 } = request.query;
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        if (!domain && !projectId && !clientId) {
            return reply.code(400).send({ error: 'domain, projectId, or clientId is required' });
        }

        try {
            const days = parseInt(periodDays) || 7;
            const currentParams = [days];
            const currentFilters = scopedConditions('rh', currentParams, ctx, { domain, projectId, clientId });
            const currentResult = await db.query(
                `SELECT k.id as keyword_id, k.keyword,
                        ROUND(AVG(rh.rank_position) FILTER (WHERE rh.rank_position > 0)::numeric, 1) AS avg_position,
                        MIN(rh.rank_position) FILTER (WHERE rh.rank_position > 0) AS best_position,
                        COUNT(*) FILTER (WHERE rh.change_direction = 'up') AS improvements,
                        COUNT(*) FILTER (WHERE rh.change_direction = 'down') AS drops,
                        COUNT(*) FILTER (WHERE rh.rank_position > 0) AS checks
                 FROM rank_history rh
                 JOIN keywords k ON rh.keyword_id = k.id
                 WHERE rh.checked_at > NOW() - ($1 || ' days')::interval
                   AND ${currentFilters.join(' AND ')}
                 GROUP BY k.id, k.keyword`,
                currentParams
            );

            const previousParams = [days, days * 2];
            const previousFilters = scopedConditions('rh', previousParams, ctx, { domain, projectId, clientId });
            const previousResult = await db.query(
                `SELECT k.id as keyword_id,
                        ROUND(AVG(rh.rank_position) FILTER (WHERE rh.rank_position > 0)::numeric, 1) AS avg_position,
                        COUNT(*) FILTER (WHERE rh.rank_position > 0) AS checks
                 FROM rank_history rh
                 JOIN keywords k ON rh.keyword_id = k.id
                 WHERE rh.checked_at > NOW() - ($2 || ' days')::interval
                   AND rh.checked_at <= NOW() - ($1 || ' days')::interval
                   AND ${previousFilters.join(' AND ')}
                 GROUP BY k.id`,
                previousParams
            );

            const prevMap = {};
            for (const row of previousResult.rows) prevMap[row.keyword_id] = row;

            const comparison = currentResult.rows.map(curr => {
                const prev = prevMap[curr.keyword_id];
                const prevAvg = prev ? parseFloat(prev.avg_position) : null;
                const currAvg = curr.avg_position === null ? null : parseFloat(curr.avg_position);
                const change = prevAvg && currAvg ? Math.round((prevAvg - currAvg) * 10) / 10 : null;

                return {
                    keyword: curr.keyword,
                    currentAvg: currAvg,
                    previousAvg: prevAvg,
                    positionChange: change,
                    direction: change > 0 ? 'improved' : change < 0 ? 'dropped' : 'stable',
                    improvements: parseInt(curr.improvements, 10) || 0,
                    drops: parseInt(curr.drops, 10) || 0,
                };
            });

            const improved = comparison.filter(c => c.direction === 'improved').length;
            const dropped = comparison.filter(c => c.direction === 'dropped').length;
            const stable = comparison.filter(c => c.direction === 'stable').length;

            return {
                domain: domain || null,
                projectId: projectId || null,
                clientId: clientId || null,
                periodDays: days,
                summary: { improved, dropped, stable, total: comparison.length },
                keywords: comparison,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to compare periods');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = alertRoutes;
