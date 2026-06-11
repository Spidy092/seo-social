/**
 * GA4 Sync Worker
 * Runs daily at 5 AM to sync GA4 landing-page analytics for connected clients.
 */

const cron = require('node-cron');
const { syncGa4Performance } = require('../services/ga4Service');
const { hasServiceAccountJson } = require('../utils/googleServiceAccount');
const { createLogger } = require('../utils/logger');

const log = createLogger('ga4-sync-worker');
const DEFAULT_DAYS = Number(process.env.GA4_SYNC_DAYS) || 30;

async function recordGa4SyncRun(db, {
    userId = null,
    agencyId = null,
    clientId,
    propertyId,
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
         VALUES ($1,$2,$3,$4,'daily',$5,$6,$7,$8,$9,$10,NOW())`,
        [userId, agencyId, clientId, propertyId, status, rowsSynced, dateStart, dateEnd, errorMessage, startedAt]
    ).catch(err => log.warn({ err: err.message, clientId }, 'failed to record GA4 daily sync run'));
}

async function runSync(db) {
    if (!hasServiceAccountJson('GA4_SERVICE_ACCOUNT_JSON')) {
        log.warn('GOOGLE_SERVICE_ACCOUNT_JSON or GA4_SERVICE_ACCOUNT_JSON not set — skipping GA4 sync');
        return;
    }

    let clients;
    try {
        const res = await db.query(
            `SELECT id, user_id, agency_id, name, website_url, ga4_property_id
             FROM seo_clients
             WHERE ga4_property_id IS NOT NULL AND TRIM(ga4_property_id) <> ''
             ORDER BY updated_at ASC`
        );
        clients = res.rows;
    } catch (err) {
        log.error({ err: err.message }, 'failed to fetch clients for GA4 sync');
        return;
    }

    if (!clients.length) {
        log.info('No clients have GA4 properties configured — nothing to sync');
        return;
    }

    let success = 0;
    let failed = 0;

    for (const client of clients) {
        const startedAt = new Date();
        try {
            const result = await syncGa4Performance(db, {
                clientId: client.id,
                userId: client.user_id,
                agencyId: client.agency_id,
                propertyId: client.ga4_property_id,
                baseUrl: client.website_url,
                days: DEFAULT_DAYS,
            });
            await recordGa4SyncRun(db, {
                userId: client.user_id,
                agencyId: client.agency_id,
                clientId: client.id,
                propertyId: result.propertyId,
                status: 'success',
                rowsSynced: result.rows || 0,
                dateStart: result.startDate,
                dateEnd: result.endDate,
                startedAt,
            });
            log.info({ clientId: client.id, name: client.name, rows: result.rows }, 'GA4 sync complete');
            success++;
        } catch (err) {
            await recordGa4SyncRun(db, {
                userId: client.user_id,
                agencyId: client.agency_id,
                clientId: client.id,
                propertyId: client.ga4_property_id,
                status: 'failed',
                errorMessage: err.message,
                startedAt,
            });
            log.error({ clientId: client.id, name: client.name, err: err.message }, 'GA4 sync failed');
            failed++;
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    log.info({ success, failed }, 'GA4 daily sync finished');
}

function startGa4Sync(db) {
    cron.schedule('0 5 * * *', () => {
        runSync(db).catch(err => log.error({ err: err.message }, 'Unhandled error in GA4 sync worker'));
    });
    log.info('GA4 sync worker scheduled — daily at 05:00');
}

module.exports = { startGa4Sync, runSync };
