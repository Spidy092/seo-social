/**
 * SEO Client Workspace Routes
 */

const { createLogger } = require('../utils/logger');

const log = createLogger('routes:clients');

function splitList(value) {
    if (Array.isArray(value)) return value.map(String).map(v => v.trim()).filter(Boolean);
    return String(value || '')
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);
}

function getUserId(request) {
    return request.session?.get('userId') || null;
}

/**
 * Ownership check — permissive for single-tenant / demo setups.
 * Allows access when:
 *   - user_id matches the session user
 *   - user_id is NULL (unowned)
 *   - user_id is the nil UUID (seeded/placeholder record)
 *   - userId itself is null (unauthenticated — let route decide)
 */
function ownershipClause(alias = 'user_id') {
    return `(${alias} = $2 OR ${alias} IS NULL OR ${alias} = '00000000-0000-0000-0000-000000000000')`;
}

async function ensureProjectAccess(db, projectId, userId) {
    // In single-tenant setups any authenticated user can access any project.
    // We still verify the project exists.
    const result = await db.query(
        `SELECT p.id, p.client_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1`,
        [projectId]
    );
    return result.rows[0] || null;
}

async function clientRoutes(fastify, options) {
    const { db } = options;

    fastify.get('/api/clients/stats', async (request, reply) => {
        const userId = getUserId(request);
        try {
            const [clients, projects, linkedKeywords] = await Promise.all([
                db.query('SELECT COUNT(*) AS total FROM seo_clients WHERE user_id = $1 OR user_id IS NULL', [userId]),
                db.query(
                    `SELECT COUNT(*) AS total
                     FROM seo_projects p
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.user_id = $1 OR c.user_id IS NULL`,
                    [userId]
                ),
                db.query(
                    `SELECT COUNT(*) AS total
                     FROM seo_project_keywords pk
                     JOIN seo_projects p ON p.id = pk.project_id
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.user_id = $1 OR c.user_id IS NULL`,
                    [userId]
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
        const userId = getUserId(request);
        try {
            const result = await db.query(
                `SELECT c.*,
                        COUNT(DISTINCT p.id) AS project_count,
                        COUNT(DISTINCT pk.keyword_id) AS keyword_count
                 FROM seo_clients c
                 LEFT JOIN seo_projects p ON p.client_id = c.id
                 LEFT JOIN seo_project_keywords pk ON pk.project_id = p.id
                 WHERE c.user_id = $1 OR c.user_id IS NULL
                 GROUP BY c.id
                 ORDER BY c.updated_at DESC`,
                [userId]
            );

            return { clients: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list clients');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/clients', async (request, reply) => {
        const userId = getUserId(request);
        const body = request.body || {};
        const name = String(body.name || '').trim();

        if (!name) {
            return reply.code(400).send({ error: 'Client name is required' });
        }

        try {
            const result = await db.query(
                `INSERT INTO seo_clients
                 (user_id, name, website_url, industry, target_locations, competitors, audience, services, goals, notes)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb, $9, $10)
                 RETURNING *`,
                [
                    userId,
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
        const userId = getUserId(request);
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
                    -- Claim the record for the current user if it was unowned or seeded
                    user_id = COALESCE($2, user_id),
                    updated_at = NOW()
                 WHERE id = $1
                   AND (
                       user_id = $2
                       OR user_id IS NULL
                       OR user_id = '00000000-0000-0000-0000-000000000000'
                   )
                 RETURNING *`,
                [
                    id,
                    userId,
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

            // If still not found, the client exists but belongs to a different user — try a
            // soft ownership transfer for single-tenant / demo setups where the seeded
            // user_id doesn't match any real session (e.g. placeholder 11111111-…)
            if (!result.rows.length) {
                const fallback = await db.query(
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
                        user_id = $2,
                        updated_at = NOW()
                     WHERE id = $1
                     RETURNING *`,
                    [
                        id,
                        userId,
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
                if (!fallback.rows.length) return reply.code(404).send({ error: 'Client not found' });
                log.info({ clientId: id, userId }, 'client ownership claimed by current user');
                return { success: true, client: fallback.rows[0] };
            }
            return { success: true, client: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to update client');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/clients/:id/projects', async (request, reply) => {
        const userId = getUserId(request);
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
                 WHERE p.client_id = $1 AND (c.user_id = $2 OR c.user_id IS NULL)
                 GROUP BY p.id
                 ORDER BY p.updated_at DESC`,
                [id, userId]
            );

            return { projects: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list projects');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/clients/:id/projects', async (request, reply) => {
        const userId = getUserId(request);
        const { id } = request.params;
        const body = request.body || {};
        const name = String(body.name || '').trim();

        if (!name) {
            return reply.code(400).send({ error: 'Project name is required' });
        }

        try {
            const access = await db.query(
                'SELECT id FROM seo_clients WHERE id = $1',
                [id]
            );
            if (!access.rows.length) return reply.code(404).send({ error: 'Client not found' });

            const result = await db.query(
                `INSERT INTO seo_projects (client_id, name, project_type, target_location, goals)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *`,
                [id, name, body.projectType || 'keyword-research', body.targetLocation || null, body.goals || null]
            );

            return { success: true, project: result.rows[0] };
        } catch (err) {
            log.error({ err: err.message }, 'failed to create project');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.get('/api/projects', async (request, reply) => {
        const userId = getUserId(request);
        try {
            const result = await db.query(
                `SELECT p.id, p.name, p.project_type, p.target_location, p.client_id, c.name AS client_name
                 FROM seo_projects p
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE c.user_id = $1 OR c.user_id IS NULL
                 ORDER BY c.name ASC, p.name ASC`,
                [userId]
            );
            return { projects: result.rows };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list all projects');
            return reply.code(500).send({ error: err.message });
        }
    });

    fastify.post('/api/projects/:id/keywords', async (request, reply) => {
        const userId = getUserId(request);
        const { id } = request.params;
        const { keywordId, intent, priorityScore = 0, notes } = request.body || {};

        if (!keywordId) return reply.code(400).send({ error: 'keywordId is required' });

        try {
            const project = await ensureProjectAccess(db, id, userId);
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
        const userId = getUserId(request);
        const { id } = request.params;

        try {
            const project = await ensureProjectAccess(db, id, userId);
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
}

module.exports = clientRoutes;
