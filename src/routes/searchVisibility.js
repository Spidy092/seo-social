/**
 * Search Visibility Control Center routes.
 */

const searchVisibility = require('../services/searchVisibilityService');
const { createTask } = require('../services/taskService');
const { getAgencyContext, assertClientAccess } = require('../utils/authHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:search-visibility');

async function assertClient(request, reply, db, clientId, ctx) {
    const client = await assertClientAccess(db, clientId, ctx.agencyId);
    if (!client) {
        reply.code(403).send({ error: 'Client not found or access denied' });
        return null;
    }
    return client;
}

async function searchVisibilityRoutes(fastify, { db }) {
    fastify.get('/api/search-visibility/status/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.getConnectionStatus(db, clientId, ctx.agencyId);
            return { ok: true, ...data };
        } catch (err) {
            log.error({ err: err.message, clientId }, 'failed to load search visibility status');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/search-visibility/inspect', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, inspectionUrl, languageCode } = request.body || {};
        if (!clientId || !inspectionUrl) {
            return reply.code(400).send({ error: 'clientId and inspectionUrl are required' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.inspectUrl(db, {
                clientId,
                agencyId: ctx.agencyId,
                userId: ctx.userId,
                inspectionUrl,
                languageCode,
            });
            return { ok: true, ...data };
        } catch (err) {
            const code = /blocked|must belong|Connect|required|fully-qualified|private network/i.test(err.message) ? 400 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.get('/api/search-visibility/sitemaps/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.listSitemaps(db, {
                clientId,
                agencyId: ctx.agencyId,
            });
            return { ok: true, ...data };
        } catch (err) {
            const code = /Connect|required/i.test(err.message) ? 400 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.post('/api/search-visibility/sitemaps/submit', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, sitemapUrl } = request.body || {};
        if (!clientId || !sitemapUrl) {
            return reply.code(400).send({ error: 'clientId and sitemapUrl are required' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.submitSitemap(db, {
                clientId,
                agencyId: ctx.agencyId,
                userId: ctx.userId,
                sitemapUrl,
            });
            return { ok: true, ...data };
        } catch (err) {
            const code = /blocked|must belong|Connect|required|fully-qualified|private network/i.test(err.message) ? 400 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.post('/api/search-visibility/indexnow/submit', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, urls } = request.body || {};
        if (!clientId || !urls) {
            return reply.code(400).send({ error: 'clientId and urls are required' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.submitIndexNow(db, {
                clientId,
                agencyId: ctx.agencyId,
                userId: ctx.userId,
                urls,
            });
            return { ok: true, ...data };
        } catch (err) {
            const code = /key|must|required|fully-qualified|private network|IndexNow returned/i.test(err.message) ? 400 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.post('/api/search-visibility/indexnow/connect', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, key, keyLocation } = request.body || {};
        const cleanKey = String(key || '').trim();
        const cleanLocation = String(keyLocation || '').trim();
        if (!clientId || !cleanKey) {
            return reply.code(400).send({ error: 'clientId and key are required' });
        }
        if (!/^[a-zA-Z0-9-]{8,128}$/.test(cleanKey)) {
            return reply.code(400).send({ error: 'IndexNow key must be 8-128 letters, numbers, or dashes' });
        }
        if (cleanLocation && !/^https?:\/\//i.test(cleanLocation)) {
            return reply.code(400).send({ error: 'keyLocation must be a full URL when provided' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        await db.query(
            `UPDATE seo_clients
             SET indexnow_key = $1, indexnow_key_location = $2, indexnow_connected_at = NOW(), updated_at = NOW()
             WHERE id = $3`,
            [cleanKey, cleanLocation || null, clientId]
        );

        return { ok: true, message: 'IndexNow key saved. Make sure the key file is hosted on the client website.' };
    });

    fastify.delete('/api/search-visibility/indexnow/disconnect/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        await db.query(
            `UPDATE seo_clients
             SET indexnow_key = NULL, indexnow_key_location = NULL, indexnow_connected_at = NULL, updated_at = NOW()
             WHERE id = $1`,
            [clientId]
        );

        return { ok: true, message: 'IndexNow disconnected' };
    });

    fastify.post('/api/search-visibility/google-indexing/notify', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, url, type, pageType } = request.body || {};
        if (!clientId || !url || !type || !pageType) {
            return reply.code(400).send({ error: 'clientId, url, type, and pageType are required' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const data = await searchVisibility.notifyGoogleIndexing(db, {
                clientId,
                agencyId: ctx.agencyId,
                userId: ctx.userId,
                url,
                type,
                pageType,
            });
            return { ok: true, ...data };
        } catch (err) {
            const code = /only available|blocked|must belong|required|fully-qualified|private network|type must/i.test(err.message) ? 400 : 500;
            return reply.code(code).send({ error: err.message });
        }
    });

    fastify.get('/api/search-visibility/actions/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const actions = await searchVisibility.getActions(db, {
                clientId,
                agencyId: ctx.agencyId,
                limit: request.query.limit,
                provider: request.query.provider,
                actionType: request.query.actionType,
                status: request.query.status,
            });
            return { ok: true, actions };
        } catch (err) {
            return reply.code(500).send({ error: err.message });
        }
    });


    fastify.post('/api/search-visibility/create-alerts/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        try {
            const alerts = await searchVisibility.createAlertsFromActions(db, {
                clientId,
                agencyId: ctx.agencyId,
                limit: request.body?.limit || 20,
            });
            return { ok: true, alerts, generatedCount: alerts.length };
        } catch (err) {
            log.error({ err: err.message, clientId }, 'failed to create search visibility alerts');
            return reply.code(500).send({ error: err.message });
        }
    });


    fastify.post('/api/search-visibility/create-tasks/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId } = request.params;
        const { projectId, limit = 20 } = request.body || {};
        if (!projectId) return reply.code(400).send({ error: 'projectId is required' });
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        const projectCheck = await db.query(
            'SELECT p.id FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id WHERE p.id = $1 AND p.client_id = $2 AND (c.agency_id = $3 OR c.agency_id IS NULL OR $3 IS NULL) LIMIT 1',
            [projectId, clientId, ctx.agencyId]
        );
        if (!projectCheck.rows.length) {
            return reply.code(403).send({ error: 'Project not found or access denied' });
        }

        try {
            const tasks = await searchVisibility.createTasksFromActions(db, {
                clientId,
                projectId,
                agencyId: ctx.agencyId,
                userId: ctx.userId,
                limit,
            });
            return { ok: true, tasks, generatedCount: tasks.length };
        } catch (err) {
            log.error({ err: err.message, clientId, projectId }, 'failed to create search visibility tasks');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/search-visibility/create-task', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const { clientId, projectId, title, description, url, recommendation } = request.body || {};
        if (!clientId || !projectId || !title) {
            return reply.code(400).send({ error: 'clientId, projectId, and title are required' });
        }
        if (!await assertClient(request, reply, db, clientId, ctx)) return;

        const projectCheck = await db.query(
            `SELECT p.id
             FROM seo_projects p
             JOIN seo_clients c ON c.id = p.client_id
             WHERE p.id = $1 AND p.client_id = $2
               AND (c.agency_id = $3 OR c.agency_id IS NULL OR $3 IS NULL)
             LIMIT 1`,
            [projectId, clientId, ctx.agencyId]
        );
        if (!projectCheck.rows.length) {
            return reply.code(403).send({ error: 'Project not found or access denied' });
        }

        try {
            const task = await createTask({
                clientId,
                projectId,
                title,
                description: description || recommendation || '',
                category: 'technical',
                impact: 'high',
                effort: 'medium',
                priority: 'high',
                status: 'todo',
            }, ctx.userId);

            await searchVisibility.recordIndexingAction(db, {
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                clientId,
                provider: 'system',
                actionType: 'task_created',
                status: 'success',
                url,
                normalizedUrl: url ? undefined : null,
                requestPayload: { projectId, title, description, recommendation },
                responsePayload: { taskId: task.id },
                recommendations: recommendation ? [recommendation] : [],
            }).catch(err => log.warn({ err: err.message }, 'failed to record task-created action'));

            return { ok: true, task };
        } catch (err) {
            log.error({ err: err.message, clientId, projectId }, 'failed to create search visibility task');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = searchVisibilityRoutes;
