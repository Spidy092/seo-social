/**
 * Background worker: process queued project audits.
 *
 * Auto-discovered by src/workers/registry.js as a `runOnce: true` job.
 * `run(db)` sets up a polling interval that picks up pending audits and
 * runs them in the background. Returns immediately so the server boot
 * is not blocked.
 *
 * How audits are queued:
 *   - Manually:    POST /api/projects/:id/audits
 *   - Auto on create: hooked into POST /api/clients/:id/projects
 *   - Scheduled:   jobs/weeklyAuditReauditJob.js (separate)
 */
const orchestrator = require('../../services/auditOrchestrator');
const auditSettings = require('../../services/auditSettings');
const { createLogger } = require('../../utils/logger');

const log = createLogger('project-audit-worker');

let _timer = null;
let _active = 0;
let _db = null;
let _intervalMs = 30000;

async function processOne(auditId) {
    _active++;
    try {
        const { rows } = await _db.query(
            `SELECT project_id FROM project_audits WHERE id = $1`,
            [auditId],
        );
        if (!rows.length) return;
        // Pass the existing audit row so the orchestrator updates the
        // same row instead of creating a new one.
        await orchestrator.runProjectAudit(_db, rows[0].project_id, {
            audit: { id: auditId },
        });
    } catch (err) {
        log.error({ err: err.message, auditId }, 'audit failed');
        await _db.query(
            `UPDATE project_audits
             SET status='failed', error_message=$1, completed_at=NOW()
             WHERE id=$2 AND status IN ('pending','running')`,
            [err.message, auditId],
        ).catch(() => {});
    } finally {
        _active--;
    }
}

async function poll() {
    if (!_db) return;
    try {
        // Master switch + concurrency cap (both from global settings)
        const enabled = await auditSettings.isMasterEnabled(_db);
        if (!enabled) return;
        const globalSettings = await auditSettings.getGlobalSettings(_db);
        const globalCap = globalSettings.maxConcurrentAudits || 2;
        if (_active >= globalCap) return;

        const { rows } = await _db.query(
            `SELECT id FROM project_audits
             WHERE status = 'pending'
             ORDER BY created_at ASC
             LIMIT $1`,
            [globalCap - _active],
        );
        for (const row of rows) {
            await _db.query(
                `UPDATE project_audits
                 SET status='running', started_at=COALESCE(started_at, NOW())
                 WHERE id=$1 AND status='pending'`,
                [row.id],
            );
            processOne(row.id).catch(err =>
                log.error({ err: err.message, auditId: row.id }, 'processOne crashed'),
            );
        }
    } catch (err) {
        log.error({ err: err.message }, 'audit poll failed');
    }
}

module.exports = {
    name: 'project-audits',
    // runOnce=true so the registry fires it once at boot. The function
    // sets up a long-lived interval and returns immediately.
    runOnce: true,
    run: async (db) => {
        _db = db;
        if (_timer) return;
        // Resolve poll interval from global settings, then schedule
        const settings = await auditSettings.getGlobalSettings(_db, { bypassCache: true });
        _intervalMs = settings.pollIntervalMs || 30000;
        _timer = setInterval(poll, _intervalMs);
        if (_timer.unref) _timer.unref();
        log.info({ intervalMs: _intervalMs, maxConcurrent: settings.maxConcurrentAudits || 2 }, 'project audit worker started');
    },
};
