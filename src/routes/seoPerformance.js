/**
 * Combined SEO Performance Routes — GSC + GA4 by page URL.
 */

const seoPerformance = require('../services/seoPerformanceService');
const { getAgencyContext } = require('../utils/authHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:seo-performance');

async function assertClientAccess(db, clientId, agencyId) {
    const res = await db.query(
        `SELECT id FROM seo_clients
         WHERE id = $1 AND agency_id = $2`,
        [clientId, agencyId]
    );
    return res.rows[0] || null;
}

async function seoPerformanceRoutes(fastify, { db }) {
    fastify.get('/api/seo-performance/overview/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }
        return { ok: true, data: await seoPerformance.getOverview(db, request.params.clientId) };
    });

    fastify.get('/api/seo-performance/pages/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }
        return {
            ok: true,
            data: await seoPerformance.getPagePerformance(db, request.params.clientId, {
                limit: request.query.limit,
            }),
        };
    });

    fastify.get('/api/seo-performance/keyword-pages/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }
        return {
            ok: true,
            data: await seoPerformance.getKeywordPagePerformance(db, request.params.clientId, {
                limit: request.query.limit,
            }),
        };
    });

    fastify.get('/api/seo-performance/opportunities/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }
        return {
            ok: true,
            data: await seoPerformance.getOpportunities(db, request.params.clientId, {
                limit: request.query.limit,
            }),
        };
    });

    fastify.post('/api/seo-performance/create-tasks/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClientAccess(db, clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }

        const { projectId, limit = 10 } = request.body || {};
        if (!projectId) return reply.code(400).send({ error: 'projectId is required' });

        const projectCheck = await db.query(
            `SELECT p.id
             FROM seo_projects p
             JOIN seo_clients c ON c.id = p.client_id
             WHERE p.id = $1 AND p.client_id = $2 AND c.agency_id = $3`,
            [projectId, clientId, ctx.agencyId]
        );
        if (!projectCheck.rows.length) {
            return reply.code(403).send({ error: 'Project not found or access denied' });
        }

        try {
            const tasks = await seoPerformance.createTasksFromOpportunities(db, {
                clientId,
                projectId,
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                limit,
            });
            return { success: true, tasks, generatedCount: tasks.length };
        } catch (err) {
            log.error({ err: err.message, clientId, projectId }, 'failed to create SEO performance tasks');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/seo-performance/create-alerts/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClientAccess(db, clientId, ctx.agencyId)) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }

        try {
            const alerts = await seoPerformance.createAlertsFromOpportunities(db, {
                clientId,
                limit: request.body?.limit || 10,
            });
            return { success: true, alerts, generatedCount: alerts.length };
        } catch (err) {
            log.error({ err: err.message, clientId }, 'failed to create SEO performance alerts');
            return reply.code(500).send({ error: err.message });
        }
    });

}

module.exports = seoPerformanceRoutes;
