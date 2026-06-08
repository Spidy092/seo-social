/**
 * Page Optimization Routes
 *
 * POST /api/page-optimization/analyze   - run an analysis
 * GET  /api/page-optimization/history   - list past analyses
 * GET  /api/page-optimization/:id       - get a specific analysis
 * DELETE /api/page-optimization/:id     - delete an analysis
 */

const { createLogger } = require('../utils/logger');
const { optimizePage } = require('../services/pageOptimizationService');

const log = createLogger('routes:page-optimization');

async function pageOptimizationRoutes(fastify, options) {
    const { db } = options;

    fastify.post('/api/page-optimization/analyze', {
        schema: {
            body: {
                type: 'object',
                required: ['url', 'keyword'],
                properties: {
                    url:      { type: 'string' },
                    keyword:  { type: 'string' },
                    location: { type: 'string', default: 'India' },
                },
            },
        },
        handler: async (request, reply) => {
            const { url, keyword, location = 'India' } = request.body || {};
            const userId = request.session?.get('userId') || null;

            if (!url || !keyword) {
                return reply.code(400).send({ error: 'Both URL and target keyword are required.' });
            }

            try {
                log.info({ url, keyword, location, userId }, 'page optimization analyze started');
                const result = await optimizePage({ url, keyword, location });

                // Persist a summary for history view
                let savedId = null;
                try {
                    const insert = await db.query(
                        `INSERT INTO page_optimizations
                         (user_id, url, keyword, location, my_score, avg_competitor_score, gaps, my_data, competitors, summary)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         RETURNING id`,
                        [
                            userId,
                            result.url,
                            result.keyword,
                            result.location,
                            result.report.myScore,
                            result.report.averageCompetitorScore,
                            JSON.stringify(result.report.gaps),
                            JSON.stringify({
                                overall: result.myAnalysis.overall,
                                meta: result.myAnalysis.meta,
                                headings: result.myAnalysis.headings,
                                content: result.myAnalysis.content,
                                images: result.myAnalysis.images,
                                links: result.myAnalysis.links,
                                schema: result.myAnalysis.schema,
                            }),
                            JSON.stringify(result.competitors.map(c => ({
                                domain: c.domain,
                                url: c.url,
                                position: c.position,
                                error: c.error,
                                wordCount: c.analysis?.wordCount || 0,
                                hasSchema: c.analysis?.hasSchema || false,
                                internalLinks: c.analysis?.internalLinks || 0,
                                hasFaqSchema: c.analysis?.hasFaqSchema || false,
                            }))),
                            JSON.stringify({
                                high: result.report.highPriorityGaps,
                                medium: result.report.mediumPriorityGaps,
                                low: result.report.lowPriorityGaps,
                                competitorCount: result.report.competitorCount,
                            }),
                        ]
                    );
                    savedId = insert.rows[0].id;
                } catch (persistErr) {
                    log.warn({ err: persistErr.message }, 'failed to persist page optimization');
                }

                return { success: true, id: savedId, result };
            } catch (err) {
                log.error({ err: err.message, url, keyword }, 'page optimization failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.get('/api/page-optimization/history', async (request, reply) => {
        const userId = request.session?.get('userId') || null;
        const { limit = 20, offset = 0 } = request.query || {};
        try {
            const params = [userId, parseInt(limit), parseInt(offset)];
            const result = await db.query(
                `SELECT id, url, keyword, location, my_score, avg_competitor_score, summary, created_at
                 FROM page_optimizations
                 WHERE user_id = $1 OR user_id IS NULL
                 ORDER BY created_at DESC
                 LIMIT $2 OFFSET $3`,
                params
            );

            const totalResult = await db.query(
                `SELECT COUNT(*) AS total
                 FROM page_optimizations
                 WHERE user_id = $1 OR user_id IS NULL`,
                [userId]
            );

            return {
                total: parseInt(totalResult.rows[0].total, 10),
                history: result.rows,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list page optimization history');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/page-optimization/:id', async (request, reply) => {
        const userId = request.session?.get('userId') || null;
        const { id } = request.params;
        try {
            const result = await db.query(
                `SELECT id, url, keyword, location, my_score, avg_competitor_score, gaps, my_data, competitors, summary, created_at
                 FROM page_optimizations
                 WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)
                 LIMIT 1`,
                [id, userId]
            );
            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Optimization report not found' });
            }
            return { optimization: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message, id }, 'failed to load page optimization');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.delete('/api/page-optimization/:id', async (request, reply) => {
        const userId = request.session?.get('userId') || null;
        const { id } = request.params;
        try {
            await db.query(
                'DELETE FROM page_optimizations WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)',
                [id, userId]
            );
            return { success: true };
        } catch (err) {
            log.error({ err: err.message, id }, 'failed to delete page optimization');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = pageOptimizationRoutes;
