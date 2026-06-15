#!/usr/bin/env node
/**
 * Generic PM2 worker entry point.
 *
 * Usage:
 *   node src/workers/runner.js <job-name> [--no-db]
 *
 *   node src/workers/runner.js rank-tracker
 *   node src/workers/runner.js gsc-sync
 *   node src/workers/runner.js post-scheduler
 *
 * PM2 config (ecosystem.config.js) is updated to point all worker apps
 * at this single file with a different --job argument. Replaces the
 * previous 4 separate runner files in src/workers/runners/.
 */
require('dotenv').config();
const { createLogger } = require('../utils/logger');
const registry = require('./registry');

const log = createLogger('worker-runner');

const args = process.argv.slice(2);
const jobName = args[0];
const needsDb = !args.includes('--no-db');

if (!jobName) {
    log.error('usage: node src/workers/runner.js <job-name> [--no-db]');
    log.error('available jobs: ' + registry.listJobs().map(j => j.name).join(', '));
    process.exit(1);
}

async function main() {
    log.info({ job: jobName }, 'starting worker...');
    try {
        if (needsDb) {
            const db = require('../db');
            await db.initializeDatabase();
        }
        registry.discover();
        const result = await registry.runJob(jobName);
        // Most startXxx() functions are non-returning (they schedule crons
        // and return). We just keep the process alive.
        void result;
        log.info({ job: jobName }, 'worker started');
    } catch (err) {
        log.error({ err: err.message, job: jobName }, 'failed to start worker');
        process.exit(1);
    }
}

process.on('SIGTERM', () => { log.info('SIGTERM received'); process.exit(0); });
process.on('SIGINT',  () => { log.info('SIGINT received');  process.exit(0); });
process.on('uncaughtException', (err) => { log.error({ err }, 'Uncaught exception'); process.exit(1); });
process.on('unhandledRejection', (reason) => { log.error({ err: reason }, 'Unhandled rejection'); });

main();
