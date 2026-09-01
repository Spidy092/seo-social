/**
 * 🤖 Autopilot Routes
 *
 * POST /api/autopilot/run      - run the full research -> analysis -> action-plan pipeline
 * GET  /api/autopilot/history  - list past autopilot runs
 * GET  /api/autopilot/:id      - get a specific past run
 */

const { runAutopilot } = require('../services/autopilotService');
const { requireAgencyContext } = require('../utils/authHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:autopilot');

async function autopilotRoutes(fastify, options) {
    const { db } = options;

    fastify.post('/api/autopilot/run', {
        schema: {
            body: {
                type: 'object',
                required: ['keyword', 'myDomain'],
                properties: {
                    keyword: { type: 'string' },
                    myDomain: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                    projectId: { type: 'string' },
                    clientId: { type: 'string' },
                    autoCreateTasks: { type: 'boolean', default: false },
                    maxTasks: { type: 'integer', default: 5, minimum: 1, maximum: 10 },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;

            const {
                keyword,
                myDomain,
                location = 'India',
                projectId = null,
                clientId = null,
                autoCreateTasks = false,
                maxTasks = 5,
            } = request.body;

            try {
                log.info({ keyword, myDomain, projectId, autoCreateTasks }, 'autopilot run started');

                const result = await runAutopilot({
                    keyword,
                    myDomain,
                    location,
                    projectId: projectId || null,
                    clientId: clientId || null,
                    autoCreateTasks,
                    maxTasks,
                    userId: ctx.userId,
                });

                let runId = null;
                try {
                    const insert = await db.query(
                        `INSERT INTO autopilot_runs
                         (user_id, agency_id, project_id, keyword, my_domain, location, ai_verdict, ai_score, result, tasks_created)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         RETURNING id`,
                        [
                            ctx.userId,
                            ctx.agencyId || null,
                            projectId || null,
                            keyword,
                            myDomain,
                            location,
                            result.comparison?.aiAnalysis?.verdict || null,
                            result.comparison?.aiAnalysis?.aiScore ?? null,
                            JSON.stringify(result),
                            result.tasksCreated.length,
                        ]
                    );
                    runId = insert.rows[0].id;
                } catch (persistErr) {
                    log.warn({ err: persistErr.message }, 'failed to persist autopilot run (non-fatal)');
                }

                return { success: true, runId, result };
            } catch (err) {
                log.error({ err: err.message }, 'autopilot run failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.get('/api/autopilot/history', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        const limit = Math.min(parseInt(request.query.limit) || 10, 50);
        try {
            const res = await db.query(
                `SELECT id, keyword, my_domain, location, ai_verdict, ai_score, tasks_created, created_at
                 FROM autopilot_runs
                 WHERE user_id = $1
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [ctx.userId, limit]
            );
            return { success: true, history: res.rows };
        } catch (err) {
            log.error({ err: err.message }, 'autopilot history fetch failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/autopilot/:id', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            const res = await db.query(
                `SELECT * FROM autopilot_runs WHERE id = $1 AND user_id = $2`,
                [request.params.id, ctx.userId]
            );
            if (!res.rows.length) {
                return reply.code(404).send({ error: 'Autopilot run not found' });
            }
            return { success: true, run: res.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'autopilot run fetch failed');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = autopilotRoutes;
