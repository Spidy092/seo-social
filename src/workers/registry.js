/**
 * Worker registry — single source of truth for every background job.
 *
 * Before: each worker had its own `startXxx(db)` function and was wired
 * up by hand inside index.js. Adding a new worker meant editing 3 files
 * (the worker, the runner, the index).
 *
 * After: drop a file in `src/workers/jobs/` that exports
 *   { name, schedule, run, runOnce? }
 * and it is automatically picked up. See src/workers/jobs/* for examples.
 *
 * `schedule` can be:
 *   - a cron string   ('0 5 * * *')
 *   - an interval ms  (86400000)
 *   - a function (ctx) => cronString|interval
 *   - null            (only run once on startup, or only via manual trigger)
 */

const { loadModules } = require('../utils/loadModules');
const path = require('path');
const { createLogger } = require('../utils/logger');

const log = createLogger('worker-registry');

let _db = null;
let _jobs = [];
let _timers = [];

/**
 * Discover and validate every job file in src/workers/jobs.
 * Throws at startup if a job is malformed — better than a silent no-op.
 */
function discover() {
    const dir = path.join(__dirname, 'jobs');
    const mods = loadModules(dir);

    const jobs = [];
    for (const [file, mod] of Object.entries(mods)) {
        if (!mod || typeof mod !== 'object') {
            throw new Error(`[worker-registry] ${file}.js must export an object with { name, schedule, run }`);
        }
        if (typeof mod.run !== 'function') {
            throw new Error(`[worker-registry] ${file}.js is missing a "run" function`);
        }
        jobs.push({
            name: mod.name || file,
            schedule: mod.schedule ?? null,
            runOnce: !!mod.runOnce,
            run: mod.run,
        });
    }
    _jobs = jobs;
    log.info({ count: jobs.length, jobs: jobs.map(j => j.name) }, 'discovered worker jobs');
    return jobs;
}

/**
 * Start all discovered jobs. Runs `runOnce` jobs once synchronously, then
 * schedules the periodic ones via node-cron or setInterval.
 */
async function startAll(db) {
    _db = db;
    if (!_jobs.length) discover();

    for (const job of _jobs) {
        if (job.runOnce) {
            log.info({ job: job.name }, 'running one-shot job');
            // Fire-and-forget; errors are logged inside each job
            Promise.resolve()
                .then(() => job.run(db))
                .catch(err => log.error({ err: err.message, job: job.name }, 'one-shot job failed'));
            continue;
        }

        const schedule = typeof job.schedule === 'function' ? job.schedule({ db }) : job.schedule;
        if (!schedule) {
            log.warn({ job: job.name }, 'job has no schedule and runOnce=false — skipping');
            continue;
        }

        const cron = require('node-cron');
        if (typeof schedule === 'string' && cron.validate(schedule)) {
            const t = cron.schedule(schedule, () => safeRun(job));
            _timers.push(t);
            log.info({ job: job.name, schedule }, 'scheduled cron job');
        } else if (typeof schedule === 'number' && schedule > 0) {
            const t = setInterval(() => safeRun(job), schedule);
            _timers.push(t);
            log.info({ job: job.name, schedule }, 'scheduled interval job');
        } else {
            log.warn({ job: job.name, schedule }, 'unknown schedule type — skipping');
        }
    }
}

/**
 * Run a specific job by name. Used by /api/admin/workers/* endpoints
 * (or tests) to trigger a job on demand.
 */
async function runJob(name) {
    const job = _jobs.find(j => j.name === name);
    if (!job) throw new Error(`unknown job: ${name}`);
    return job.run(_db);
}

function safeRun(job) {
    Promise.resolve()
        .then(() => job.run(_db))
        .catch(err => log.error({ err: err.message, job: job.name }, 'job failed'));
}

/**
 * Stop all timers. Called from graceful-shutdown handlers.
 */
function stopAll() {
    for (const t of _timers) {
        if (typeof t.stop === 'function') t.stop();
        else clearInterval(t);
    }
    _timers = [];
    log.info('all workers stopped');
}

function listJobs() {
    return _jobs.map(j => ({ name: j.name, schedule: j.schedule, runOnce: j.runOnce }));
}

module.exports = { discover, startAll, stopAll, runJob, listJobs };
