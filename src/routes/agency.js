/**
 * Agency Routes — /api/agency/*
 *
 * Handles agency CRUD, member management, and invite system.
 * Roles: owner > manager > agent
 *   - owner: full control, can delete agency, manage all members
 *   - manager: can invite/remove agents, manage clients
 *   - agent: can manage assigned clients only
 */

const crypto = require('crypto');
const { createLogger } = require('../utils/logger');
const { getAgencyContext, requireRole } = require('../utils/authHelper');

const log = createLogger('routes:agency');

async function agencyRoutes(fastify, { db }) {

    // ─── GET /api/agency/current ────────────────────────────────────────────
    // Get current user's agency and membership info
    fastify.get('/api/agency/current', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) {
            return reply.code(404).send({ error: 'No agency found for current user' });
        }

        try {
            const agencyRes = await db.query(
                `SELECT a.*, u.email AS owner_email
                 FROM agencies a
                 LEFT JOIN users u ON u.id = a.created_by
                 WHERE a.id = $1`,
                [ctx.agencyId]
            );

            if (!agencyRes.rows.length) {
                return reply.code(404).send({ error: 'Agency not found' });
            }

            return {
                agency: agencyRes.rows[0],
                role: ctx.role,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get current agency');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── PUT /api/agency/current ────────────────────────────────────────────
    // Update agency name (owner/manager only)
    fastify.put('/api/agency/current', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        const { name } = request.body || {};
        if (!name || !String(name).trim()) {
            return reply.code(400).send({ error: 'Agency name is required' });
        }

        try {
            const result = await db.query(
                `UPDATE agencies SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
                [String(name).trim(), ctx.agencyId]
            );
            return { success: true, agency: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to update agency');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── GET /api/agency/members ────────────────────────────────────────────
    // List all members of the current agency
    fastify.get('/api/agency/members', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'No agency membership' });

        try {
            const result = await db.query(
                `SELECT am.id, am.role, am.joined_at,
                        u.id AS user_id, u.email, u.created_at AS user_created_at
                 FROM agency_members am
                 JOIN users u ON u.id = am.user_id
                 WHERE am.agency_id = $1
                 ORDER BY
                    CASE am.role WHEN 'owner' THEN 1 WHEN 'manager' THEN 2 WHEN 'agent' THEN 3 ELSE 4 END,
                    am.joined_at ASC`,
                [ctx.agencyId]
            );

            return { members: result.rows, currentUserId: ctx.userId };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list members');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── POST /api/agency/invite ────────────────────────────────────────────
    // Invite a user by email (owner/manager only)
    fastify.post('/api/agency/invite', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        const { email, role = 'agent' } = request.body || {};
        if (!email || !String(email).trim()) {
            return reply.code(400).send({ error: 'Email is required' });
        }

        const validRoles = ['agent', 'manager'];
        if (!validRoles.includes(role)) {
            return reply.code(400).send({ error: `Role must be one of: ${validRoles.join(', ')}` });
        }

        // Managers can only invite agents, not other managers
        if (ctx.role === 'manager' && role !== 'agent') {
            return reply.code(403).send({ error: 'Managers can only invite agents' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();

        try {
            // Check if user is already a member
            const existingMember = await db.query(
                `SELECT am.id FROM agency_members am
                 JOIN users u ON u.id = am.user_id
                 WHERE am.agency_id = $1 AND u.email = $2`,
                [ctx.agencyId, normalizedEmail]
            );

            if (existingMember.rows.length) {
                return reply.code(409).send({ error: 'User is already a member of this agency' });
            }

            // Check for pending invite
            const pendingInvite = await db.query(
                `SELECT id FROM agency_invites
                 WHERE agency_id = $1 AND email = $2 AND accepted = FALSE AND expires_at > NOW()`,
                [ctx.agencyId, normalizedEmail]
            );

            if (pendingInvite.rows.length) {
                return reply.code(409).send({ error: 'An active invite already exists for this email' });
            }

            // If user already exists, add them directly
            const userRes = await db.query(
                `SELECT id FROM users WHERE email = $1`,
                [normalizedEmail]
            );

            if (userRes.rows.length) {
                // User exists — add as member directly
                const userId = userRes.rows[0].id;

                // Check if user has their own agency (first agency)
                const userAgency = await db.query(
                    `SELECT am.agency_id FROM agency_members am
                     WHERE am.user_id = $1 AND am.role = 'owner'
                     ORDER BY am.joined_at ASC LIMIT 1`,
                    [userId]
                );

                await db.query(
                    `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (agency_id, user_id) DO NOTHING`,
                    [ctx.agencyId, userId, role, ctx.userId]
                );

                log.info({ email: normalizedEmail, agencyId: ctx.agencyId, role }, 'user added directly to agency');
                return { success: true, addedDirectly: true, message: `${normalizedEmail} has been added to the agency` };
            }

            // User doesn't exist — create an invite token
            const token = crypto.randomBytes(32).toString('hex');

            await db.query(
                `INSERT INTO agency_invites (agency_id, email, role, token, invited_by)
                 VALUES ($1, $2, $3, $4, $5)`,
                [ctx.agencyId, normalizedEmail, role, token, ctx.userId]
            );

            log.info({ email: normalizedEmail, agencyId: ctx.agencyId, role }, 'invite created');
            return {
                success: true,
                addedDirectly: false,
                inviteToken: token,
                message: `Invite created for ${normalizedEmail}. They can register at /register?invite=${token}`,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to create invite');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── GET /api/agency/invites ────────────────────────────────────────────
    // List pending invites (owner/manager only)
    fastify.get('/api/agency/invites', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        try {
            const result = await db.query(
                `SELECT id, email, role, accepted, expires_at, created_at
                 FROM agency_invites
                 WHERE agency_id = $1
                 ORDER BY created_at DESC`,
                [ctx.agencyId]
            );

            return { invites: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list invites');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── DELETE /api/agency/invites/:id ─────────────────────────────────────
    // Revoke a pending invite (owner/manager only)
    fastify.delete('/api/agency/invites/:id', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        const { id } = request.params;

        try {
            const result = await db.query(
                `DELETE FROM agency_invites WHERE id = $1 AND agency_id = $2 AND accepted = FALSE RETURNING id`,
                [id, ctx.agencyId]
            );

            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Invite not found or already accepted' });
            }

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to revoke invite');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── PUT /api/agency/members/:userId/role ───────────────────────────────
    // Change a member's role (owner only)
    fastify.put('/api/agency/members/:userId/role', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner']);
        if (!ctx) return reply.code(403).send({ error: 'Only the owner can change roles' });

        const { userId } = request.params;
        const { role } = request.body || {};

        const validRoles = ['manager', 'agent'];
        if (!validRoles.includes(role)) {
            return reply.code(400).send({ error: `Role must be one of: ${validRoles.join(', ')}` });
        }

        if (userId === ctx.userId) {
            return reply.code(400).send({ error: 'Cannot change your own role' });
        }

        try {
            const result = await db.query(
                `UPDATE agency_members SET role = $1
                 WHERE agency_id = $2 AND user_id = $3 AND role != 'owner'
                 RETURNING id, role`,
                [role, ctx.agencyId, userId]
            );

            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Member not found' });
            }

            return { success: true, member: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to update member role');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── DELETE /api/agency/members/:userId ─────────────────────────────────
    // Remove a member from the agency (owner/manager, can't remove owner)
    fastify.delete('/api/agency/members/:userId', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        const { userId } = request.params;

        // Managers can only remove agents
        if (ctx.role === 'manager') {
            const targetRes = await db.query(
                `SELECT role FROM agency_members WHERE agency_id = $1 AND user_id = $2`,
                [ctx.agencyId, userId]
            );
            if (targetRes.rows[0]?.role !== 'agent') {
                return reply.code(403).send({ error: 'Managers can only remove agents' });
            }
        }

        if (userId === ctx.userId) {
            return reply.code(400).send({ error: 'Cannot remove yourself. Transfer ownership first.' });
        }

        try {
            const result = await db.query(
                `DELETE FROM agency_members
                 WHERE agency_id = $1 AND user_id = $2 AND role != 'owner'
                 RETURNING id`,
                [ctx.agencyId, userId]
            );

            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Member not found or is the owner' });
            }

            // Clear agency_id from resources owned by this user in this agency
            await db.query(`UPDATE seo_clients SET agency_id = NULL WHERE agency_id = $1 AND user_id = $2`, [ctx.agencyId, userId]);
            await db.query(`UPDATE seo_tasks SET agency_id = NULL WHERE agency_id = $1 AND user_id = $2`, [ctx.agencyId, userId]);

            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to remove member');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── GET /api/agency/validate-invite/:token ─────────────────────────────
    // Public: validate an invite token (used during registration)
    fastify.get('/api/agency/validate-invite/:token', async (request, reply) => {
        const { token } = request.params;

        try {
            const result = await db.query(
                `SELECT ai.email, ai.role, a.name AS agency_name
                 FROM agency_invites ai
                 JOIN agencies a ON a.id = ai.agency_id
                 WHERE ai.token = $1 AND ai.accepted = FALSE AND ai.expires_at > NOW()`,
                [token]
            );

            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Invalid or expired invite' });
            }

            return { invite: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to validate invite');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── POST /api/agency/claim-client/:clientId ────────────────────────────
    // Assign a client to the current agency (owner/manager only)
    fastify.post('/api/agency/claim-client/:clientId', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager']);
        if (!ctx) return reply.code(403).send({ error: 'Access denied' });

        const { clientId } = request.params;

        try {
            const result = await db.query(
                `UPDATE seo_clients
                 SET agency_id = $1, user_id = $2, updated_at = NOW()
                 WHERE id = $3 AND (agency_id IS NULL OR agency_id = $1)
                 RETURNING id, name`,
                [ctx.agencyId, ctx.userId, clientId]
            );

            if (!result.rows.length) {
                return reply.code(404).send({ error: 'Client not found or already belongs to another agency' });
            }

            return { success: true, client: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to claim client');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── GET /api/agency/onboarding-status ──────────────────────────────────
    // Returns onboarding state for the current agency
    fastify.get('/api/agency/onboarding-status', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const agencyRes = await db.query(
                `SELECT name, onboarding_dismissed FROM agencies WHERE id = $1`,
                [ctx.agencyId]
            );
            const agency = agencyRes.rows[0];
            if (!agency) return reply.code(404).send({ error: 'Agency not found' });

            const isDefaultName = agency.name.endsWith("'s Agency");

            const [clientsRes, membersRes, keywordsRes] = await Promise.all([
                db.query(`SELECT COUNT(*) AS total FROM seo_clients WHERE agency_id = $1`, [ctx.agencyId]),
                db.query(`SELECT COUNT(*) AS total FROM agency_members WHERE agency_id = $1`, [ctx.agencyId]),
                db.query(
                    `SELECT COUNT(*) AS total
                     FROM seo_project_keywords pk
                     JOIN seo_projects p ON p.id = pk.project_id
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.agency_id = $1`,
                    [ctx.agencyId]
                ),
            ]);

            return {
                agencyName: agency.name,
                isDefaultName,
                clientCount: parseInt(clientsRes.rows[0].total, 10),
                memberCount: parseInt(membersRes.rows[0].total, 10),
                keywordCount: parseInt(keywordsRes.rows[0].total, 10),
                dismissed: agency.onboarding_dismissed,
                role: ctx.role,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get onboarding status');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── POST /api/agency/onboarding/dismiss ────────────────────────────────
    // Mark onboarding checklist as dismissed
    fastify.post('/api/agency/onboarding/dismiss', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner', 'manager', 'agent']);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            await db.query(
                `UPDATE agencies SET onboarding_dismissed = TRUE WHERE id = $1`,
                [ctx.agencyId]
            );
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'failed to dismiss onboarding');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── POST /api/agency/onboarding/setup ──────────────────────────────────
    // Complete onboarding wizard: rename agency + optional first client + optional invite
    fastify.post('/api/agency/onboarding/setup', async (request, reply) => {
        const ctx = await requireRole(request, db, ['owner']);
        if (!ctx) return reply.code(403).send({ error: 'Only the owner can complete onboarding' });

        const { agencyName, clientName, clientWebsite, inviteEmail } = request.body || {};

        try {
            // 1. Rename agency if provided
            if (agencyName && String(agencyName).trim()) {
                await db.query(
                    `UPDATE agencies SET name = $1, updated_at = NOW() WHERE id = $2`,
                    [String(agencyName).trim(), ctx.agencyId]
                );
            }

            // 2. Create first client if provided (optional)
            let client = null;
            if (clientName && String(clientName).trim()) {
                const clientRes = await db.query(
                    `INSERT INTO seo_clients (user_id, agency_id, name, website_url)
                     VALUES ($1, $2, $3, $4)
                     RETURNING id, name`,
                    [ctx.userId, ctx.agencyId, String(clientName).trim(), clientWebsite || null]
                );
                client = clientRes.rows[0];
            }

            // 3. Send invite if email provided (optional)
            let inviteResult = null;
            if (inviteEmail && String(inviteEmail).trim()) {
                const email = String(inviteEmail).trim().toLowerCase();
                const existing = await db.query(
                    `SELECT u.id FROM users u
                     JOIN agency_members am ON am.user_id = u.id AND am.agency_id = $1
                     WHERE u.email = $2`,
                    [ctx.agencyId, email]
                );

                if (existing.rows.length) {
                    inviteResult = { addedDirectly: true, message: `${email} is already a member` };
                } else {
                    const userRes = await db.query(`SELECT id FROM users WHERE email = $1`, [email]);
                    if (userRes.rows.length) {
                        await db.query(
                            `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
                             VALUES ($1, $2, 'agent', $3)
                             ON CONFLICT (agency_id, user_id) DO NOTHING`,
                            [ctx.agencyId, userRes.rows[0].id, ctx.userId]
                        );
                        inviteResult = { addedDirectly: true, message: `${email} added as agent` };
                    } else {
                        const crypto = require('crypto');
                        const token = crypto.randomBytes(32).toString('hex');
                        await db.query(
                            `INSERT INTO agency_invites (agency_id, email, role, token, invited_by)
                             VALUES ($1, $2, 'agent', $3, $4)`,
                            [ctx.agencyId, email, token, ctx.userId]
                        );
                        inviteResult = { addedDirectly: false, token, message: `Invite created for ${email}` };
                    }
                }
            }

            // 4. Mark onboarding complete
            await db.query(
                `UPDATE agencies SET onboarding_dismissed = TRUE WHERE id = $1`,
                [ctx.agencyId]
            );

            return { success: true, client, invite: inviteResult };
        } catch (err) {
            log.error({ err: err.message }, 'failed to complete onboarding');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = agencyRoutes;
