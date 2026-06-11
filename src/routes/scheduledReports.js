const { getAgencyContext } = require('../utils/authHelper');
const { verifyConnection } = require('../services/emailService');
const { computeNextRunAt } = require('../workers/scheduledReports');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:scheduled-reports');

async function scheduledReportRoutes(fastify, options) {
    const { db } = options;

    // ─── List scheduled reports ───
    fastify.get('/api/scheduled-reports', async (request) => {
        const ctx = await getAgencyContext(request, db);
        const agencyId = ctx?.agencyId || null;

        const { rows } = await db.query(
            `SELECT sr.*, sc.name AS client_name
             FROM scheduled_reports sr
             LEFT JOIN seo_clients sc ON sc.id = sr.client_id
             WHERE (sr.agency_id = $1 OR sr.agency_id IS NULL OR $1 IS NULL)
               AND sr.user_id = $2
             ORDER BY sr.created_at DESC`,
            [agencyId, ctx?.userId]
        );

        return { success: true, schedules: rows };
    });

    // ─── Create scheduled report ───
    fastify.post('/api/scheduled-reports', {
        schema: {
            body: {
                type: 'object',
                required: ['domain', 'recipients'],
                properties: {
                    clientId: { type: 'string' },
                    domain: { type: 'string' },
                    title: { type: 'string', default: 'Monthly SEO Report' },
                    recipients: { type: 'array', items: { type: 'string' }, minItems: 1 },
                    frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'], default: 'monthly' },
                    dayOfWeek: { type: 'integer', minimum: 0, maximum: 6, default: 1 },
                    dayOfMonth: { type: 'integer', minimum: 1, maximum: 28, default: 1 },
                    hour: { type: 'integer', minimum: 0, maximum: 23, default: 8 },
                    reportOptions: { type: 'object' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await getAgencyContext(request, db);
            const {
                clientId = null, domain, title = 'Monthly SEO Report',
                recipients, frequency = 'monthly', dayOfWeek = 1,
                dayOfMonth = 1, hour = 8, reportOptions = {},
            } = request.body;

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const invalidEmails = recipients.filter(r => !emailRegex.test(r));
            if (invalidEmails.length) {
                return reply.code(400).send({ error: `Invalid email(s): ${invalidEmails.join(', ')}` });
            }

            const schedule = {
                frequency, day_of_week: dayOfWeek, day_of_month: dayOfMonth, hour,
            };
            const nextRun = computeNextRunAt(schedule);

            const { rows } = await db.query(
                `INSERT INTO scheduled_reports
                 (user_id, agency_id, client_id, domain, title, recipients, frequency, day_of_week, day_of_month, hour, report_options, next_run_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING *`,
                [
                    ctx?.userId, ctx?.agencyId || null, clientId, domain, title,
                    JSON.stringify(recipients), frequency, dayOfWeek, dayOfMonth, hour,
                    JSON.stringify(reportOptions), nextRun,
                ]
            );

            log.info({ scheduleId: rows[0].id, domain, frequency }, 'scheduled report created');
            return { success: true, schedule: rows[0] };
        },
    });

    // ─── Update scheduled report ───
    fastify.put('/api/scheduled-reports/:id', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    title: { type: 'string' },
                    recipients: { type: 'array', items: { type: 'string' } },
                    frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] },
                    dayOfWeek: { type: 'integer', minimum: 0, maximum: 6 },
                    dayOfMonth: { type: 'integer', minimum: 1, maximum: 28 },
                    hour: { type: 'integer', minimum: 0, maximum: 23 },
                    isActive: { type: 'boolean' },
                    reportOptions: { type: 'object' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await getAgencyContext(request, db);
            const { id } = request.params;
            const body = request.body;

            // Verify ownership
            const existing = await db.query(
                `SELECT * FROM scheduled_reports WHERE id = $1 AND user_id = $2`,
                [id, ctx?.userId]
            );
            if (!existing.rows.length) {
                return reply.code(404).send({ error: 'Schedule not found' });
            }

            const current = existing.rows[0];
            const frequency = body.frequency || current.frequency;
            const dayOfWeek = body.dayOfWeek ?? current.day_of_week;
            const dayOfMonth = body.dayOfMonth ?? current.day_of_month;
            const hour = body.hour ?? current.hour;

            const nextRun = computeNextRunAt({ frequency, day_of_week: dayOfWeek, day_of_month: dayOfMonth, hour });

            const { rows } = await db.query(
                `UPDATE scheduled_reports SET
                    title = COALESCE($1, title),
                    recipients = COALESCE($2, recipients),
                    frequency = $3,
                    day_of_week = $4,
                    day_of_month = $5,
                    hour = $6,
                    is_active = COALESCE($7, is_active),
                    report_options = COALESCE($8, report_options),
                    next_run_at = $9
                 WHERE id = $10
                 RETURNING *`,
                [
                    body.title || null,
                    body.recipients ? JSON.stringify(body.recipients) : null,
                    frequency, dayOfWeek, dayOfMonth, hour,
                    body.isActive ?? null,
                    body.reportOptions ? JSON.stringify(body.reportOptions) : null,
                    nextRun, id,
                ]
            );

            return { success: true, schedule: rows[0] };
        },
    });

    // ─── Delete scheduled report ───
    fastify.delete('/api/scheduled-reports/:id', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        const { id } = request.params;

        const { rowCount } = await db.query(
            `DELETE FROM scheduled_reports WHERE id = $1 AND user_id = $2`,
            [id, ctx?.userId]
        );

        if (!rowCount) {
            return reply.code(404).send({ error: 'Schedule not found' });
        }

        return { success: true };
    });

    // ─── Send test email ───
    fastify.post('/api/scheduled-reports/test', {
        schema: {
            body: {
                type: 'object',
                required: ['email'],
                properties: {
                    email: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { email } = request.body;
            const { sendEmail } = require('../services/emailService');

            try {
                await sendEmail({
                    to: email,
                    subject: 'Keyword Analyzer — Email Test',
                    html: '<h2>Email is working!</h2><p>Your SMTP configuration is correct. Scheduled reports will be delivered to this address.</p>',
                    text: 'Email is working! Your SMTP configuration is correct.',
                });
                return { success: true, message: `Test email sent to ${email}` };
            } catch (err) {
                log.error({ err: err.message, email }, 'test email failed');
                return reply.code(500).send({ error: 'Failed to send test email: ' + err.message });
            }
        },
    });

    // ─── Check SMTP status ───
    fastify.get('/api/scheduled-reports/smtp-status', async () => {
        const status = await verifyConnection();
        return { success: true, ...status };
    });
}

module.exports = scheduledReportRoutes;
