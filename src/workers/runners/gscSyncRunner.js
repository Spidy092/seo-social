/**
 * Standalone entry point for the GSC sync worker.
 * Run via PM2 as a separate process: node src/workers/runners/gscSyncRunner.js
 */
require('dotenv').config();
const db = require('../../db');
const { startGscSync } = require('../gscSync');
const { startAnalyticsCron } = require('../../services/analyticsSync');
const { createLogger } = require('../../utils/logger');

const log = createLogger('gsc-sync-runner');

async function main() {
    log.info('Starting GSC sync + analytics workers...');
    try {
        await db.initializeDatabase();
        startGscSync(db);
        startAnalyticsCron();
        log.info('GSC sync + analytics workers started');
    } catch (err) {
        log.error({ err }, 'Failed to start GSC sync worker');
        process.exit(1);
    }
}

process.on('SIGTERM', () => { log.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { log.info('SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => { log.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'Unhandled rejection'); });

main();
