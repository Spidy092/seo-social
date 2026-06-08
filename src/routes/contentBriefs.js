const contentBriefService = require('../services/contentBriefService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:content-briefs');

async function contentBriefRoutes(fastify, options) {
    const { db } = options;

    async function assertProjectAccess(projectId, userId) {
        if (!projectId) return null;

        const projectAccess = await db.query(
            `SELECT p.id, p.client_id
             FROM seo_projects p
             JOIN seo_clients c ON c.id = p.client_id
             WHERE p.id = $1 AND c.user_id = $2`,
            [projectId, userId]
        );

        return projectAccess.rows[0] || null;
    }

    fastify.post('/api/content/brief', {
        schema: {
            body: {
                type: 'object',
                required: ['keyword'],
                properties: {
                    keyword: { type: 'string', minLength: 2, maxLength: 250 },
                    location: { type: 'string', default: 'India' },
                    audience: { type: 'string', default: '' },
                    brandVoice: { type: 'string', default: '' },
                    myDomain: { type: 'string', default: '' },
                    projectId: { type: 'string' },
                    numResults: { type: 'integer', minimum: 5, maximum: 20, default: 10 },
                    useAi: { type: 'boolean', default: true },
                },
            },
        },
        handler: async (request, reply) => {
            try {
                const userId = request.session.get('userId') || null;
                const projectId = request.body.projectId || null;

                if (projectId) {
                    const projectAccess = await assertProjectAccess(projectId, userId);
                    if (!projectAccess) {
                        return reply.code(404).send({ error: 'Project not found' });
                    }
                }

                const brief = await contentBriefService.generateContentBrief(request.body);

                let savedBrief = null;
                if (userId) {
                    const saved = await db.query(
                        `INSERT INTO content_briefs
                         (user_id, project_id, keyword, location, brief, source_metrics)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         RETURNING id, created_at`,
                        [
                            userId,
                            projectId,
                            brief.keyword,
                            brief.location,
                            JSON.stringify(brief),
                            JSON.stringify(brief.sourceData || {}),
                        ]
                    );
                    savedBrief = saved.rows[0] || null;
                }

                return {
                    success: true,
                    briefId: savedBrief?.id || null,
                    savedAt: savedBrief?.created_at || null,
                    brief,
                };
            } catch (err) {
                log.error({ err: err.message }, 'content brief generation failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.get('/api/content/briefs', async (request, reply) => {
        try {
            const userId = request.session.get('userId');
            const limit = Math.min(parseInt(request.query.limit || '10', 10), 25);

            const { rows } = await db.query(
                `SELECT id, project_id, keyword, location, brief, created_at
                 FROM content_briefs
                 WHERE user_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [userId, limit]
            );

            return {
                success: true,
                briefs: rows,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to load content briefs');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = contentBriefRoutes;
