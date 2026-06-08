/**
 * 📊 Agency Report Routes
 * Generates PDF/HTML reports for client SEO work.
 */

const { buildReport } = require('../services/reportService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:reports');

async function reportRoutes(fastify, options) {
    const { db } = options;

    // ─── Generate Report Data (JSON) ───
    fastify.post('/api/reports/generate', async (request, reply) => {
        const { clientId, domain, periodDays = 30, reportTitle } = request.body || {};

        if (!domain && !clientId) {
            return reply.code(400).send({ error: 'Provide a domain or clientId to generate a report' });
        }

        try {
            log.info({ clientId, domain, periodDays }, 'Generating report');
            const report = await buildReport(db, { clientId, domain, periodDays, reportTitle });
            return { success: true, report };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to generate report');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Saved Reports List ───
    fastify.get('/api/reports', async (request, reply) => {
        try {
            const result = await db.query(
                `SELECT id, title, client_name, domain, period_days, generated_at
                 FROM seo_reports
                 ORDER BY generated_at DESC
                 LIMIT 50`
            );
            return { reports: result.rows };
        } catch (err) {
            // Table might not exist yet, return empty gracefully
            log.warn({ err: err.message }, 'seo_reports table not found, returning empty');
            return { reports: [] };
        }
    });

    // ─── Save a Report ───
    fastify.post('/api/reports/save', async (request, reply) => {
        const { report } = request.body || {};
        if (!report) return reply.code(400).send({ error: 'No report data provided' });

        try {
            const result = await db.query(
                `INSERT INTO seo_reports (title, client_name, domain, period_days, report_data, generated_at)
                 VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
                 RETURNING id`,
                [
                    report.meta.title,
                    report.meta.clientName,
                    report.meta.domain,
                    report.meta.periodDays,
                    JSON.stringify(report),
                ]
            );
            return { success: true, reportId: result.rows[0].id };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to save report');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get a Saved Report ───
    fastify.get('/api/reports/:id', async (request, reply) => {
        const { id } = request.params;
        try {
            const result = await db.query(
                'SELECT * FROM seo_reports WHERE id = $1',
                [id]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            return { report: result.rows[0].report_data };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to fetch report');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete a Report ───
    fastify.delete('/api/reports/:id', async (request, reply) => {
        const { id } = request.params;
        try {
            await db.query('DELETE FROM seo_reports WHERE id = $1', [id]);
            return { success: true };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to delete report');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Render HTML Report (for printing / PDF export) ───
    fastify.get('/reports/:id/html', async (request, reply) => {
        const { id } = request.params;
        try {
            const result = await db.query(
                'SELECT report_data FROM seo_reports WHERE id = $1',
                [id]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            const report = result.rows[0].report_data;
            return reply.view('report.ejs', { report });
        } catch (err) {
            log.error({ err: err.message }, 'Failed to render HTML report');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = reportRoutes;
