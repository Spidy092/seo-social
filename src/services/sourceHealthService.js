const SOURCE_DEFINITIONS = [
    { key: 'workspace', label: 'Workspace records', thresholdHours: 24, source: 'Stored agency records' },
    { key: 'rankings', label: 'Rank tracker', thresholdHours: 72, source: 'Stored rank tracker results' },
    { key: 'technical', label: 'Technical crawl', thresholdHours: 30 * 24, source: 'Stored technical crawl results' },
    { key: 'pageSpeed', label: 'PageSpeed', thresholdHours: 14 * 24, source: 'Stored PageSpeed checks' },
    { key: 'gsc', label: 'Search Console', thresholdHours: 7 * 24, source: 'Google Search Console sync' },
    { key: 'ga4', label: 'Analytics', thresholdHours: 7 * 24, source: 'Google Analytics sync' },
];

const STATUS_PRIORITY = ['unavailable', 'failed', 'stale', 'missing', 'fresh', 'not_configured'];

function asDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function classifySourceStatus({
    configured = true,
    queryError = null,
    lastCollectedAt = null,
    lastAttemptAt = null,
    lastStatus = null,
    thresholdHours = 24,
}, now = new Date()) {
    if (queryError) return { status: 'unavailable', ageHours: null };
    if (!configured) return { status: 'not_configured', ageHours: null };

    const collected = asDate(lastCollectedAt);
    const attempt = asDate(lastAttemptAt);
    if (attempt && String(lastStatus || '').toLowerCase() === 'failed' && (!collected || attempt >= collected)) {
        return { status: 'failed', ageHours: collected ? Math.max(0, (now - collected) / 3600000) : null };
    }
    if (!collected) return { status: 'missing', ageHours: null };

    const ageHours = Math.max(0, (now - collected) / 3600000);
    return {
        status: ageHours > thresholdHours ? 'stale' : 'fresh',
        ageHours: Math.round(ageHours),
    };
}

function sourceNote(status, thresholdHours) {
    if (status === 'fresh') return 'Within freshness window';
    if (status === 'stale') return `Older than ${Math.round(thresholdHours / 24)} days`;
    if (status === 'failed') return 'Latest collection failed';
    if (status === 'missing') return 'No successful collection recorded';
    if (status === 'not_configured') return 'Not connected for this workspace';
    return 'Could not verify source state';
}

function buildSourceHealth(rows = {}, now = new Date()) {
    const sources = SOURCE_DEFINITIONS.map((definition) => {
        const row = rows[definition.key] || {};
        const configured = row.configured !== undefined ? Boolean(row.configured) : true;
        const classification = classifySourceStatus({
            ...row,
            configured,
            thresholdHours: definition.thresholdHours,
        }, now);
        const collected = asDate(row.lastCollectedAt);
        const attempt = asDate(row.lastAttemptAt);

        return {
            key: definition.key,
            label: definition.label,
            source: row.source || definition.source,
            status: classification.status,
            recordCount: Number(row.recordCount) || 0,
            configuredClients: Number(row.configuredClients) || 0,
            thresholdHours: definition.thresholdHours,
            ageHours: classification.ageHours,
            lastCollectedAt: collected?.toISOString() || null,
            lastAttemptAt: attempt?.toISOString() || null,
            note: row.note || sourceNote(classification.status, definition.thresholdHours),
        };
    });

    const counts = sources.reduce((result, source) => {
        result[source.status] = (result[source.status] || 0) + 1;
        return result;
    }, {});
    const overallStatus = STATUS_PRIORITY.find((status) => sources.some((source) => source.status === status)) || 'fresh';

    return {
        overallStatus,
        counts,
        generatedAt: asDate(now)?.toISOString() || new Date().toISOString(),
        sources,
    };
}

async function safeAggregate(db, sql, params) {
    try {
        const result = await db.query(sql, params);
        return result.rows[0] || {};
    } catch (err) {
        return { queryError: err.message };
    }
}

function normalizeSourceRow(row = {}) {
    return {
        queryError: row.queryError || null,
        lastCollectedAt: row.last_collected_at ?? row.lastCollectedAt ?? null,
        lastAttemptAt: row.last_attempt_at ?? row.lastAttemptAt ?? null,
        lastStatus: row.last_status ?? row.lastStatus ?? null,
        recordCount: row.record_count ?? row.recordCount ?? 0,
        configuredClients: row.configured_clients ?? row.configuredClients ?? 0,
        configured: row.configured,
        source: row.source,
        note: row.note,
    };
}

async function getSourceHealth(db, agencyId, { now = new Date() } = {}) {
    const [workspace, rankings, technical, pageSpeed, gsc, ga4] = await Promise.all([
        safeAggregate(db, `
            SELECT MAX(updated_at) AS last_collected_at, COUNT(*)::int AS record_count
            FROM seo_clients
            WHERE agency_id = $1`, [agencyId]),
        safeAggregate(db, `
            SELECT MAX(checked_at) AS last_collected_at, COUNT(*)::int AS record_count
            FROM domain_rankings
            WHERE agency_id = $1`, [agencyId]),
        safeAggregate(db, `
            SELECT MAX(created_at) AS last_collected_at, COUNT(*)::int AS record_count
            FROM technical_audits
            WHERE agency_id = $1`, [agencyId]),
        safeAggregate(db, `
            SELECT MAX(created_at) AS last_collected_at, COUNT(*)::int AS record_count
            FROM page_speed_checks
            WHERE agency_id = $1`, [agencyId]),
        safeAggregate(db, `
            SELECT
                MAX(r.finished_at) FILTER (WHERE r.status = 'success') AS last_collected_at,
                MAX(r.finished_at) AS last_attempt_at,
                (ARRAY_AGG(r.status ORDER BY r.finished_at DESC NULLS LAST))[1] AS last_status,
                COALESCE(SUM(CASE WHEN r.status = 'success' THEN r.rows_synced ELSE 0 END), 0)::int AS record_count,
                COUNT(DISTINCT c.id) FILTER (WHERE NULLIF(TRIM(c.gsc_site_url), '') IS NOT NULL)::int AS configured_clients,
                COUNT(*) FILTER (WHERE r.status = 'success')::int AS successful_runs
            FROM seo_clients c
            LEFT JOIN gsc_sync_runs r ON r.client_id = c.id
            WHERE c.agency_id = $1`, [agencyId]),
        safeAggregate(db, `
            SELECT
                MAX(r.finished_at) FILTER (WHERE r.status = 'success') AS last_collected_at,
                MAX(r.finished_at) AS last_attempt_at,
                (ARRAY_AGG(r.status ORDER BY r.finished_at DESC NULLS LAST))[1] AS last_status,
                COALESCE(SUM(CASE WHEN r.status = 'success' THEN r.rows_synced ELSE 0 END), 0)::int AS record_count,
                COUNT(DISTINCT c.id) FILTER (WHERE NULLIF(TRIM(c.ga4_property_id), '') IS NOT NULL)::int AS configured_clients,
                COUNT(*) FILTER (WHERE r.status = 'success')::int AS successful_runs
            FROM seo_clients c
            LEFT JOIN ga4_sync_runs r ON r.client_id = c.id
            WHERE c.agency_id = $1`, [agencyId]),
    ]);

    const normalizedRows = {
        workspace: normalizeSourceRow(workspace),
        rankings: normalizeSourceRow(rankings),
        technical: normalizeSourceRow(technical),
        pageSpeed: normalizeSourceRow(pageSpeed),
        gsc: { ...normalizeSourceRow(gsc), configured: Number(gsc.configured_clients) > 0 },
        ga4: { ...normalizeSourceRow(ga4), configured: Number(ga4.configured_clients) > 0 },
    };

    return buildSourceHealth({
        workspace: normalizedRows.workspace,
        rankings: normalizedRows.rankings,
        technical: normalizedRows.technical,
        pageSpeed: normalizedRows.pageSpeed,
        gsc: normalizedRows.gsc,
        ga4: normalizedRows.ga4,
    }, now);
}

module.exports = { buildSourceHealth, classifySourceStatus, getSourceHealth, normalizeSourceRow };
