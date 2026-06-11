/**
 * GSC Sync Worker
 * Runs daily at 4 AM to sync Google Search Console data for all clients
 * that have a gsc_site_url configured.
 *
 * Triggered from index.js via startGscSync(db).
 */

const cron = require('node-cron');
const { syncGscPerformance } = require('../services/gscService');
const { hasServiceAccountJson } = require('../utils/googleServiceAccount');
const { createLogger } = require('../utils/logger');

const log = createLogger('gsc-sync-worker');

// How many days of data to pull on each sync (can be overridden per run)
const DEFAULT_DAYS = Number(process.env.GSC_SYNC_DAYS) || 30;


async function recordGscSyncRun(db, {
    userId = null,
    clientId,
    siteUrl,
    status,
    rowsSynced = 0,
    dateStart = null,
    dateEnd = null,
    errorMessage = null,
    startedAt = new Date(),
}) {
    await db.query(
        `INSERT INTO gsc_sync_runs
         (user_id, client_id, site_url, sync_type, status, rows_synced, date_start, date_end, error_message, started_at, finished_at)
         VALUES ($1,$2,$3,'daily',$4,$5,$6,$7,$8,$9,NOW())`,
        [userId, clientId, siteUrl, status, rowsSynced, dateStart, dateEnd, errorMessage, startedAt]
    ).catch(err => log.warn({ err: err.message, clientId }, 'failed to record GSC daily sync run'));
}

async function runSync(db) {
    // Skip entirely if service account is not configured
    if (!hasServiceAccountJson('GSC_SERVICE_ACCOUNT_JSON')) {
        log.warn('GOOGLE_SERVICE_ACCOUNT_JSON or GSC_SERVICE_ACCOUNT_JSON not set — skipping GSC sync');
        return;
    }

    log.info('Starting GSC daily sync...');

    // Fetch all clients that have a GSC property linked
    let clients;
    try {
        const res = await db.query(
            `SELECT id, user_id, gsc_site_url, name
             FROM seo_clients
             WHERE gsc_site_url IS NOT NULL AND gsc_site_url != ''
             ORDER BY updated_at ASC`
        );
        clients = res.rows;
    } catch (err) {
        log.error({ err: err.message }, 'Failed to fetch clients for GSC sync');
        return;
    }

    if (!clients.length) {
        log.info('No clients have GSC properties configured — nothing to sync');
        return;
    }

    log.info({ count: clients.length }, `Syncing ${clients.length} client(s)`);

    let success = 0;
    let failed  = 0;

    for (const client of clients) {
        const startedAt = new Date();
        try {
            const result = await syncGscPerformance(db, {
                clientId: client.id,
                userId:   client.user_id,
                siteUrl:  client.gsc_site_url,
                days:     DEFAULT_DAYS,
            });
            await recordGscSyncRun(db, {
                userId: client.user_id,
                clientId: client.id,
                siteUrl: result.siteUrl || client.gsc_site_url,
                status: 'success',
                rowsSynced: result.rows || 0,
                dateStart: result.startDate,
                dateEnd: result.endDate,
                startedAt,
            });
            log.info(
                { clientId: client.id, name: client.name, rows: result.rows },
                'GSC sync complete'
            );
            success++;
        } catch (err) {
            await recordGscSyncRun(db, {
                userId: client.user_id,
                clientId: client.id,
                siteUrl: client.gsc_site_url,
                status: 'failed',
                errorMessage: err.message,
                startedAt,
            });
            log.error(
                { clientId: client.id, name: client.name, err: err.message },
                'GSC sync failed'
            );
            failed++;
        }

        // Small delay between clients to avoid API rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    log.info({ success, failed }, 'GSC daily sync finished');
}

function startGscSync(db) {
    // Daily at 4:00 AM server time (rank tracker runs at 3 AM)
    cron.schedule('0 4 * * *', () => {
        runSync(db).catch(err =>
            log.error({ err: err.message }, 'Unhandled error in GSC sync worker')
        );
    });

    log.info('GSC sync worker scheduled — daily at 04:00');
}

module.exports = { startGscSync, runSync };
