const { auditSite } = require('../services/technicalSeoService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:technical');

async function technicalRoutes(fastify, options) {
    const { db } = options;

    fastify.post('/api/technical/audit', {
        schema: {
            body: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' },
                    maxPages: { type: 'integer', minimum: 5, maximum: 50, default: 20 },
                },
            },
        },
        handler: async (request, reply) => {
            const { url, maxPages = 20 } = request.body;
            const userId = request.session.get('userId') || null;

            try {
                log.info({ url, maxPages, userId }, 'technical seo audit started');
                const result = await auditSite(url, { maxPages });
                const insert = await db.query(
                    `INSERT INTO technical_audits
                     (user_id, site_url, status, pages_crawled, overall_score, summary, issues, pages, robots_txt, sitemaps)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                     RETURNING id`,
                    [
                        userId,
                        result.siteUrl,
                        'completed',
                        result.summary.pagesCrawled,
                        result.overall,
                        JSON.stringify(result.summary),
                        JSON.stringify(result.issues),
                        JSON.stringify(result.pages),
                        JSON.stringify(result.robotsTxt),
                        JSON.stringify(result.sitemaps),
                    ]
                );

                return {
                    success: true,
                    auditId: insert.rows[0].id,
                    result,
                };
            } catch (err) {
                log.error({ err: err.message, url }, 'technical seo audit failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.get('/api/technical/audit/:id', {
        handler: async (request, reply) => {
            const userId = request.session.get('userId') || null;
            const { id } = request.params;

            try {
                const result = await db.query(
                    `SELECT id, site_url, pages_crawled, overall_score, summary, issues, pages, robots_txt, sitemaps, created_at
                     FROM technical_audits
                     WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
                     LIMIT 1`,
                    [id, userId]
                );

                if (!result.rows.length) {
                    return reply.code(404).send({ error: 'Audit not found' });
                }

                const row = result.rows[0];
                return {
                    success: true,
                    result: {
                        auditId: row.id,
                        siteUrl: row.site_url,
                        overall: row.overall_score,
                        summary: row.summary || {},
                        issues: row.issues || [],
                        pages: row.pages || [],
                        robotsTxt: row.robots_txt || {},
                        sitemaps: row.sitemaps || [],
                        analyzedAt: row.created_at,
                    },
                };
            } catch (err) {
                log.error({ err: err.message, id }, 'technical seo audit lookup failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });
}

module.exports = technicalRoutes;
