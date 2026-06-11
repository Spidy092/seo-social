const cron = require('node-cron');
const { buildReport } = require('../services/reportService');
const { sendEmail } = require('../services/emailService');
const { renderEmailReport } = require('../services/emailReportTemplate');
const { createLogger } = require('../utils/logger');

const log = createLogger('scheduled-reports');

/**
 * Compute the next run time based on frequency.
 */
function computeNextRunAt(schedule) {
    const now = new Date();
    const hour = schedule.hour || 8;
    const next = new Date(now);

    if (schedule.frequency === 'weekly') {
        const targetDay = schedule.day_of_week || 1; // 0=Sun, 1=Mon
        const currentDay = now.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 7;
        next.setDate(now.getDate() + daysAhead);
    } else if (schedule.frequency === 'biweekly') {
        const targetDay = schedule.day_of_week || 1;
        const currentDay = now.getDay();
        let daysAhead = targetDay - currentDay;
        if (daysAhead <= 0) daysAhead += 14;
        next.setDate(now.getDate() + daysAhead);
    } else {
        // monthly — target day of month
        const targetDay = Math.min(schedule.day_of_month || 1, 28);
        next.setDate(targetDay);
        if (next <= now) {
            next.setMonth(next.getMonth() + 1);
        }
    }

    next.setHours(hour, 0, 0, 0);
    if (next <= now) {
        next.setDate(next.getDate() + (schedule.frequency === 'weekly' ? 7 : schedule.frequency === 'biweekly' ? 14 : 0));
        if (next <= now && schedule.frequency === 'monthly') {
            next.setMonth(next.getMonth() + 1);
        }
    }
    return next;
}

/**
 * Process a single scheduled report: generate, send email, update timestamps.
 */
async function processScheduledReport(db, schedule) {
    const recipients = Array.isArray(schedule.recipients) ? schedule.recipients : [];
    if (!recipients.length) {
        log.warn({ scheduleId: schedule.id }, 'no recipients, skipping');
        return { ok: false, error: 'no recipients' };
    }

    const opts = schedule.report_options || {};

    log.info({ scheduleId: schedule.id, domain: schedule.domain, recipients: recipients.length }, 'generating scheduled report');

    // Generate the report
    const report = await buildReport(db, {
        clientId: schedule.client_id || undefined,
        domain: schedule.domain,
        periodDays: opts.periodDays || 30,
        reportTitle: schedule.title,
        includePageSpeed: opts.includePageSpeed !== false,
    });

    // Save report to seo_reports
    const insert = await db.query(
        `INSERT INTO seo_reports (title, client_name, domain, period_days, report_data, agency_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
            schedule.title,
            report.meta?.clientName || '',
            schedule.domain,
            opts.periodDays || 30,
            JSON.stringify(report),
            schedule.agency_id || null,
        ]
    );
    const reportId = insert.rows[0].id;

    // Render email HTML
    const html = renderEmailReport(report);

    // Send email
    const subject = `${schedule.title} — ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    await sendEmail({
        to: recipients,
        subject,
        html,
        text: `Your SEO report for ${schedule.domain} is ready. View it in your dashboard.`,
    });

    // Update schedule timestamps
    const nextRun = computeNextRunAt(schedule);
    await db.query(
        `UPDATE scheduled_reports SET last_sent_at = NOW(), next_run_at = $1 WHERE id = $2`,
        [nextRun, schedule.id]
    );

    log.info({ scheduleId: schedule.id, reportId, nextRun: nextRun.toISOString() }, 'scheduled report sent');
    return { ok: true, reportId };
}

/**
 * Check for due reports and process them.
 */
async function checkAndSendDueReports(db) {
    try {
        const { rows: dueReports } = await db.query(
            `SELECT * FROM scheduled_reports
             WHERE is_active = TRUE
               AND (next_run_at IS NULL OR next_run_at <= NOW())
             ORDER BY next_run_at ASC NULLS FIRST
             LIMIT 20`
        );

        if (!dueReports.length) {
            log.debug('no scheduled reports due');
            return;
        }

        log.info({ count: dueReports.length }, 'processing due scheduled reports');

        for (const schedule of dueReports) {
            try {
                await processScheduledReport(db, schedule);
            } catch (err) {
                log.error({ scheduleId: schedule.id, err: err.message }, 'failed to process scheduled report');

                // Update next_run_at so it retries tomorrow instead of every cycle
                const nextRun = computeNextRunAt(schedule);
                await db.query(
                    `UPDATE scheduled_reports SET next_run_at = $1 WHERE id = $2`,
                    [nextRun, schedule.id]
                ).catch(() => {});
            }
        }
    } catch (err) {
        log.error({ err: err.message }, 'scheduled reports check failed');
    }
}

/**
 * Start the scheduled reports worker.
 * Runs every 15 minutes to check for due reports.
 */
function startScheduledReports(db) {
    // Check every 15 minutes
    cron.schedule('*/15 * * * *', () => {
        checkAndSendDueReports(db).catch(err => {
            log.error({ err: err.message }, 'scheduled reports cron error');
        });
    });

    // Also run once on startup after 2 minutes
    setTimeout(() => {
        checkAndSendDueReports(db).catch(err => {
            log.error({ err: err.message }, 'initial scheduled reports check failed');
        });
    }, 120000);

    log.info('scheduled reports worker started — checking every 15 minutes');
}

module.exports = { startScheduledReports, checkAndSendDueReports, processScheduledReport, computeNextRunAt };
