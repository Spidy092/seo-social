/**
 * Audit Settings Resolver
 *
 * Resolves the *effective* audit config for a project by merging:
 *   1. Global defaults (audit_settings_global)
 *   2. Per-project overrides (project_audit_settings)
 *   3. Hard-coded fallbacks
 *
 * A project can override ANY field; if it doesn't, we inherit from
 * global; if global is unset, we fall back to the hard-coded default.
 *
 * This is the only file that knows about defaults — everything else
 * (orchestrator, worker, routes) calls `resolveSettings(projectId)`.
 */
const DEFAULTS = {
    enabled: true,
    defaultChecks: [],                  // [] = all checks
    autoAuditOnCreate: true,
    weeklyEnabled: false,
    weeklyDayOfWeek: 0,                 // 0 = Sunday
    weeklyHour: 2,
    monthlyEnabled: false,
    monthlyDayOfMonth: 1,
    maxConcurrentAudits: 2,
    pollIntervalMs: 30000,
    notifyOnComplete: false,
    notifyWebhook: null,
    rankedKwCacheHours: 6,             // TTL for ranked-keywords snapshots
};

/**
 * All check names that exist (read from the registry).
 */
function allCheckNames() {
    return require('./audit/checks').listCheckNames();
}

/**
 * Map a raw `audit_settings_global` row (snake_case columns) into a
 * camelCase object matching the DEFAULTS shape.
 */
function mapGlobalRow(row) {
    if (!row) return {};
    return {
        enabled: row.enabled,
        defaultChecks: row.default_checks,
        autoAuditOnCreate: row.auto_audit_on_create,
        weeklyEnabled: row.weekly_enabled,
        weeklyDayOfWeek: row.weekly_day_of_week,
        weeklyHour: row.weekly_hour,
        monthlyEnabled: row.monthly_enabled,
        monthlyDayOfMonth: row.monthly_day_of_month,
        maxConcurrentAudits: row.max_concurrent_audits,
        pollIntervalMs: row.poll_interval_ms,
        notifyOnComplete: row.notify_on_complete,
        notifyWebhook: row.notify_webhook,
        rankedKwCacheHours: row.ranked_kw_cache_hours,
    };
}

/**
 * Fetch global settings. Cached for the lifetime of the process via
 * a small in-memory cache (invalidation on PUT via `invalidateGlobal`).
 */
let _globalCache = null;
let _globalCacheAt = 0;
const GLOBAL_TTL_MS = 30_000;

async function getGlobalSettings(db, { bypassCache = false } = {}) {
    if (!bypassCache && _globalCache && Date.now() - _globalCacheAt < GLOBAL_TTL_MS) {
        return _globalCache;
    }
    const { rows } = await db.query(`SELECT * FROM audit_settings_global WHERE id = 1`);
    const row = rows[0] || {};
    _globalCache = { ...DEFAULTS, ...mapGlobalRow(row) };
    _globalCacheAt = Date.now();
    return _globalCache;
}

function invalidateGlobal() {
    _globalCache = null;
    _globalCacheAt = 0;
}

async function updateGlobalSettings(db, patch) {
    // Whitelist what can be updated
    const allowed = [
        'enabled', 'default_checks', 'auto_audit_on_create',
        'weekly_enabled', 'weekly_day_of_week', 'weekly_hour',
        'monthly_enabled', 'monthly_day_of_month',
        'max_concurrent_audits', 'poll_interval_ms',
        'notify_on_complete', 'notify_webhook',
        'ranked_kw_cache_hours',
    ];
    const keys = Object.keys(patch).filter(k => allowed.includes(k));
    if (!keys.length) return getGlobalSettings(db, { bypassCache: true });

    const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = keys.map(k => patch[k]);
    await db.query(
        `UPDATE audit_settings_global SET ${setClauses}, updated_at = NOW() WHERE id = 1`,
        values,
    );
    invalidateGlobal();
    return getGlobalSettings(db, { bypassCache: true });
}

/**
 * Fetch per-project settings. Returns {} when none exist.
 */
async function getProjectSettings(db, projectId) {
    const { rows } = await db.query(
        `SELECT * FROM project_audit_settings WHERE project_id = $1`,
        [projectId],
    );
    return rows[0] || null;
}

async function upsertProjectSettings(db, projectId, patch) {
    const existing = await getProjectSettings(db, projectId);
    const merged = existing
        ? { ...existing, ...patch, updated_at: new Date() }
        : { project_id: projectId, ...patch, created_at: new Date(), updated_at: new Date() };

    // Pick the columns that we want to upsert
    const cols = [
        'project_id', 'enabled_checks', 'auto_audit_on_create',
        'weekly_enabled', 'weekly_day_of_week', 'weekly_hour',
        'monthly_enabled', 'monthly_day_of_month',
        'custom_keywords', 'custom_urls',
        'notify_on_complete', 'notify_emails', 'notify_webhook',
        'max_checks_concurrency',
    ];
    const values = cols.map(c => merged[c] ?? null);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const updateClauses = cols
        .filter(c => c !== 'project_id')
        .map(c => `${c} = COALESCE(EXCLUDED.${c}, ${c})`)
        .join(', ');

    await db.query(
        `INSERT INTO project_audit_settings (${cols.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT (project_id) DO UPDATE SET ${updateClauses}, updated_at = NOW()`,
        values,
    );
    return getProjectSettings(db, projectId);
}

/**
 * Resolve the *effective* settings for a project.
 * Returns a flat object with all fields, inheriting from global where
 * the project hasn't overridden.
 */
async function resolveSettings(db, projectId) {
    const [global, project] = await Promise.all([
        getGlobalSettings(db),
        getProjectSettings(db, projectId),
    ]);

    const projectEnabledChecks = project?.enabled_checks || [];
    const globalChecks = global.defaultChecks || [];

    return {
        projectId,
        enabled: !!(global.enabled && (project?.enabled !== false)),  // project can only disable, not enable if global off
        // If the project explicitly set enabled_checks, use it; otherwise use global default; otherwise all checks
        enabledChecks: projectEnabledChecks.length
            ? projectEnabledChecks
            : (globalChecks.length ? globalChecks : allCheckNames()),
        autoAuditOnCreate: project?.auto_audit_on_create ?? global.autoAuditOnCreate ?? DEFAULTS.autoAuditOnCreate,
        weeklyEnabled: project?.weekly_enabled ?? global.weeklyEnabled ?? DEFAULTS.weeklyEnabled,
        weeklyDayOfWeek: project?.weekly_day_of_week ?? global.weeklyDayOfWeek ?? DEFAULTS.weeklyDayOfWeek,
        weeklyHour: project?.weekly_hour ?? global.weeklyHour ?? DEFAULTS.weeklyHour,
        monthlyEnabled: project?.monthly_enabled ?? global.monthlyEnabled ?? DEFAULTS.monthlyEnabled,
        monthlyDayOfMonth: project?.monthly_day_of_month ?? global.monthlyDayOfMonth ?? DEFAULTS.monthlyDayOfMonth,
        customKeywords: project?.custom_keywords || [],
        customUrls: project?.custom_urls || [],
        notifyOnComplete: project?.notify_on_complete ?? global.notifyOnComplete ?? DEFAULTS.notifyOnComplete,
        notifyEmails: project?.notify_emails || [],
        notifyWebhook: project?.notify_webhook || global.notifyWebhook || null,
        maxConcurrency: project?.max_checks_concurrency ?? global.maxConcurrentAudits ?? DEFAULTS.maxConcurrentAudits,
        pollIntervalMs: global.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
        rankedKwCacheHours: global.rankedKwCacheHours ?? DEFAULTS.rankedKwCacheHours,
        // Raw values, for the UI to show what's overridden
        _global: global,
        _project: project,
    };
}

/**
 * Filter the master check list by a project's enabled_checks setting.
 * Returns the array of check names that should run.
 */
function applyEnabledChecks(allChecks, enabledChecks) {
    if (!enabledChecks || !enabledChecks.length) return allChecks;
    return allChecks.filter(c => enabledChecks.includes(c));
}

/**
 * Check if the project audits feature is currently enabled.
 * Master switch lives on the global row.
 */
async function isMasterEnabled(db) {
    const g = await getGlobalSettings(db);
    return !!g.enabled;
}

module.exports = {
    DEFAULTS,
    allCheckNames,
    getGlobalSettings,
    updateGlobalSettings,
    invalidateGlobal,
    getProjectSettings,
    upsertProjectSettings,
    resolveSettings,
    applyEnabledChecks,
    isMasterEnabled,
};
