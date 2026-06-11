/**
 * Standalone entry point for the scheduled email reports worker.
 * Run via PM2 as a separate process: node src/workers/runners/scheduledReportsRunner.js
 */
require('dotenv').config();
const db = require('../../db');
const { startScheduledReports } = require('../scheduledReports');
const { createLogger } = require('../../utils/logger');

const log = createLogger('scheduled-reports-runner');

async function main() {
    log.info('Starting scheduled reports worker...');
    try {
        await db.initializeDatabase();
        startScheduledReports(db);
        log.info('Scheduled reports worker started');
    } catch (err) {
        log.error({ err }, 'Failed to start scheduled reports worker');
        process.exit(1);
    }
}

process.on('SIGTERM', () => { log.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { log.info('SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => { log.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'Unhandled rejection'); });

main();
