/**
 * 🚨 Alerts & Rank Tracking Routes
 */

const { createLogger } = require('../utils/logger');
const keywordService = require('../services/keywordService');

const log = createLogger('routes:alerts');

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
            const { domain } = request.body;
            const normalizedDomain = keywordService.extractDomain(domain);
            
            try {
                await db.query(
                    `INSERT INTO my_domains (domain) VALUES ($1)
                     ON CONFLICT (domain) DO NOTHING`,
                    [normalizedDomain]
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
        try {
            const result = await db.query(`
                SELECT d.*, 
                    (SELECT COUNT(*) FROM domain_rankings dr WHERE dr.domain = d.domain) as keyword_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'up' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days') as improved_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'down' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days') as dropped_count
                FROM my_domains d
                ORDER BY d.added_at DESC
            `);

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
        try {
            const result = await db.query(
                'SELECT COUNT(*) as count FROM alerts WHERE is_read = FALSE'
            );
            return { count: parseInt(result.rows[0].count) };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get unread count');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get All Alerts ───
    fastify.get('/api/alerts', async (request, reply) => {
        const { domain, unreadOnly = false, limit = 20, offset = 0 } = request.query;

        try {
            let baseConditions = [];
            const params = [];

            if (domain) {
                baseConditions.push(`a.domain = $${params.length + 1}`);
                params.push(domain);
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
                SELECT a.*, k.keyword
                FROM alerts a
                JOIN keywords k ON a.keyword_id = k.id
                ${whereClause}
            `;

            query += ` ORDER BY a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(limit, offset);

            const result = await db.query(query, params);

            // Get unread count
            const unreadResult = await db.query(
                'SELECT COUNT(*) as count FROM alerts WHERE is_read = FALSE'
            );

            return {
                alerts: result.rows,
                total: result.rows.length,
                unreadCount: parseInt(unreadResult.rows[0].count),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Mark All as Read ─── (must be BEFORE /:id/read to avoid Fastify matching "read-all" as :id)
    fastify.put('/api/alerts/read-all', async (request, reply) => {
        const { domain } = request.body || {};

        try {
            if (domain) {
                await db.query(
                    'UPDATE alerts SET is_read = TRUE WHERE domain = $1',
                    [domain]
                );
            } else {
                await db.query('UPDATE alerts SET is_read = TRUE');
            }

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to mark alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Mark Alert as Read ───
    fastify.put('/api/alerts/:id/read', async (request, reply) => {
        const { id } = request.params;

        try {
            await db.query(
                'UPDATE alerts SET is_read = TRUE WHERE id = $1',
                [id]
            );

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to mark alert');
            return reply.code(500).send({ error: err.message });
        }
    });



    // ─── Get Rank History ───
    fastify.get('/api/alerts/rank-history', async (request, reply) => {
        const { domain, keywordId, days = 30, limit = 50, offset = 0 } = request.query;

        try {
            let query = `
                SELECT rh.*, k.keyword
                FROM rank_history rh
                JOIN keywords k ON rh.keyword_id = k.id
                WHERE rh.checked_at > NOW() - INTERVAL '${parseInt(days)} days'
            `;
            const params = [];

            if (domain) {
                query += ` AND rh.domain = $${params.length + 1}`;
                params.push(domain);
            }

            if (keywordId) {
                query += ` AND rh.keyword_id = $${params.length + 1}`;
                params.push(keywordId);
            }

            query += ' ORDER BY rh.checked_at DESC';

            // Count total before pagination
            const countResult = await db.query(
                `SELECT COUNT(*) as total FROM (${query}) sub`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
            params.push(parseInt(limit), parseInt(offset));

            const result = await db.query(query, params);

            return {
                history: result.rows,
                total,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get rank history');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Current Rankings (deduplicated latest per domain+keyword) ───
    fastify.get('/api/rankings/current', async (request, reply) => {
        const { domain, limit = 100, offset = 0 } = request.query;

        try {
            const params = [];
            let whereClause = '';

            if (domain) {
                params.push(domain);
                whereClause = `WHERE dr.domain = $1`;
            }

            // Count total distinct keywords (case-insensitive and trimmed)
            const countResult = await db.query(
                `SELECT COUNT(DISTINCT LOWER(TRIM(k.keyword))) as total
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 ${whereClause}`,
                params
            );
            const total = parseInt(countResult.rows[0].total);

            // Fetch deduplicated current rankings (best rank per keyword text, latest check)
            const queryParams = [...params, parseInt(limit), parseInt(offset)];
            const result = await db.query(
                `SELECT DISTINCT ON (LOWER(TRIM(k.keyword)))
                        dr.domain, dr.rank_position, dr.url, dr.checked_at,
                        k.keyword, k.search_volume, k.location
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 ${whereClause}
                 ORDER BY LOWER(TRIM(k.keyword)), dr.rank_position ASC, dr.checked_at DESC
                 LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
                queryParams
            );

            return {
                rankings: result.rows,
                total,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get current rankings');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Rank Changes Summary ───
    fastify.get('/api/alerts/summary', async (request, reply) => {
        const { domain } = request.query;

        try {
            if (!domain) {
                return reply.code(400).send({ error: 'domain is required' });
            }

            // Get current rankings
            const currentRankings = await db.query(
                `SELECT dr.*, k.keyword, k.search_volume
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 WHERE dr.domain = $1
                 ORDER BY dr.rank_position`,
                [domain]
            );

            // Get recent changes
            const recentChanges = await db.query(
                `SELECT 
                    COUNT(*) FILTER (WHERE change_direction = 'up') as improved,
                    COUNT(*) FILTER (WHERE change_direction = 'down') as dropped,
                    COUNT(*) FILTER (WHERE change_direction = 'same') as stable,
                    COUNT(*) FILTER (WHERE change_direction = 'new') as new_rankings
                 FROM rank_history
                 WHERE domain = $1 AND checked_at > NOW() - INTERVAL '7 days'`,
                [domain]
            );

            // Get alerts count
            const alertsCount = await db.query(
                `SELECT COUNT(*) as count FROM alerts 
                 WHERE domain = $1 AND is_read = FALSE`,
                [domain]
            );

            return {
                domain,
                currentRankings: currentRankings.rows,
                totalKeywords: currentRankings.rows.length,
                changes: recentChanges.rows[0],
                unreadAlerts: parseInt(alertsCount.rows[0].count),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get summary');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete Alert ───
    fastify.delete('/api/alerts/:id', async (request, reply) => {
        const { id } = request.params;

        try {
            await db.query('DELETE FROM alerts WHERE id = $1', [id]);
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to delete alert');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get My Tracked Domains (alias for /api/alerts/domains) ───
    fastify.get('/api/domains', async (request, reply) => {
        try {
            const result = await db.query(`
                SELECT d.*, 
                    (SELECT COUNT(*) FROM domain_rankings dr WHERE dr.domain = d.domain) as keyword_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'up' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days') as improved_count,
                    (SELECT COUNT(*) FROM rank_history rh 
                     WHERE rh.domain = d.domain AND rh.change_direction = 'down' 
                     AND rh.checked_at > NOW() - INTERVAL '7 days') as dropped_count
                FROM my_domains d
                ORDER BY d.added_at DESC
            `);
            return { domains: result.rows, total: result.rows.length };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get domains');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Add Domain (alias) ───
    fastify.post('/api/domains', {
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
            const { domain } = request.body;
            const normalizedDomain = keywordService.extractDomain(domain);
            try {
                await db.query(
                    `INSERT INTO my_domains (domain) VALUES ($1) ON CONFLICT (domain) DO NOTHING`,
                    [normalizedDomain]
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
                required: ['domain'],
                properties: {
                    domain: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { domain } = request.body;
            try {
                log.info({ domain }, 'manual rank check triggered');
                const { manualRankCheck } = require('../workers/rankTracker');
                const results = await manualRankCheck(db, domain);
                return { success: true, domain, results };
            } catch (err) {
                log.error({ err: err.message }, 'manual rank check failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Domain Rankings ───
    fastify.get('/api/rankings/:domain', async (request, reply) => {
        const { domain } = request.params;
        try {
            const result = await db.query(
                `SELECT dr.*, k.keyword, k.search_volume
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 WHERE dr.domain = $1
                 ORDER BY dr.rank_position`,
                [domain]
            );
            return { domain, rankings: result.rows, total: result.rows.length };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get rankings');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete Tracked Domain ───
    fastify.delete('/api/domains', async (request, reply) => {
        const { domain } = request.query;
        if (!domain) return reply.code(400).send({ error: 'domain is required' });

        try {
            log.info({ domain }, 'stopping tracking for domain');
            // Delete from all relevant tables
            await db.query('DELETE FROM my_domains WHERE domain = $1', [domain]);
            await db.query('DELETE FROM domain_rankings WHERE domain = $1', [domain]);
            await db.query('DELETE FROM rank_history WHERE domain = $1', [domain]);
            await db.query('DELETE FROM alerts WHERE domain = $1', [domain]);

            return { success: true, message: `Stopped tracking ${domain}` };
        } catch (err) {
            log.error({ err: err.message, domain }, 'failed to delete domain');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = alertRoutes;
