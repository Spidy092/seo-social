/**
 * Audit Orchestrator
 *
 * Runs every check in src/services/audit/checks/ for a given project,
 * persists progress + results into `project_audits`, and produces a
 * unified `summary` with a score + prioritized actions.
 *
 * Usage:
 *   const audit = await runProjectAudit(db, projectId, { triggerSource: 'manual' });
 *   // audit is a row from project_audits
 *
 * Concurrency: checks run in parallel (limited by PARALLELISM). A
 * failure in one check does NOT abort the others.
 */
const { createLogger } = require('../utils/logger');
const checksRegistry = require('./audit/checks');
const auditSettings = require('./auditSettings');

const log = createLogger('audit-orchestrator');
const PARALLELISM = 3;

/**
 * Create an audit row in `pending` state and return it.
 *
 * @param {object} db
 * @param {object} args
 * @param {string} args.projectId
 * @param {string} [args.clientId]    auto-fetched if missing
 * @param {string} [args.userId]
 * @param {string} [args.agencyId]
 * @param {string} [args.triggerSource] 'manual' | 'auto-on-create' | 'scheduled' | 'api'
 * @param {string[]} [args.requestedChecks] explicit list of checks (overrides settings)
 * @returns {Promise<object>} the created audit row
 */
async function createAudit(db, {
    projectId,
    clientId,
    userId,
    agencyId,
    triggerSource = 'manual',
    requestedChecks = null,
}) {
    // Auto-fetch client_id/agency_id if not supplied
    if (!clientId || !agencyId) {
        const { rows } = await db.query(
            `SELECT p.client_id, c.agency_id, c.user_id
             FROM seo_projects p JOIN seo_clients c ON c.id = p.client_id
             WHERE p.id = $1`,
            [projectId],
        );
        if (!rows.length) throw new Error(`project not found: ${projectId}`);
        clientId = clientId || rows[0].client_id;
        agencyId = agencyId || rows[0].agency_id;
        userId = userId || rows[0].user_id;
    }

    // Resolve which checks to run: explicit param > per-project setting > global
    let checkNames;
    if (requestedChecks && Array.isArray(requestedChecks)) {
        checkNames = requestedChecks;
    } else {
        const allChecks = checksRegistry.listCheckNames();
        const settings = await auditSettings.resolveSettings(db, projectId);
        checkNames = auditSettings.applyEnabledChecks(allChecks, settings.enabledChecks);
    }

    const { rows } = await db.query(
        `INSERT INTO project_audits
            (project_id, client_id, user_id, agency_id, trigger_source, status, checks_total, requested_checks)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)
         RETURNING *`,
        [projectId, clientId, userId, agencyId, triggerSource, checkNames.length, JSON.stringify(checkNames)],
    );
    return rows[0];
}

/**
 * Run all checks for a project. Updates the audit row as it goes.
 * Resolves with the final audit row.
 */
async function runProjectAudit(db, projectId, opts = {}) {
    const audit = opts.audit
        ? opts.audit
        : await createAudit(db, {
              projectId,
              clientId: opts.clientId,
              userId: opts.userId,
              agencyId: opts.agencyId,
              triggerSource: opts.triggerSource || 'manual',
          });

    // ── Load project + client for context ─────────────────────────────
    const { rows: projRows } = await db.query(
        `SELECT p.*, c.id AS c_id, c.name AS c_name, c.website_url, c.gsc_site_url,
                c.ga4_property_id, c.agency_id AS c_agency_id
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1`,
        [projectId],
    );
    if (!projRows.length) {
        await db.query(
            `UPDATE project_audits SET status='failed', error_message='project not found', completed_at=NOW() WHERE id=$1`,
            [audit.id],
        );
        throw new Error(`project not found: ${projectId}`);
    }
    const proj = projRows[0];
    const client = {
        id: proj.c_id,
        name: proj.c_name,
        website_url: proj.website_url,
        gsc_site_url: proj.gsc_site_url,
        ga4_property_id: proj.ga4_property_id,
        agency_id: proj.c_agency_id,
    };

    const ctx = {
        db,
        project: proj,
        client,
        domain: client.website_url,
        location: proj.target_location || 'India',
        signal: null,
    };

    // ── Mark running ──────────────────────────────────────────────────
    await db.query(
        `UPDATE project_audits
         SET status='running', started_at=NOW(), progress=2
         WHERE id=$1`,
        [audit.id],
    );
    log.info({ auditId: audit.id, projectId, checks: checksRegistry.listCheckNames() }, 'audit started');

    // ── Run checks in parallel (limited) ──────────────────────────────
    const checkNames = checksRegistry.listCheckNames();
    const results = {};
    let done = 0;
    let failed = 0;

    async function runOne(name) {
        const startedAt = new Date();
        try {
            const result = await checksRegistry.getCheck(name)(ctx);
            results[name] = { ...result, startedAt, finishedAt: new Date() };
            if (result.status === 'failed') failed++;
        } catch (err) {
            results[name] = { status: 'failed', error: err.message, startedAt, finishedAt: new Date() };
            failed++;
        } finally {
            done++;
            const progress = Math.round(2 + (done / checkNames.length) * 90);
            await db.query(
                `UPDATE project_audits
                 SET checks_done=$1, checks_failed=$2, progress=$3, results=$4
                 WHERE id=$5`,
                [done, failed, progress, JSON.stringify(results), audit.id],
            ).catch(dbErr =>
                log.warn({ err: dbErr.message, auditId: audit.id }, 'failed to persist audit progress'),
            );
        }
    }

    // Simple worker-pool: PARALLELISM concurrent checks
    const queue = checkNames.slice();
    const workers = Array.from({ length: Math.min(PARALLELISM, queue.length) }, async () => {
        while (queue.length) {
            const name = queue.shift();
            await runOne(name);
        }
    });
    await Promise.all(workers);

    // ── Build summary + finalize ──────────────────────────────────────
    const summary = buildSummary(results);
    const status = failed === 0 ? 'success' : (done > failed ? 'partial' : 'failed');

    const { rows: finalRows } = await db.query(
        `UPDATE project_audits
         SET status=$1, progress=100, results=$2, summary=$3,
             completed_at=NOW()
         WHERE id=$4
         RETURNING *`,
        [status, JSON.stringify(results), JSON.stringify(summary), audit.id],
    );

    log.info({ auditId: audit.id, status, done, failed, score: summary.score }, 'audit finished');
    return finalRows[0];
}

/**
 * Roll up the per-check results into a single overall score + a
 * prioritized list of action items.
 */
function buildSummary(results) {
    // ── Score ─────────────────────────────────────────────────────────
    // Weighted average of the checks that produced a score.
    const weights = { technical: 0.30, onpage: 0.20, pagespeed: 0.20, keywords: 0.10, gsc: 0.10, ga4: 0.10 };
    let weighted = 0;
    let totalWeight = 0;
    for (const [name, weight] of Object.entries(weights)) {
        const r = results[name];
        const score = r?.data?.score;
        if (typeof score === 'number') {
            weighted += score * weight;
            totalWeight += weight;
        }
    }
    const score = totalWeight > 0 ? Math.round(weighted / totalWeight) : null;

    // ── Headline ──────────────────────────────────────────────────────
    const headline = score === null
        ? 'Audit completed — no scored checks available'
        : score >= 80 ? 'Strong SEO foundation'
        : score >= 60 ? 'Solid, with room to improve'
        : score >= 40 ? 'Several issues need attention'
        : 'Critical issues found';

    // ── Top issues + actions ─────────────────────────────────────────
    const issues = [];
    const actions = [];

    function pushIssue(severity, title, detail) {
        issues.push({ severity, title, detail });
        actions.push({ priority: severity, title, detail });
    }

    // Technical
    const tech = results.technical;
    if (tech?.data?.score !== undefined && tech.data.score < 70) {
        pushIssue(
            tech.data.score < 50 ? 'high' : 'medium',
            `Technical SEO score is ${tech.data.score}/100`,
            'Run a deep technical audit to surface crawl, index, and sitemap issues.',
        );
    }
    if (tech?.status === 'failed' && tech.error) {
        pushIssue('low', 'Technical audit could not run', tech.error);
    }

    // On-page
    const onp = results.onpage;
    if (onp?.data?.score !== undefined && onp.data.score < 70) {
        pushIssue('medium', `On-page score is ${onp.data.score}/100`, 'Tune title, meta, headings, and content on the homepage.');
    }

    // PageSpeed
    const ps = results.pagespeed;
    if (ps?.data?.mobileScore !== undefined && ps.data.mobileScore !== null && ps.data.mobileScore < 50) {
        pushIssue('high', `Mobile PageSpeed is ${ps.data.mobileScore}/100`, 'Optimize images, defer JS, reduce render-blocking resources.');
    }

    // Keywords
    const kw = results.keywords;
    if (kw?.status === 'success' && (kw.data?.count || 0) < 10) {
        pushIssue('low', 'Few keyword suggestions returned', 'Broaden the project name or seed term to discover more targets.');
    }

    // GSC
    const gsc = results.gsc;
    if (gsc?.data && gsc.data.clicks === 0 && gsc.data.impressions === 0) {
        pushIssue('medium', 'No GSC data in the last 30 days', 'Verify the GSC property is connected and recently synced.');
    }

    // GA4
    const ga4 = results.ga4;
    if (ga4?.data && ga4.data.sessions === 0) {
        pushIssue('low', 'No GA4 sessions recorded in 30 days', 'Confirm the GA4 property is correctly linked and the measurement ID is live.');
    }

    // Sort actions by priority
    const order = { high: 0, medium: 1, low: 2 };
    actions.sort((a, b) => order[a.priority] - order[b.priority]);

    return {
        score,
        headline,
        topIssues: issues.slice(0, 10),
        actions: actions.slice(0, 10),
        checksCompleted: Object.keys(results).length,
    };
}

/**
 * List audits for a project (most recent first).
 */
async function listAudits(db, projectId, { limit = 20 } = {}) {
    const { rows } = await db.query(
        `SELECT id, status, progress, trigger_source, checks_total, checks_done, checks_failed,
                summary, started_at, completed_at, created_at
         FROM project_audits
         WHERE project_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [projectId, limit],
    );
    return rows;
}

/**
 * Get one audit (with full results).
 */
async function getAudit(db, auditId) {
    const { rows } = await db.query(
        `SELECT * FROM project_audits WHERE id = $1`,
        [auditId],
    );
    return rows[0] || null;
}

/**
 * Cancel a pending or running audit.
 * No-op if the audit is already in a terminal state.
 */
async function cancelAudit(db, auditId, { cancelledBy = null } = {}) {
    const { rows } = await db.query(
        `UPDATE project_audits
         SET status = 'cancelled',
             cancelled_at = NOW(),
             cancelled_by = $2,
             completed_at = COALESCE(completed_at, NOW())
         WHERE id = $1 AND status IN ('pending', 'running')
         RETURNING *`,
        [auditId, cancelledBy],
    );
    return rows[0] || null;
}

module.exports = {
    runProjectAudit,
    createAudit,
    listAudits,
    getAudit,
    cancelAudit,
    buildSummary,
    listCheckNames: checksRegistry.listCheckNames,
};
