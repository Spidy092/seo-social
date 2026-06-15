/**
 * Project Audit Routes — /api/projects/:id/audits + settings
 *
 *   POST   /api/projects/:id/audits                — queue a new audit
 *   GET    /api/projects/:id/audits                — list past audits
 *   GET    /api/projects/:id/audits/latest         — fetch latest
 *   GET    /api/projects/:id/audits/:auditId       — fetch one
 *   POST   /api/projects/:id/audits/:auditId/cancel — cancel pending/running
 *   POST   /api/projects/:id/audits/:auditId/retry  — create a new run
 *
 *   GET    /api/projects/:id/audit-config          — fetch per-project settings
 *   PUT    /api/projects/:id/audit-config          — update per-project settings
 *
 *   GET    /api/admin/audit-settings               — fetch global settings
 *   PUT    /api/admin/audit-settings               — update global settings
 */
const orchestrator = require('../services/auditOrchestrator');
const auditSettings = require('../services/auditSettings');
const { createLogger } = require('../utils/logger');
const { getAgencyContext, requireRole } = require('../utils/authHelper');

const log = createLogger('routes:audits');

async function assertProjectAccess(db, projectId, ctx) {
    const { rows } = await db.query(
        `SELECT p.id, p.client_id, c.agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL)`,
        [projectId, ctx.agencyId],
    );
    return rows[0] || null;
}

module.exports = async function (fastify, options) {
    const { db } = options;

    // ─── Queue + read endpoints ─────────────────────────────────────

    fastify.post('/api/projects/:id/audits', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        // Master switch
        if (!(await auditSettings.isMasterEnabled(db))) {
            return reply.code(503).send({ error: 'Project audits are disabled globally' });
        }

        const projectId = request.params.id;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const body = request.body || {};
        const triggerSource = body.triggerSource || 'manual';

        try {
            const audit = await orchestrator.createAudit(db, {
                projectId: project.id,
                clientId: project.client_id,
                userId: ctx.userId,
                agencyId: ctx.agencyId,
                triggerSource,
                requestedChecks: Array.isArray(body.checks) ? body.checks : null,
            });
            return reply.code(202).send({
                success: true,
                audit: {
                    id: audit.id,
                    status: audit.status,
                    progress: audit.progress,
                    checksTotal: audit.checks_total,
                    requestedChecks: audit.requested_checks,
                    pollUrl: `/api/projects/${projectId}/audits/${audit.id}`,
                },
            });
        } catch (err) {
            log.error({ err: err.message, projectId }, 'failed to queue audit');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects/:id/audits', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const limit = Math.min(parseInt(request.query.limit || '20', 10), 100);
        return { audits: await orchestrator.listAudits(db, projectId, { limit }) };
    });

    fastify.get('/api/projects/:id/audits/latest', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const { rows } = await db.query(
            `SELECT * FROM project_audits WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [projectId],
        );
        return { audit: rows[0] || null };
    });

    fastify.get('/api/projects/:id/audits/:auditId', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const auditId = request.params.auditId;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const audit = await orchestrator.getAudit(db, auditId);
        if (!audit || audit.project_id !== projectId) {
            return reply.code(404).send({ error: 'Audit not found' });
        }
        return { audit };
    });

    // ─── Cancel + retry ─────────────────────────────────────────────

    fastify.post('/api/projects/:id/audits/:auditId/cancel', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const auditId = request.params.auditId;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const audit = await orchestrator.getAudit(db, auditId);
        if (!audit || audit.project_id !== projectId) {
            return reply.code(404).send({ error: 'Audit not found' });
        }
        if (!['pending', 'running'].includes(audit.status)) {
            return reply.code(409).send({ error: `Cannot cancel audit in status '${audit.status}'` });
        }
        const cancelled = await orchestrator.cancelAudit(db, auditId, { cancelledBy: ctx.userId });
        return { success: true, audit: cancelled };
    });

    fastify.post('/api/projects/:id/audits/:auditId/retry', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const auditId = request.params.auditId;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const oldAudit = await orchestrator.getAudit(db, auditId);
        if (!oldAudit || oldAudit.project_id !== projectId) {
            return reply.code(404).send({ error: 'Audit not found' });
        }
        // Use the same check list as the failed one, unless overridden in body
        const requestedChecks = (request.body && Array.isArray(request.body.checks))
            ? request.body.checks
            : (oldAudit.requested_checks || null);
        const newAudit = await orchestrator.createAudit(db, {
            projectId: project.id,
            clientId: project.client_id,
            userId: ctx.userId,
            agencyId: ctx.agencyId,
            triggerSource: 'manual',
            requestedChecks,
        });
        return reply.code(202).send({
            success: true,
            audit: {
                id: newAudit.id,
                status: newAudit.status,
                pollUrl: `/api/projects/${projectId}/audits/${newAudit.id}`,
            },
        });
    });

    // ─── Per-project audit config ───────────────────────────────────

    fastify.get('/api/projects/:id/audit-config', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });
        const settings = await auditSettings.resolveSettings(db, projectId);
        return {
            settings,
            availableChecks: auditSettings.allCheckNames(),
        };
    });

    fastify.put('/api/projects/:id/audit-config', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const projectId = request.params.id;
        const project = await assertProjectAccess(db, projectId, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const body = request.body || {};
        // Map camelCase body to snake_case DB columns
        const patch = {
            enabled_checks: body.enabledChecks !== undefined ? body.enabledChecks : undefined,
            auto_audit_on_create: body.autoAuditOnCreate !== undefined ? body.autoAuditOnCreate : undefined,
            weekly_enabled: body.weeklyEnabled !== undefined ? body.weeklyEnabled : undefined,
            weekly_day_of_week: body.weeklyDayOfWeek !== undefined ? body.weeklyDayOfWeek : undefined,
            weekly_hour: body.weeklyHour !== undefined ? body.weeklyHour : undefined,
            monthly_enabled: body.monthlyEnabled !== undefined ? body.monthlyEnabled : undefined,
            monthly_day_of_month: body.monthlyDayOfMonth !== undefined ? body.monthlyDayOfMonth : undefined,
            custom_keywords: body.customKeywords !== undefined ? body.customKeywords : undefined,
            custom_urls: body.customUrls !== undefined ? body.customUrls : undefined,
            notify_on_complete: body.notifyOnComplete !== undefined ? body.notifyOnComplete : undefined,
            notify_emails: body.notifyEmails !== undefined ? body.notifyEmails : undefined,
            notify_webhook: body.notifyWebhook !== undefined ? body.notifyWebhook : undefined,
            max_checks_concurrency: body.maxChecksConcurrency !== undefined ? body.maxChecksConcurrency : undefined,
        };
        // Strip undefined keys
        Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);

        try {
            const updated = await auditSettings.upsertProjectSettings(db, projectId, patch);
            return { settings: updated };
        } catch (err) {
            log.error({ err: err.message, projectId }, 'failed to update audit config');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Global audit settings (admin only) ─────────────────────────

    fastify.get('/api/admin/audit-settings', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const role = await requireRole(request, reply, db, ['owner', 'manager']);
        if (!role) return;
        const settings = await auditSettings.getGlobalSettings(db, { bypassCache: true });
        return { settings, availableChecks: auditSettings.allCheckNames() };
    });

    fastify.put('/api/admin/audit-settings', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
        const role = await requireRole(request, reply, db, ['owner', 'manager']);
        if (!role) return;
        const body = request.body || {};
        // Map camelCase body to snake_case DB columns
        const patch = {
            enabled: body.enabled !== undefined ? body.enabled : undefined,
            default_checks: body.defaultChecks !== undefined ? body.defaultChecks : undefined,
            auto_audit_on_create: body.autoAuditOnCreate !== undefined ? body.autoAuditOnCreate : undefined,
            weekly_enabled: body.weeklyEnabled !== undefined ? body.weeklyEnabled : undefined,
            weekly_day_of_week: body.weeklyDayOfWeek !== undefined ? body.weeklyDayOfWeek : undefined,
            weekly_hour: body.weeklyHour !== undefined ? body.weeklyHour : undefined,
            monthly_enabled: body.monthlyEnabled !== undefined ? body.monthlyEnabled : undefined,
            monthly_day_of_month: body.monthlyDayOfMonth !== undefined ? body.monthlyDayOfMonth : undefined,
            max_concurrent_audits: body.maxConcurrentAudits !== undefined ? body.maxConcurrentAudits : undefined,
            poll_interval_ms: body.pollIntervalMs !== undefined ? body.pollIntervalMs : undefined,
            notify_on_complete: body.notifyOnComplete !== undefined ? body.notifyOnComplete : undefined,
            notify_webhook: body.notifyWebhook !== undefined ? body.notifyWebhook : undefined,
        };
        Object.keys(patch).forEach(k => patch[k] === undefined && delete patch[k]);
        const settings = await auditSettings.updateGlobalSettings(db, patch);
        return { settings };
    });
};
