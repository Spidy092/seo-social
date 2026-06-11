const { auditSite } = require('../services/technicalSeoService');
const { runPageSpeed } = require('../services/pageSpeedService');
const { createLogger } = require('../utils/logger');
const { getAgencyContext, requireAgencyContext, assertClientAccess } = require('../utils/authHelper');

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
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;

            try {
                log.info({ url, maxPages }, 'technical seo audit started');
                const result = await auditSite(url, { maxPages });
                const insert = await db.query(
                    `INSERT INTO technical_audits
                     (user_id, agency_id, site_url, status, pages_crawled, overall_score, summary, issues, pages, robots_txt, sitemaps)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     RETURNING id`,
                    [
                        ctx?.userId || null,
                        ctx?.agencyId || null,
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


    fastify.post('/api/technical/pagespeed', {
        schema: {
            body: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string' },
                    strategy: { type: 'string', enum: ['mobile', 'desktop'], default: 'mobile' },
                    clientId: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { url, strategy = 'mobile', clientId = null } = request.body;
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            try {
                if (clientId && !await assertClientAccess(db, clientId, ctx.agencyId)) {
                    return reply.code(403).send({ error: 'Client not found or access denied' });
                }
                log.info({ url, strategy, clientId }, 'PageSpeed check started');
                const result = await runPageSpeed(url, { strategy });
                const insert = await db.query(
                    `INSERT INTO page_speed_checks
                     (user_id, agency_id, client_id, url, final_url, strategy, performance_score, accessibility_score, best_practices_score, seo_score, result)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
                     RETURNING id, created_at`,
                    [
                        ctx?.userId || null,
                        ctx?.agencyId || null,
                        clientId || null,
                        result.url,
                        result.finalUrl || result.url,
                        result.strategy || strategy,
                        result.scores?.performance ?? null,
                        result.scores?.accessibility ?? null,
                        result.scores?.bestPractices ?? null,
                        result.scores?.seo ?? null,
                        JSON.stringify(result),
                    ]
                );
                return { success: true, checkId: insert.rows[0].id, createdAt: insert.rows[0].created_at, result };
            } catch (err) {
                log.error({ err: err.message, url, strategy, clientId }, 'PageSpeed check failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });


    fastify.get('/api/technical/pagespeed/checks', {
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { clientId } = request.query || {};
            try {
                const agencyId = ctx?.agencyId || null;
                const params = clientId ? [clientId, agencyId] : [agencyId];
                const where = clientId
                    ? 'WHERE psc.client_id = $1 AND (psc.agency_id = $2 OR psc.agency_id IS NULL OR $2 IS NULL)'
                    : 'WHERE (psc.agency_id = $1 OR psc.agency_id IS NULL OR $1 IS NULL)';
                const result = await db.query(
                    `SELECT psc.id, psc.client_id, c.name AS client_name, psc.url, psc.final_url, psc.strategy,
                            psc.performance_score, psc.accessibility_score, psc.best_practices_score,
                            psc.seo_score, psc.created_at
                     FROM page_speed_checks psc
                     LEFT JOIN seo_clients c ON c.id = psc.client_id
                     ${where}
                     ORDER BY psc.created_at DESC
                     LIMIT 20`,
                    params
                );
                return { success: true, checks: result.rows };
            } catch (err) {
                log.error({ err: err.message, clientId }, 'PageSpeed checks lookup failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.get('/api/technical/audit/:id', {
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { id } = request.params;

            try {
                const result = await db.query(
                    `SELECT id, site_url, pages_crawled, overall_score, summary, issues, pages, robots_txt, sitemaps, created_at
                     FROM technical_audits
                     WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)
                     LIMIT 1`,
                    [id, ctx?.agencyId || null]
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
