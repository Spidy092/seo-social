/**
 * SEO Client Workspace Routes — Agency-scoped
 */

const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:clients');

function splitList(value) {
    if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
    return String(value || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

async function ensureProjectAccess(db, projectId, agencyId) {
    const result = await db.query(
        `SELECT p.id, p.client_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1 AND c.agency_id = $2`,
        [projectId, agencyId]
    );
    return result.rows[0] || null;
}

async function clientRoutes(fastify, options) {
    const { db } = options;

    fastify.get('/api/clients/stats', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const agentFilter = ctx.role === 'agent'
                ? `AND (c.assigned_to = $2 OR c.assigned_to IS NULL)`
                : '';
            const params = ctx.role === 'agent' ? [ctx.agencyId, ctx.userId] : [ctx.agencyId];

            const [clients, projects, linkedKeywords] = await Promise.all([
                db.query(
                    `SELECT COUNT(*) AS total FROM seo_clients c WHERE c.agency_id = $1 ${agentFilter}`,
                    params
                ),
                db.query(
                    `SELECT COUNT(*) AS total
                     FROM seo_projects p
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.agency_id = $1 ${agentFilter}`,
                    params
                ),
                db.query(
                    `SELECT COUNT(*) AS total
                     FROM seo_project_keywords pk
                     JOIN seo_projects p ON p.id = pk.project_id
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.agency_id = $1 ${agentFilter}`,
                    params
                ),
            ]);

            return {
                clients: parseInt(clients.rows[0].total, 10),
                projects: parseInt(projects.rows[0].total, 10),
                projectKeywords: parseInt(linkedKeywords.rows[0].total, 10),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get client stats');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/clients', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            // Agents only see clients assigned to them + unassigned
            const agentFilter = ctx.role === 'agent'
                ? `AND (c.assigned_to = $2 OR c.assigned_to IS NULL)`
                : '';
            const params = ctx.role === 'agent' ? [ctx.agencyId, ctx.userId] : [ctx.agencyId];

            const result = await db.query(
                `SELECT c.*,
                        COUNT(DISTINCT p.id) AS project_count,
                        COUNT(DISTINCT pk.keyword_id) AS keyword_count,
                        u.email AS assigned_email
                 FROM seo_clients c
                 LEFT JOIN seo_projects p ON p.client_id = c.id
                 LEFT JOIN seo_project_keywords pk ON pk.project_id = p.id
                 LEFT JOIN users u ON u.id = c.assigned_to
                 WHERE c.agency_id = $1 ${agentFilter}
                 GROUP BY c.id, u.email
                 ORDER BY c.updated_at DESC`,
                params
            );

            return { clients: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list clients');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/clients', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const body = request.body || {};
        const name = String(body.name || '').trim();

        if (!name) {
            return reply.code(400).send({ error: 'Client name is required' });
        }

        try {
            const result = await db.query(
                `INSERT INTO seo_clients
                 (user_id, agency_id, name, website_url, industry, target_locations, competitors, audience, services, goals, notes)
                 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, $10, $11)
                 RETURNING *`,
                [
                    ctx.userId,
                    ctx.agencyId,
                    name,
                    body.websiteUrl || null,
                    body.industry || null,
                    JSON.stringify(splitList(body.targetLocations)),
                    JSON.stringify(splitList(body.competitors)),
                    body.audience || null,
                    JSON.stringify(splitList(body.services)),
                    body.goals || null,
                    body.notes || null,
                ]
            );

            return { success: true, client: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to create client');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.put('/api/clients/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const body = request.body || {};
        const name = String(body.name || '').trim();

        if (!name) {
            return reply.code(400).send({ error: 'Client name is required' });
        }

        try {
            const result = await db.query(
                `UPDATE seo_clients SET
                    name = $3,
                    website_url = $4,
                    industry = $5,
                    target_locations = $6::jsonb,
                    competitors = $7::jsonb,
                    audience = $8,
                    services = $9::jsonb,
                    goals = $10,
                    notes = $11,
                    updated_at = NOW()
                 WHERE id = $1
                   AND agency_id = $2
                 RETURNING *`,
                [
                    id,
                    ctx.agencyId,
                    name,
                    body.websiteUrl || null,
                    body.industry || null,
                    JSON.stringify(splitList(body.targetLocations)),
                    JSON.stringify(splitList(body.competitors)),
                    body.audience || null,
                    JSON.stringify(splitList(body.services)),
                    body.goals || null,
                    body.notes || null,
                ]
            );

            if (!result.rows.length) return reply.code(404).send({ error: 'Client not found' });
            return { success: true, client: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to update client');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/clients/:id/projects', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;

        try {
            const result = await db.query(
                `SELECT p.*,
                        COUNT(pk.keyword_id) AS keyword_count,
                        COALESCE(ROUND(AVG(NULLIF(k.difficulty, 0))::numeric, 0), 0) AS avg_difficulty,
                        COALESCE(SUM(k.search_volume), 0) AS total_volume
                 FROM seo_projects p
                 JOIN seo_clients c ON c.id = p.client_id
                 LEFT JOIN seo_project_keywords pk ON pk.project_id = p.id
                 LEFT JOIN keywords k ON k.id = pk.keyword_id
                 WHERE p.client_id = $1 AND c.agency_id = $2
                 GROUP BY p.id
                 ORDER BY p.updated_at DESC`,
                [id, ctx.agencyId]
            );

            return { projects: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list projects');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/clients/:id/projects', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const body = request.body || {};
        const name = String(body.name || '').trim();

        if (!name) {
            return reply.code(400).send({ error: 'Project name is required' });
        }

        try {
            const access = await db.query(
                'SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2',
                [id, ctx.agencyId]
            );
            if (!access.rows.length) return reply.code(404).send({ error: 'Client not found' });

            const result = await db.query(
                `INSERT INTO seo_projects (client_id, name, project_type, target_location, goals, tracking_domain)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *`,
                [id, name, body.projectType || 'keyword-research', body.targetLocation || null, body.goals || null, body.trackingDomain || null]
            );

            const project = result.rows[0];

            // ── Auto-queue a full audit for the new project ──
            // The user shouldn't have to click "run audit" for every
            // check. The audit runs in the background and the UI
            // polls /api/projects/:id/audits/latest for the result.
            //
            // Resolved order (first truthy wins):
            //   1. body.autoAudit === false in the request  (per-request override)
            //   2. process.env.DISABLE_AUTO_AUDIT === 'true' (env kill-switch)
            //   3. project_audit_settings.auto_audit_on_create (per-project)
            //   4. audit_settings_global.auto_audit_on_create (global default)
            let autoAudit = body.autoAudit !== false && process.env.DISABLE_AUTO_AUDIT !== 'true';
            if (autoAudit) {
                try {
                    const auditSettingsSvc = require('../services/auditSettings');
                    const masterEnabled = await auditSettingsSvc.isMasterEnabled(db);
                    if (!masterEnabled) autoAudit = false;
                } catch { /* settings table not yet migrated — fall through */ }
            }

            if (autoAudit) {
                try {
                    const orchestrator = require('../services/auditOrchestrator');
                    const audit = await orchestrator.createAudit(db, {
                        projectId: project.id,
                        clientId: id,
                        userId: ctx.userId,
                        agencyId: ctx.agencyId,
                        triggerSource: 'auto-on-create',
                    });
                    return {
                        success: true,
                        project,
                        audit: {
                            id: audit.id,
                            status: audit.status,
                            pollUrl: `/api/projects/${project.id}/audits/${audit.id}`,
                        },
                    };
                } catch (auditErr) {
                    // Audit-queue failure must NOT block project creation.
                    log.warn({ err: auditErr.message, projectId: project.id }, 'auto-audit queue failed');
                }
            }

            return { success: true, project };
        } catch (err) {
            log.error({ err: err.message }, 'failed to create project');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const agentFilter = ctx.role === 'agent'
                ? `AND (c.assigned_to = $2 OR c.assigned_to IS NULL)`
                : '';
            const params = ctx.role === 'agent' ? [ctx.agencyId, ctx.userId] : [ctx.agencyId];

            const result = await db.query(
                `SELECT p.id, p.name, p.project_type, p.target_location, p.tracking_domain, p.client_id, c.name AS client_name, c.website_url
                 FROM seo_projects p
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE c.agency_id = $1 ${agentFilter}
                 ORDER BY c.name ASC, p.name ASC`,
                params
            );
            return { projects: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list all projects');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/projects/:id/keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const { keywordId, intent, priorityScore = 0, notes } = request.body || {};

        if (!keywordId) return reply.code(400).send({ error: 'keywordId is required' });

        try {
            const project = await ensureProjectAccess(db, id, ctx.agencyId);
            if (!project) return reply.code(404).send({ error: 'Project not found' });

            await db.query(
                `INSERT INTO seo_project_keywords (project_id, keyword_id, intent, priority_score, notes)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (project_id, keyword_id) DO UPDATE SET
                    intent = COALESCE($3, seo_project_keywords.intent),
                    priority_score = GREATEST(seo_project_keywords.priority_score, $4),
                    notes = COALESCE($5, seo_project_keywords.notes)`,
                [id, keywordId, intent || null, Number(priorityScore) || 0, notes || null]
            );

            await db.query('UPDATE seo_projects SET updated_at = NOW() WHERE id = $1', [id]);
            await db.query('UPDATE seo_clients SET updated_at = NOW() WHERE id = $1', [project.client_id]);

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to link project keyword');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects/:id/keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;

        try {
            const project = await ensureProjectAccess(db, id, ctx.agencyId);
            if (!project) return reply.code(404).send({ error: 'Project not found' });

            const result = await db.query(
                `SELECT pk.*, k.keyword, k.location, k.search_volume, k.competition, k.cpc, k.difficulty
                 FROM seo_project_keywords pk
                 JOIN keywords k ON k.id = pk.keyword_id
                 WHERE pk.project_id = $1
                 ORDER BY pk.priority_score DESC, k.search_volume DESC, pk.created_at DESC`,
                [id]
            );

            return { keywords: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list project keywords');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Assign a client to a team member ───
    // PUT /api/clients/:id/assign — body: { userId } or { userId: null } to unassign
    fastify.put('/api/clients/:id/assign', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        // Only owner/manager can assign clients
        if (ctx.role === 'agent') {
            return reply.code(403).send({ error: 'Only owners and managers can assign clients' });
        }

        const { id } = request.params;
        const { userId } = request.body || {};

        try {
            // Verify client belongs to this agency
            const clientCheck = await db.query(
                `SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2`,
                [id, ctx.agencyId]
            );
            if (!clientCheck.rows.length) {
                return reply.code(404).send({ error: 'Client not found' });
            }

            // If userId provided, verify they're a member of this agency
            if (userId) {
                const memberCheck = await db.query(
                    `SELECT user_id FROM agency_members WHERE agency_id = $1 AND user_id = $2`,
                    [ctx.agencyId, userId]
                );
                if (!memberCheck.rows.length) {
                    return reply.code(400).send({ error: 'User is not a member of this agency' });
                }
            }

            const result = await db.query(
                `UPDATE seo_clients SET assigned_to = $1, updated_at = NOW() WHERE id = $2 RETURNING id, assigned_to`,
                [userId || null, id]
            );

            return { success: true, client: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to assign client');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get agency members (for assignment dropdowns) ───
    fastify.get('/api/clients/members', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const result = await db.query(
                `SELECT u.id, u.email, am.role
                 FROM agency_members am
                 JOIN users u ON u.id = am.user_id
                 WHERE am.agency_id = $1
                 ORDER BY am.role, u.email`,
                [ctx.agencyId]
            );
            return { members: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list members');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = clientRoutes;
