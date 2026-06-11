/**
 * Standalone entry point for the post scheduler worker.
 * Run via PM2 as a separate process: node src/workers/runners/postSchedulerRunner.js
 */
require('dotenv').config();
const { startScheduler } = require('../postScheduler');
const { createLogger } = require('../../utils/logger');

const log = createLogger('post-scheduler-runner');

async function main() {
    log.info('Starting post scheduler worker...');
    try {
        startScheduler();
        log.info('Post scheduler worker started');
    } catch (err) {
        log.error({ err }, 'Failed to start post scheduler worker');
        process.exit(1);
    }
}

process.on('SIGTERM', () => { log.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT', () => { log.info('SIGINT received'); process.exit(0); });
process.on('uncaughtException', (err) => { log.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'Unhandled rejection'); });

main();
