const { getAgencyContext } = require('../utils/authHelper');
const { getSourceHealth } = require('../services/sourceHealthService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:source-health');

async function sourceHealthRoutes(fastify, { db }) {
    fastify.get('/api/source-health', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            return { success: true, health: await getSourceHealth(db, ctx.agencyId) };
        } catch (err) {
            log.error({ err: err.message }, 'failed to build source health');
            return reply.code(500).send({ error: 'Unable to verify source health right now' });
        }
    });
}

module.exports = sourceHealthRoutes;
