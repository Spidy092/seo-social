/**
 * Shared authentication and authorization helpers for agency-scoped routes.
 *
 * Usage in route files:
 *   const { getUserId, getAgencyContext, requireRole } = require('../utils/authHelper');
 *
 *   // In a route handler:
 *   const ctx = await getAgencyContext(request, db);
 *   if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });
 *   // ctx = { userId, agencyId, role }
 */

const { createLogger } = require('./logger');
const log = createLogger('auth-helper');

/**
 * Extract the userId from the session.
 */
function getUserId(request) {
    return request.session?.get('userId') || null;
}

/**
 * Get the user's agency context (agencyId + role).
 * Returns null if user has no agency membership.
 * Returns the first agency if user belongs to multiple.
 */
async function getAgencyContext(request, db) {
    const userId = getUserId(request);
    if (!userId) return null;

    // Check session cache first
    const cached = request.session?.get('agencyContext');
    if (cached && cached.userId === userId) {
        return cached;
    }

    try {
        const result = await db.query(
            `SELECT am.agency_id, am.role
             FROM agency_members am
             WHERE am.user_id = $1
             ORDER BY am.joined_at ASC
             LIMIT 1`,
            [userId]
        );

        if (!result.rows.length) return null;

        const ctx = {
            userId,
            agencyId: result.rows[0].agency_id,
            role: result.rows[0].role,
        };

        // Cache in session for this request cycle
        try {
            request.session?.set('agencyContext', ctx);
        } catch (cacheErr) {
            log.debug({ err: cacheErr.message, userId }, 'session cache write failed — session may be read-only');
        }

        return ctx;
    } catch (err) {
        log.error({ err: err.message, userId }, 'failed to get agency context');
        return null;
    }
}

/**
 * Middleware-style helper: checks if user has one of the required roles.
 * Returns the context if authorized, null otherwise.
 * The caller should send the appropriate error response.
 *
 * @param {object} request - Fastify request
 * @param {object} db - Database module
 * @param {string[]} allowedRoles - e.g. ['owner', 'manager']
 * @returns {object|null} { userId, agencyId, role } or null
 */
async function requireRole(request, db, allowedRoles = []) {
    const ctx = await getAgencyContext(request, db);
    if (!ctx) return null;
    if (allowedRoles.length > 0 && !allowedRoles.includes(ctx.role)) return null;
    return ctx;
}

function sendUnauthorized(reply) {
    return reply.code(401).send({ error: 'Unauthorized' });
}

async function requireAgencyContext(request, reply, db) {
    const ctx = await getAgencyContext(request, db);
    if (!ctx) {
        sendUnauthorized(reply);
        return null;
    }
    return ctx;
}

async function assertProjectAccess(db, projectId, agencyId) {
    if (!projectId) return null;
    const result = await db.query(
        `SELECT p.id, p.client_id, p.name AS project_name, c.website_url, c.agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)
         LIMIT 1`,
        [projectId, agencyId || null]
    );
    return result.rows[0] || null;
}

async function assertClientAccess(db, clientId, agencyId) {
    if (!clientId) return null;
    const result = await db.query(
        `SELECT *
         FROM seo_clients
         WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)
         LIMIT 1`,
        [clientId, agencyId || null]
    );
    return result.rows[0] || null;
}

/**
 * Build a WHERE clause that scopes queries to the user's agency.
 * Supports two modes:
 *   - 'agency': only rows belonging to the agency
 *   - 'agency_or_null': rows belonging to the agency OR unassigned (for backward compat)
 *
 * @param {string} alias - table alias for agency_id column (default 'agency_id')
 * @param {number} paramIdx - the $N index for the agencyId parameter
 * @param {string} mode - 'agency' | 'agency_or_null'
 * @returns {string} SQL WHERE fragment
 */
function agencyScopeClause(alias = 'agency_id', paramIdx, mode = 'agency') {
    if (mode === 'agency_or_null') {
        return `(${alias} = $${paramIdx} OR ${alias} IS NULL)`;
    }
    return `${alias} = $${paramIdx}`;
}

module.exports = {
    getUserId,
    getAgencyContext,
    requireAgencyContext,
    requireRole,
    assertProjectAccess,
    assertClientAccess,
    sendUnauthorized,
    agencyScopeClause,
};
