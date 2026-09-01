/**
 * Ranked Keywords Routes
 *
 *   GET  /api/projects/:id/ranked-keywords?url=...&location=...&refresh=true|false
 *   POST /api/projects/:id/ranked-keywords   body: { url, location, refresh }
 *   GET  /api/projects/:id/ranked-keywords/export?url=...&location=...   (CSV)
 *   POST /api/projects/:id/keywords/promote  body: { keywords: [{keyword, ...}] }
 *
 * The dashboard auto-loads the data via the main
 * `/api/projects/:id/dashboard` payload. These endpoints exist for:
 *   - the in-card URL/location input (Enter to re-query)
 *   - the in-card "Refresh" button (POST with refresh: true)
 *   - CSV export
 *   - the "Add as target keyword" per-row / bulk action
 */

const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');
const rankedKeywords = require('../services/rankedKeywordsService');

const log = createLogger('routes:ranked-keywords');

async function assertProjectAccess(db, projectId, ctx) {
    const { rows } = await db.query(
        `SELECT p.id, p.client_id, c.agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1 AND c.agency_id = $2`,
        [projectId, ctx.agencyId],
    );
    return rows[0] || null;
}

function parseRefresh(value) {
    if (value === true) return true;
    if (value === false || value === undefined || value === null) return false;
    if (typeof value === 'string') return /^(1|true|yes)$/i.test(value);
    return Boolean(value);
}

function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (/[",\r\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

module.exports = async function (fastify, options) {
    const { db } = options;

    // ── GET  /api/projects/:id/ranked-keywords ──────────────────────────
    fastify.get('/api/projects/:id/ranked-keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const url = typeof request.query.url === 'string' ? request.query.url : null;
        const location = typeof request.query.location === 'string' ? request.query.location : null;
        const forceRefresh = parseRefresh(request.query.refresh);

        try {
            const result = await rankedKeywords.getRankedKeywords(db, {
                projectId: id,
                clientId: project.client_id,
                agencyId: ctx.agencyId,
                url,
                location,
                forceRefresh,
            });
            return { success: true, ...result };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'ranked-keywords GET failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── POST /api/projects/:id/ranked-keywords ──────────────────────────
    fastify.post('/api/projects/:id/ranked-keywords', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const body = request.body || {};
        const url = typeof body.url === 'string' ? body.url : null;
        const location = typeof body.location === 'string' ? body.location : null;
        const forceRefresh = parseRefresh(body.refresh);

        try {
            const result = await rankedKeywords.getRankedKeywords(db, {
                projectId: id,
                clientId: project.client_id,
                agencyId: ctx.agencyId,
                url,
                location,
                forceRefresh,
            });
            return { success: true, ...result };
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'ranked-keywords POST failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── GET  /api/projects/:id/ranked-keywords/export (CSV) ─────────────
    fastify.get('/api/projects/:id/ranked-keywords/export', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const url = typeof request.query.url === 'string' ? request.query.url : null;
        const location = typeof request.query.location === 'string' ? request.query.location : null;

        try {
            const result = await rankedKeywords.getRankedKeywords(db, {
                projectId: id,
                clientId: project.client_id,
                agencyId: ctx.agencyId,
                url,
                location,
                forceRefresh: false,
            });
            const header = ['keyword', 'position', 'url', 'clicks', 'impressions', 'source'].join(',');
            const rows = (result.keywords || []).map((k) => [
                k.keyword,
                k.position !== null && k.position !== undefined ? k.position : '',
                k.url || '',
                k.clicks !== null && k.clicks !== undefined ? k.clicks : '',
                k.impressions !== null && k.impressions !== undefined ? k.impressions : '',
                result.source,
            ].map(csvEscape).join(','));
            const csv = [header, ...rows].join('\r\n');

            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            reply.header('Content-Type', 'text/csv; charset=utf-8');
            reply.header('Content-Disposition', `attachment; filename="ranked-keywords-${id}-${stamp}.csv"`);
            return reply.send(csv);
        } catch (err) {
            log.error({ err: err.message, projectId: id }, 'ranked-keywords CSV export failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ── POST /api/projects/:id/keywords/promote ─────────────────────────
    // Promote a list of ranked-keyword rows to seo_project_keywords.
    // Body: { keywords: [{ keyword, location, searchVolume, difficulty, intent, priorityScore }] }
    fastify.post('/api/projects/:id/keywords/promote', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const project = await assertProjectAccess(db, id, ctx);
        if (!project) return reply.code(404).send({ error: 'Project not found' });

        const body = request.body || {};
        const keywords = Array.isArray(body.keywords) ? body.keywords : [];
        if (!keywords.length) {
            return reply.code(400).send({ error: 'keywords[] is required' });
        }

        let added = 0;
        let skipped = 0;
        const conflicts = [];

        for (const raw of keywords) {
            const keyword = String(raw.keyword || '').trim();
            if (!keyword) { skipped++; continue; }
            const location = String(raw.location || 'India').trim() || 'India';
            const searchVolume = Number.isFinite(Number(raw.searchVolume)) ? Number(raw.searchVolume) : 0;
            const difficulty = Number.isFinite(Number(raw.difficulty)) ? Number(raw.difficulty) : 0;
            const intent = typeof raw.intent === 'string' ? raw.intent : null;
            const priorityScore = Number.isFinite(Number(raw.priorityScore)) ? Number(raw.priorityScore) : 0;

            try {
                // Upsert into the master `keywords` table
                const upsert = await db.query(
                    `INSERT INTO keywords (keyword, location, search_volume, difficulty)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (keyword, location) DO UPDATE
                        SET search_volume = EXCLUDED.search_volume,
                            difficulty    = EXCLUDED.difficulty,
                            updated_at    = NOW()
                     RETURNING id`,
                    [keyword, location, searchVolume, difficulty],
                );
                const keywordId = upsert.rows[0]?.id;
                if (!keywordId) { skipped++; continue; }

                // Insert into the project's link table; ON CONFLICT DO NOTHING
                const link = await db.query(
                    `INSERT INTO seo_project_keywords
                        (project_id, keyword_id, intent, priority_score)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (project_id, keyword_id) DO NOTHING
                     RETURNING id`,
                    [id, keywordId, intent, priorityScore],
                );
                if (link.rowCount > 0) added++;
                else { skipped++; conflicts.push(keyword); }
            } catch (err) {
                log.warn({ err: err.message, keyword }, 'promote failed for keyword');
                skipped++;
            }
        }

        return { success: true, added, skipped, conflicts };
    });
};
