/**
 * 📊 Agency Report Routes — Agency-scoped
 * Generates PDF/HTML reports for client SEO work.
 */

const { buildReport } = require('../services/reportService');
const { createLogger } = require('../utils/logger');
const { getAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:reports');

async function reportRoutes(fastify, options) {
    const { db } = options;

    // ─── Generate Report Data (JSON) ───
    fastify.post('/api/reports/generate', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { clientId, domain, periodDays = 30, reportTitle, includePageSpeed = true } = request.body || {};

        if (!clientId) {
            return reply.code(400).send({ error: 'Choose a client before generating a report so every source stays agency-scoped' });
        }

        try {
            const client = await db.query(
                'SELECT id FROM seo_clients WHERE id = $1 AND agency_id = $2 LIMIT 1',
                [clientId, ctx.agencyId]
            );
            if (!client.rows.length) return reply.code(404).send({ error: 'Client not found in this agency workspace' });

            log.info({ clientId, domain, periodDays, includePageSpeed }, 'Generating report');
            const report = await buildReport(db, { clientId, domain, agencyId: ctx.agencyId, periodDays, reportTitle, includePageSpeed });
            return { success: true, report };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to generate report');
            return reply.code(500).send({ error: 'Unable to generate this report right now' });
        }
    });

    // ─── Get Saved Reports List (agency-scoped) ───
    fastify.get('/api/reports', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const result = await db.query(
                `SELECT id, title, client_name, domain, period_days, generated_at,
                        share_expires_at,
                        (share_token_hash IS NOT NULL AND share_expires_at > NOW()) AS has_share_link
                 FROM seo_reports
                 WHERE agency_id = $1
                 ORDER BY generated_at DESC
                 LIMIT 50`,
                [ctx.agencyId]
            );
            return { reports: result.rows };
        } catch (err) {
            // Table might not exist yet, return empty gracefully
            log.warn({ err: err.message }, 'seo_reports table not found, returning empty');
            return { reports: [] };
        }
    });

    // ─── Save a Report (agency-scoped) ───
    fastify.post('/api/reports/save', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { report } = request.body || {};
        if (!report) return reply.code(400).send({ error: 'No report data provided' });

        try {
            const result = await db.query(
                `INSERT INTO seo_reports (title, client_name, domain, period_days, report_data, agency_id, generated_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
                 RETURNING id`,
                [
                    report.meta.title,
                    report.meta.clientName,
                    report.meta.domain,
                    report.meta.periodDays,
                    JSON.stringify(report),
                    ctx.agencyId,
                ]
            );
            return { success: true, reportId: result.rows[0].id };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to save report');
            return reply.code(500).send({ error: 'Unable to save this report right now' });
        }
    });

    // ─── Get a Saved Report ───
    fastify.get('/api/reports/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        try {
            const result = await db.query(
                `SELECT * FROM seo_reports WHERE id = $1 AND agency_id = $2`,
                [id, ctx.agencyId]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            return { report: result.rows[0].report_data };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to fetch report');
            return reply.code(500).send({ error: 'Unable to load this report right now' });
        }
    });

    // ─── Delete a Report (agency-scoped) ───
    fastify.delete('/api/reports/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        try {
            const result = await db.query(
                `DELETE FROM seo_reports WHERE id = $1 AND agency_id = $2 RETURNING id`,
                [id, ctx.agencyId]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to delete report');
            return reply.code(500).send({ error: 'Unable to delete this report right now' });
        }
    });

    // ─── Render HTML Report (for printing / PDF export) ───
    fastify.get('/reports/:id/html', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        try {
            const result = await db.query(
                `SELECT report_data FROM seo_reports WHERE id = $1 AND agency_id = $2`,
                [id, ctx.agencyId]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            const report = result.rows[0].report_data;
            return reply.view('report.ejs', { report, shared: false });
        } catch (err) {
            log.error({ err: err.message }, 'Failed to render HTML report');
            return reply.code(500).send({ error: 'Unable to render this report right now' });
        }
    });
}

module.exports = reportRoutes;
