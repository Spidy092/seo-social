const { getAgencyContext } = require('../utils/authHelper');
const { createLogger } = require('../utils/logger');
const { createShareExpiry, createShareToken, hashShareToken, normalizeExpiryHours } = require('../services/reportShareService');

const log = createLogger('routes:report-share');

async function reportShareRoutes(fastify, { db }) {
    fastify.post('/api/reports/:id/share', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        const { id } = request.params;
        const expiryHours = normalizeExpiryHours(request.body?.expiresInHours);
        const expiresAt = createShareExpiry(new Date(), expiryHours);
        const { token, tokenHash } = createShareToken();

        try {
            const result = await db.query(
                `UPDATE seo_reports
                 SET share_token_hash = $1, share_expires_at = $2
                 WHERE id = $3 AND agency_id = $4
                 RETURNING id, share_expires_at`,
                [tokenHash, expiresAt, id, ctx.agencyId]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });

            return {
                success: true,
                sharePath: `/reports/shared/${token}`,
                expiresAt: result.rows[0].share_expires_at,
                expiresInHours: expiryHours,
            };
        } catch (err) {
            log.error({ err: err.message, reportId: id }, 'failed to create report share link');
            return reply.code(500).send({ error: 'Unable to create a share link right now' });
        }
    });

    fastify.delete('/api/reports/:id/share', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const result = await db.query(
                `UPDATE seo_reports
                 SET share_token_hash = NULL, share_expires_at = NULL
                 WHERE id = $1 AND agency_id = $2
                 RETURNING id`,
                [request.params.id, ctx.agencyId]
            );
            if (!result.rows.length) return reply.code(404).send({ error: 'Report not found' });
            return { success: true };
        } catch (err) {
            log.error({ err: err.message, reportId: request.params.id }, 'failed to revoke report share link');
            return reply.code(500).send({ error: 'Unable to revoke this share link right now' });
        }
    });

    fastify.get('/reports/shared/:token', async (request, reply) => {
        const token = String(request.params.token || '');
        if (!/^[a-f0-9]{64}$/i.test(token)) {
            return reply.code(404).view('404.ejs', { title: 'Shared report unavailable', url: 'shared report' });
        }

        try {
            const result = await db.query(
                `SELECT report_data, share_expires_at
                 FROM seo_reports
                 WHERE share_token_hash = $1
                   AND share_expires_at > NOW()
                 LIMIT 1`,
                [hashShareToken(token)]
            );
            if (!result.rows.length) {
                return reply.code(404).view('404.ejs', { title: 'Shared report unavailable', url: 'shared report' });
            }

            return reply.view('report.ejs', {
                report: result.rows[0].report_data,
                shared: true,
                shareExpiresAt: result.rows[0].share_expires_at,
            });
        } catch (err) {
            log.error({ err: err.message }, 'failed to load shared report');
            return reply.code(404).view('404.ejs', { title: 'Shared report unavailable', url: 'shared report' });
        }
    });
}

module.exports = reportShareRoutes;
