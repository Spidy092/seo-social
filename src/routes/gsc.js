/**
 * GSC Routes — /api/gsc/* — Agency-scoped
 * All routes require authentication (enforced by the global preValidation hook).
 */

const gsc = require('../services/gscService');
const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:gsc');


async function recordGscSyncRun(db, {
    userId = null,
    agencyId = null,
    clientId,
    siteUrl,
    syncType = 'manual',
    status,
    rowsSynced = 0,
    dateStart = null,
    dateEnd = null,
    errorMessage = null,
    startedAt = new Date(),
}) {
    await db.query(
        `INSERT INTO gsc_sync_runs
         (user_id, agency_id, client_id, site_url, sync_type, status, rows_synced, date_start, date_end, error_message, started_at, finished_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
        [userId, agencyId, clientId, siteUrl, syncType, status, rowsSynced, dateStart, dateEnd, errorMessage, startedAt]
    ).catch(err => log.warn({ err: err.message, clientId }, 'failed to record GSC sync run'));
}

async function gscRoutes(fastify, { db }) {


    // ── GET /api/gsc/clients ────────────────────────────────────────────────
    // Client-wise GSC connection manager for agencies
    fastify.get('/api/gsc/clients', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const result = await db.query(
            `WITH latest_sync AS (
                SELECT client_id, MAX(date_start) AS latest_date_start
                FROM gsc_search_analytics
                GROUP BY client_id
             ), latest_metrics AS (
                SELECT
                    g.client_id,
                    SUM(CASE WHEN g.dimension_type = 'query' THEN g.clicks ELSE 0 END) AS clicks,
                    SUM(CASE WHEN g.dimension_type = 'query' THEN g.impressions ELSE 0 END) AS impressions,
                    COUNT(*) AS rows_count,
                    MAX(g.created_at) AS last_synced_at
                FROM gsc_search_analytics g
                JOIN latest_sync ls
                  ON ls.client_id = g.client_id
                 AND ls.latest_date_start = g.date_start
                GROUP BY g.client_id
             )
             SELECT
                c.id,
                c.name,
                c.website_url,
                c.gsc_site_url,
                c.updated_at,
                COALESCE(lm.clicks, 0) AS clicks,
                COALESCE(lm.impressions, 0) AS impressions,
                COALESCE(lm.rows_count, 0) AS rows_count,
                lm.last_synced_at
             FROM seo_clients c
             LEFT JOIN latest_metrics lm ON lm.client_id = c.id
             WHERE c.agency_id = $1 OR c.agency_id IS NULL
             ORDER BY c.updated_at DESC`,
            [ctx.agencyId]
        );

        return reply.send({ ok: true, clients: result.rows });
    });


    // ── GET /api/gsc/sync-log ───────────────────────────────────────────────
    // Latest GSC sync attempts across connected clients
    fastify.get('/api/gsc/sync-log', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const clientId = request.query.clientId || null;
        const limit = Math.max(1, Math.min(100, Number(request.query.limit) || 25));
        const params = clientId ? [ctx.agencyId, clientId, limit] : [ctx.agencyId, limit];
        const clientFilter = clientId ? 'AND r.client_id = $2' : '';
        const limitPlaceholder = clientId ? '$3' : '$2';

        const result = await db.query(
            `SELECT
                r.id,
                r.client_id,
                c.name AS client_name,
                r.site_url,
                r.sync_type,
                r.status,
                r.rows_synced,
                r.date_start,
                r.date_end,
                r.error_message,
                r.started_at,
                r.finished_at,
                r.created_at
             FROM gsc_sync_runs r
             JOIN seo_clients c ON c.id = r.client_id
             WHERE (c.agency_id = $1 OR c.agency_id IS NULL)
               ${clientFilter}
             ORDER BY r.created_at DESC
             LIMIT ${limitPlaceholder}`,
            params
        );

        return reply.send({ ok: true, runs: result.rows });
    });

    // ── GET /api/gsc/properties ─────────────────────────────────────────────
    // List all GSC properties the service account has access to
    fastify.get('/api/gsc/properties', async (request, reply) => {
        try {
            const properties = await gsc.listProperties();
            return reply.send({ ok: true, properties });
        } catch (err) {
            log.error({ err: err.message }, 'listProperties failed');
            return reply.code(err.message.includes('GSC_SERVICE_ACCOUNT_JSON') ? 503 : 500).send({
                error: err.message,
            });
        }
    });

    // ── POST /api/gsc/connect ───────────────────────────────────────────────
    // Link a GSC property URL to a client record
    // Body: { clientId, siteUrl }
    fastify.post('/api/gsc/connect', async (request, reply) => {
        const { clientId, siteUrl } = request.body || {};
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        if (!clientId || !siteUrl) {
            return reply.code(400).send({ error: 'clientId and siteUrl are required' });
        }

        // Verify the client belongs to this agency
        const clientCheck = await db.query(
            `SELECT id FROM seo_clients WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`,
            [clientId, ctx.agencyId]
        );
        if (!clientCheck.rows.length) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }

        const normalized = gsc.normalizeSiteUrl(siteUrl);
        await db.query(
            `UPDATE seo_clients SET gsc_site_url = $1, updated_at = NOW() WHERE id = $2`,
            [normalized, clientId]
        );

        log.info({ clientId, siteUrl: normalized }, 'GSC property connected');
        return reply.send({ success: true, siteUrl: normalized });
    });

    // ── DELETE /api/gsc/disconnect/:clientId ────────────────────────────────
    // Remove the GSC connection from a client
    fastify.delete('/api/gsc/disconnect/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const clientCheck = await db.query(
            `SELECT id FROM seo_clients WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`,
            [clientId, ctx.agencyId]
        );
        if (!clientCheck.rows.length) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }

        await db.query(
            `UPDATE seo_clients SET gsc_site_url = NULL, updated_at = NOW() WHERE id = $1`,
            [clientId]
        );
        // Clear stored data
        await db.query(`DELETE FROM gsc_search_analytics WHERE client_id = $1`, [clientId]);

        return reply.send({ success: true });
    });


    // ── POST /api/gsc/sync-all ──────────────────────────────────────────────
    // Sync every connected GSC client for the current agency
    fastify.post('/api/gsc/sync-all', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const days = Number(request.body?.days) || Number(process.env.GSC_SYNC_DAYS) || 30;

        const clients = await db.query(
            `SELECT id, name, gsc_site_url
             FROM seo_clients
             WHERE (agency_id = $1 OR agency_id IS NULL)
               AND gsc_site_url IS NOT NULL
               AND TRIM(gsc_site_url) <> ''
             ORDER BY updated_at DESC`,
            [ctx.agencyId]
        );

        const results = [];
        for (const client of clients.rows) {
            const startedAt = new Date();
            try {
                const result = await gsc.syncGscPerformance(db, {
                    clientId: client.id,
                    userId: ctx.userId,
                    siteUrl: client.gsc_site_url,
                    days,
                });
                await recordGscSyncRun(db, {
                    userId: ctx.userId,
                    agencyId: ctx.agencyId,
                    clientId: client.id,
                    siteUrl: result.siteUrl || client.gsc_site_url,
                    syncType: 'bulk',
                    status: 'success',
                    rowsSynced: result.rows || 0,
                    dateStart: result.startDate,
                    dateEnd: result.endDate,
                    startedAt,
                });
                results.push({
                    clientId: client.id,
                    name: client.name,
                    siteUrl: client.gsc_site_url,
                    success: true,
                    rows: result.rows || 0,
                });
            } catch (err) {
                log.error({ err: err.message, clientId: client.id }, 'GSC bulk sync failed for client');
                await recordGscSyncRun(db, {
                    userId: ctx.userId,
                    agencyId: ctx.agencyId,
                    clientId: client.id,
                    siteUrl: client.gsc_site_url,
                    syncType: 'bulk',
                    status: 'failed',
                    errorMessage: err.message,
                    startedAt,
                });
                results.push({
                    clientId: client.id,
                    name: client.name,
                    siteUrl: client.gsc_site_url,
                    success: false,
                    error: err.message,
                });
            }
        }

        return reply.send({
            success: true,
            total: results.length,
            synced: results.filter(result => result.success).length,
            failed: results.filter(result => !result.success).length,
            results,
        });
    });

    // ── POST /api/gsc/sync/:clientId ────────────────────────────────────────
    // Manually trigger a data sync for a specific client
    // Optional body: { days: 30 }
    fastify.post('/api/gsc/sync/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const days = Number(request.body?.days) || 30;

        const clientRes = await db.query(
            `SELECT id, gsc_site_url FROM seo_clients WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`,
            [clientId, ctx.agencyId]
        );
        if (!clientRes.rows.length) {
            return reply.code(403).send({ error: 'Client not found or access denied' });
        }

        const { gsc_site_url } = clientRes.rows[0];
        if (!gsc_site_url) {
            return reply.code(400).send({ error: 'No GSC property connected for this client. Use /api/gsc/connect first.' });
        }

        const startedAt = new Date();
        try {
            const result = await gsc.syncGscPerformance(db, {
                clientId, userId: ctx.userId, siteUrl: gsc_site_url, days,
            });
            await recordGscSyncRun(db, {
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                clientId,
                siteUrl: result.siteUrl || gsc_site_url,
                syncType: 'manual',
                status: 'success',
                rowsSynced: result.rows || 0,
                dateStart: result.startDate,
                dateEnd: result.endDate,
                startedAt,
            });
            return reply.send({ success: true, ...result });
        } catch (err) {
            log.error({ err: err.message, clientId }, 'GSC sync failed');
            await recordGscSyncRun(db, {
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                clientId,
                siteUrl: gsc_site_url,
                syncType: 'manual',
                status: 'failed',
                errorMessage: err.message,
                startedAt,
            });
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── GET /api/gsc/overview/:clientId ─────────────────────────────────────
    // Summary stats: total clicks, impressions, avg CTR, avg position
    fastify.get('/api/gsc/overview/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const clientCheck = await db.query(
            `SELECT id, gsc_site_url FROM seo_clients WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL)`,
            [clientId, ctx.agencyId]
        );
        if (!clientCheck.rows.length) {
            return reply.code(403).send({ error: 'Access denied' });
        }

        const overview = await gsc.getOverview(db, clientId);
        const siteUrl  = clientCheck.rows[0].gsc_site_url;
        return reply.send({ success: true, siteUrl, data: overview });
    });

    // ── GET /api/gsc/top-queries/:clientId ──────────────────────────────────
    fastify.get('/api/gsc/top-queries/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const limit  = Number(request.query.limit) || 20;

        const check = await db.query(`SELECT id FROM seo_clients WHERE id=$1 AND (agency_id=$2 OR agency_id IS NULL)`, [clientId, ctx.agencyId]);
        if (!check.rows.length) return reply.code(403).send({ ok: false, error: 'Access denied' });

        const rows = await gsc.getTopQueries(db, clientId, limit);
        return reply.send({ success: true, data: rows });
    });

    // ── GET /api/gsc/top-pages/:clientId ────────────────────────────────────
    fastify.get('/api/gsc/top-pages/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const limit  = Number(request.query.limit) || 20;

        const check = await db.query(`SELECT id FROM seo_clients WHERE id=$1 AND (agency_id=$2 OR agency_id IS NULL)`, [clientId, ctx.agencyId]);
        if (!check.rows.length) return reply.code(403).send({ ok: false, error: 'Access denied' });

        const rows = await gsc.getTopPages(db, clientId, limit);
        return reply.send({ success: true, data: rows });
    });

    // ── GET /api/gsc/low-ctr/:clientId ──────────────────────────────────────
    // Pages with high impressions but low click-through rate
    fastify.get('/api/gsc/low-ctr/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const minImp = Number(request.query.minImpressions) || 100;
        const maxCtr = Number(request.query.maxCtr)         || 0.02; // 2%

        const check = await db.query(`SELECT id FROM seo_clients WHERE id=$1 AND (agency_id=$2 OR agency_id IS NULL)`, [clientId, ctx.agencyId]);
        if (!check.rows.length) return reply.code(403).send({ ok: false, error: 'Access denied' });

        const rows = await gsc.getLowCtrPages(db, clientId, minImp, maxCtr);
        return reply.send({ success: true, data: rows });
    });

    // ── GET /api/gsc/opportunities/:clientId ────────────────────────────────
    // Keywords in position 8–20 with decent impressions (quick wins)
    fastify.get('/api/gsc/opportunities/:clientId', async (request, reply) => {
        const { clientId } = request.params;
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const minPos  = Number(request.query.minPos)         || 8;
        const maxPos  = Number(request.query.maxPos)         || 20;
        const minImp  = Number(request.query.minImpressions) || 30;

        const check = await db.query(`SELECT id FROM seo_clients WHERE id=$1 AND (agency_id=$2 OR agency_id IS NULL)`, [clientId, ctx.agencyId]);
        if (!check.rows.length) return reply.code(403).send({ ok: false, error: 'Access denied' });

        const rows = await gsc.getOpportunities(db, clientId, minPos, maxPos, minImp);
        return reply.send({ success: true, data: rows });
    });

    // ── GET /api/gsc/status ─────────────────────────────────────────────────
    // Check if service account is configured correctly
    fastify.get('/api/gsc/status', async (_request, reply) => {
        const configured = !!process.env.GSC_SERVICE_ACCOUNT_JSON;
        if (!configured) {
            return reply.send({
                success: false,
                configured: false,
                message: 'GSC_SERVICE_ACCOUNT_JSON is not set in .env',
            });
        }
        try {
            JSON.parse(process.env.GSC_SERVICE_ACCOUNT_JSON);
            return reply.send({ success: true, configured: true, message: 'Service account JSON is valid' });
        } catch {
            return reply.send({ success: false, configured: false, message: 'GSC_SERVICE_ACCOUNT_JSON is invalid JSON' });
        }
    });
}

module.exports = gscRoutes;
