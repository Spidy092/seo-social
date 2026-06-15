/**
 * Ranked Keywords Routes
 *
 *   GET  /api/projects/:id/ranked-keywords?url=...&refresh=true|false
 *   POST /api/projects/:id/ranked-keywords   body: { url, refresh }
 *
 * The dashboard auto-loads the data via the main
 * `/api/projects/:id/dashboard` payload. These endpoints exist for:
 *   - the in-card URL input (Enter to re-query for a different URL)
 *   - the in-card "Refresh" button (POST with refresh: true)
 */

const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');
const rankedKeywords = require('../services/rankedKeywordsService');

const log = createLogger('routes:ranked-keywords');

async function assertProjectAccess(db, projectId, ctx) {
    const { rows } = await db.query(
        `SELECT p.id, p.client_id, c.agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL)`,
        [projectId, ctx.agencyId],
    );
    return rows[0] || null;
}

function parseRefresh(value) {
    if (value === true) return true;
    if (value === false || value === undefined || value === null) return false;
    if (typeof value === 'string') return /^(1|true|yes)$/i.test(value);
    return Boolean(value);
}

module.exports = async function (fastify, options) {
    const { db } = options;

    fastify.get('/api/projects/:id/ranked-keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const url = typeof request.query.url === 'string' ? request.query.url : null;
        const forceRefresh = parseRefresh(request.query.refresh);

        try {
            const result = await rankedKeywords.getRankedKeywords(db, {
                projectId: id,
                clientId: project.client_id,
                agencyId: ctx.agencyId,
                url,
                forceRefresh,
            });
            return { success: true, ...result };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'ranked-keywords GET failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/projects/:id/ranked-keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const body = request.body || {};
        const url = typeof body.url === 'string' ? body.url : null;
        const forceRefresh = parseRefresh(body.refresh);

        try {
            const result = await rankedKeywords.getRankedKeywords(db, {
                projectId: id,
                clientId: project.client_id,
                agencyId: ctx.agencyId,
                url,
                forceRefresh,
            });
            return { success: true, ...result };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'ranked-keywords POST failed');
            return reply.code(500).send({ error: err.message });
        }
    });
};
