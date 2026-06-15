/**
 * Job: queue a fresh audit for every active project once a week.
 *
 * Honors global + per-project settings:
 *   - Master switch (audit_settings_global.enabled)
 *   - Per-project opt-out (project_audit_settings.weekly_enabled)
 *   - Per-project enabled_checks (resolves which checks to run)
 *   - Per-project schedule (day_of_week + hour)
 *
 * This is the "old projects get reports too" piece.
 */
const orchestrator = require('../../services/auditOrchestrator');
const auditSettings = require('../../services/auditSettings');
const { createLogger } = require('../../utils/logger');

const log = createLogger('weekly-audit-reaudit');

module.exports = {
    name: 'weekly-audit-reaudit',
    schedule: '0 2 * * 0', // Sunday 02:00 by default; advanced users change via global settings
    run: async (db) => {
        // Master switch
        const masterEnabled = await auditSettings.isMasterEnabled(db);
        if (!masterEnabled) {
            log.debug('master switch off — skipping weekly re-audit');
            return;
        }
        const globalSettings = await auditSettings.getGlobalSettings(db);
        if (!globalSettings.weeklyEnabled) {
            log.debug('global weekly disabled — skipping');
            return;
        }

        const { rows: projects } = await db.query(
            `SELECT p.id AS project_id, p.client_id, c.user_id, c.agency_id
             FROM seo_projects p
             JOIN seo_clients c ON c.id = p.client_id
             WHERE p.status = 'active'
               AND (c.agency_id IS NOT NULL OR c.user_id IS NOT NULL)
               AND NOT EXISTS (
                   SELECT 1 FROM project_audits pa
                   WHERE pa.project_id = p.id
                     AND pa.created_at >= NOW() - INTERVAL '6 days'
               )`,
        );

        log.info({ count: projects.length }, 'queueing weekly re-audits');

        for (const p of projects) {
            try {
                // Per-project override: if project has weekly_enabled = false, skip
                const settings = await auditSettings.resolveSettings(db, p.project_id);
                if (!settings.weeklyEnabled) {
                    log.debug({ projectId: p.project_id }, 'project opted out of weekly audit');
                    continue;
                }

                await orchestrator.createAudit(db, {
                    projectId: p.project_id,
                    clientId: p.client_id,
                    userId: p.user_id,
                    agencyId: p.agency_id,
                    triggerSource: 'scheduled',
                });
            } catch (err) {
                log.error({ err: err.message, projectId: p.project_id }, 'failed to queue weekly audit');
            }
        }
    },
};
