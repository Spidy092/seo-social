/**
 * GA4 Routes — /api/ga4/* — Agency-scoped
 * Service-account only. No OAuth flow.
 */

const ga4 = require('../services/ga4Service');
const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:ga4');

async function recordGa4SyncRun(db, {
    userId = null,
    agencyId = null,
    clientId,
    propertyId,
    syncType = 'manual',
    status,
    rowsSynced = 0,
    dateStart = null,
    dateEnd = null,
    errorMessage = null,
    startedAt = new Date(),
}) {
    await db.query(
        `INSERT INTO ga4_sync_runs
         (user_id, agency_id, client_id, property_id, sync_type, status, rows_synced, date_start, date_end, error_message, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [userId, agencyId, clientId, propertyId, syncType, status, rowsSynced, dateStart, dateEnd, errorMessage, startedAt]
    ).catch(err => log.warn({ err: err.message, clientId }, 'failed to record GA4 sync run'));
}

async function assertClientAccess(db, clientId, agencyId) {
    const res = await db.query(
        `SELECT id, name, website_url, ga4_property_id
         FROM seo_clients
         WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)`,
        [clientId, agencyId]
    );
    return res.rows[0] || null;
}

async function ga4Routes(fastify, { db }) {
    fastify.get('/api/ga4/clients', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const result = await db.query(
            `WITH latest AS (
                SELECT client_id, MAX(date_start) AS latest_date_start
                FROM ga4_page_analytics
                GROUP BY client_id
             ), latest_metrics AS (
                SELECT g.client_id,
                       SUM(g.sessions) AS sessions,
                       SUM(g.users) AS users,
                       SUM(g.conversions) AS conversions,
                       COUNT(*) AS rows_count,
                       MAX(g.created_at) AS last_synced_at
                FROM ga4_page_analytics g
                JOIN latest l ON l.client_id = g.client_id AND l.latest_date_start = g.date_start
                GROUP BY g.client_id
             )
             SELECT c.id, c.name, c.website_url, c.ga4_property_id, c.ga4_property_name,
                    c.ga4_connected_at, c.ga4_last_synced_at,
                    COALESCE(lm.sessions, 0) AS sessions,
                    COALESCE(lm.users, 0) AS users,
                    COALESCE(lm.conversions, 0) AS conversions,
                    COALESCE(lm.rows_count, 0) AS rows_count,
                    lm.last_synced_at
             FROM seo_clients c
             LEFT JOIN latest_metrics lm ON lm.client_id = c.id
             WHERE c.agency_id = $1 OR c.agency_id IS NULL OR $1 IS NULL
             ORDER BY c.updated_at DESC`,
            [ctx.agencyId]
        );

        return { ok: true, clients: result.rows };
    });

    fastify.get('/api/ga4/sync-log', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const clientId = request.query.clientId || null;
        const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
        const params = clientId ? [ctx.agencyId, clientId, limit] : [ctx.agencyId, limit];
        const clientFilter = clientId ? 'AND r.client_id = $2' : '';
        const limitPlaceholder = clientId ? '$3' : '$2';

        const result = await db.query(
            `SELECT r.*, c.name AS client_name
             FROM ga4_sync_runs r
             JOIN seo_clients c ON c.id = r.client_id
             WHERE (c.agency_id = $1 OR c.agency_id IS NULL OR $1 IS NULL)
               ${clientFilter}
             ORDER BY r.created_at DESC
             LIMIT ${limitPlaceholder}`,
            params
        );

        return { ok: true, runs: result.rows };
    });

    fastify.post('/api/ga4/connect', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { clientId, propertyId, propertyName } = request.body || {};
        if (!clientId || !propertyId) {
            return reply.code(400).send({ error: 'clientId and propertyId are required' });
        }

        const client = await assertClientAccess(db, clientId, ctx.agencyId);
        if (!client) return reply.code(403).send({ error: 'Client not found or access denied' });

        const cleanPropertyId = ga4.normalizePropertyId(propertyId);
        await db.query(
            `UPDATE seo_clients
             SET ga4_property_id = $1, ga4_property_name = $2, ga4_connected_at = NOW(), updated_at = NOW()
             WHERE id = $3`,
            [cleanPropertyId, propertyName || null, clientId]
        );

        return { success: true, propertyId: cleanPropertyId };
    });

    fastify.delete('/api/ga4/disconnect/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { clientId } = request.params;
        const client = await assertClientAccess(db, clientId, ctx.agencyId);
        if (!client) return reply.code(403).send({ error: 'Client not found or access denied' });

        await db.query(
            `UPDATE seo_clients
             SET ga4_property_id = NULL, ga4_property_name = NULL, ga4_connected_at = NULL, ga4_last_synced_at = NULL, updated_at = NOW()
             WHERE id = $1`,
            [clientId]
        );
        await db.query('DELETE FROM ga4_page_analytics WHERE client_id = $1', [clientId]);

        return { success: true };
    });

    fastify.post('/api/ga4/sync/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { clientId } = request.params;
        const days = Number(request.body?.days) || Number(process.env.GA4_SYNC_DAYS) || 30;
        const client = await assertClientAccess(db, clientId, ctx.agencyId);
        if (!client) return reply.code(403).send({ error: 'Client not found or access denied' });
        if (!client.ga4_property_id) return reply.code(400).send({ error: 'Client does not have a GA4 property connected' });

        const startedAt = new Date();
        try {
            const result = await ga4.syncGa4Performance(db, {
                clientId,
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                propertyId: client.ga4_property_id,
                baseUrl: client.website_url,
                days,
            });
            await recordGa4SyncRun(db, {
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                clientId,
                propertyId: result.propertyId,
                status: 'success',
                rowsSynced: result.rows,
                dateStart: result.startDate,
                dateEnd: result.endDate,
                startedAt,
            });
            return { success: true, ...result };
        } catch (err) {
            await recordGa4SyncRun(db, {
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                clientId,
                propertyId: client.ga4_property_id,
                status: 'failed',
                errorMessage: err.message,
                startedAt,
            });
            log.error({ err: err.message, clientId }, 'GA4 sync failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/ga4/sync-all', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const days = Number(request.body?.days) || Number(process.env.GA4_SYNC_DAYS) || 30;
        const clients = await db.query(
            `SELECT id, name, website_url, ga4_property_id
             FROM seo_clients
             WHERE (agency_id = $1 OR agency_id IS NULL OR $1 IS NULL)
               AND ga4_property_id IS NOT NULL
               AND TRIM(ga4_property_id) <> ''
             ORDER BY updated_at DESC`,
            [ctx.agencyId]
        );

        const results = [];
        for (const client of clients.rows) {
            const startedAt = new Date();
            try {
                const result = await ga4.syncGa4Performance(db, {
                    clientId: client.id,
                    userId: ctx.userId,
                    agencyId: ctx.agencyId,
                    propertyId: client.ga4_property_id,
                    baseUrl: client.website_url,
                    days,
                });
                await recordGa4SyncRun(db, {
                    userId: ctx.userId,
                    agencyId: ctx.agencyId,
                    clientId: client.id,
                    propertyId: result.propertyId,
                    syncType: 'bulk',
                    status: 'success',
                    rowsSynced: result.rows,
                    dateStart: result.startDate,
                    dateEnd: result.endDate,
                    startedAt,
                });
                results.push({ clientId: client.id, name: client.name, success: true, rows: result.rows });
            } catch (err) {
                await recordGa4SyncRun(db, {
                    userId: ctx.userId,
                    agencyId: ctx.agencyId,
                    clientId: client.id,
                    propertyId: client.ga4_property_id,
                    syncType: 'bulk',
                    status: 'failed',
                    errorMessage: err.message,
                    startedAt,
                });
                results.push({ clientId: client.id, name: client.name, success: false, error: err.message });
            }
        }

        return { success: true, results };
    });

    fastify.get('/api/ga4/overview/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) return reply.code(403).send({ error: 'Client not found or access denied' });
        return { ok: true, data: await ga4.getOverview(db, request.params.clientId) };
    });

    fastify.get('/api/ga4/top-pages/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) return reply.code(403).send({ error: 'Client not found or access denied' });
        const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 20));
        return { ok: true, data: await ga4.getTopPages(db, request.params.clientId, limit) };
    });

    fastify.get('/api/ga4/devices/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) return reply.code(403).send({ error: 'Client not found or access denied' });
        return { ok: true, data: await ga4.getDeviceBreakdown(db, request.params.clientId) };
    });

    fastify.get('/api/ga4/countries/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) return reply.code(403).send({ error: 'Client not found or access denied' });
        return { ok: true, data: await ga4.getCountryBreakdown(db, request.params.clientId) };
    });

    fastify.get('/api/ga4/sources/:clientId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        if (!await assertClientAccess(db, request.params.clientId, ctx.agencyId)) return reply.code(403).send({ error: 'Client not found or access denied' });
        return { ok: true, data: await ga4.getSourceBreakdown(db, request.params.clientId) };
    });
}

module.exports = ga4Routes;
