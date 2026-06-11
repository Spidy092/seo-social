/**
 * Standalone entry point for the rank tracker worker.
 * Run via PM2 as a separate process: node src/workers/runners/rankTrackerRunner.js
 */
require('dotenv').config();
const db = require('../../db');
const { startRankTracker } = require('../rankTracker');
const { createLogger } = require('../../utils/logger');

const log = createLogger('rank-tracker-runner');

async function main() {
    log.info('Starting rank tracker worker...');
    try {
        await db.initializeDatabase();
        startRankTracker(db);
        log.info('Rank tracker worker started');
    } catch (err) {
        log.error({ err }, 'Failed to start rank tracker worker');
        process.exit(1);
    }
}

process.on('SIGTERM', () => { log.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { log.info('SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => { log.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'Unhandled rejection'); });

main();
