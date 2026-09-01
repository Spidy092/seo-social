/**
 * Small, deterministic provenance contract for report output.
 * A report consumer can distinguish measured, proxy, and missing data without
 * guessing from the metric value itself.
 */

function latestTimestamp(rows, fields) {
    const timestamps = (Array.isArray(rows) ? rows : [])
        .flatMap((row) => fields.map((field) => row?.[field]))
        .map((value) => new Date(value))
        .filter((date) => !Number.isNaN(date.getTime()))
        .sort((a, b) => b - a);
    return timestamps[0]?.toISOString() || null;
}

function sourceEntry(key, label, rows, fields, options = {}) {
    const count = Array.isArray(rows) ? rows.length : 0;
    const lastCollectedAt = options.lastCollectedAt || latestTimestamp(rows, fields);
    const hasData = count > 0 || !!lastCollectedAt;
    return {
        key,
        label,
        status: !hasData ? 'not_collected' : options.proxy ? 'proxy' : 'collected',
        source: options.source || label,
        recordCount: count,
        lastCollectedAt,
        note: !hasData ? 'No records available for this period' : options.note || null,
    };
}

function buildReportProvenance(data = {}) {
    return {
        rankings: sourceEntry('rankings', 'Rank tracker', data.rankings, ['checked_at'], {
            source: 'Stored rank tracker',
        }),
        technical: sourceEntry('technical', 'Technical crawl', data.technicalAudits, ['audit_date', 'created_at'], {
            source: 'Stored technical crawl',
        }),
        pageSpeed: data.pageSpeed
            ? sourceEntry('pageSpeed', 'PageSpeed', [data.pageSpeed], ['savedAt', 'fetchedAt'], {
                  source:
                      data.pageSpeed.source === 'google-pagespeed-insights'
                          ? 'Google PageSpeed Insights'
                          : 'Technical crawl proxy',
                  proxy: data.pageSpeed.source !== 'google-pagespeed-insights',
                  note:
                      data.pageSpeed.source === 'google-pagespeed-insights'
                          ? null
                          : 'Load-time signal derived from the technical crawl',
              })
            : sourceEntry('pageSpeed', 'PageSpeed', [], [], { source: 'Google PageSpeed Insights' }),
        gsc: sourceEntry('gsc', 'Search Console', data.gscRows, ['created_at', 'date_end'], {
            source: 'Stored Google Search Console data',
        }),
        pageOptimizations: sourceEntry(
            'pageOptimizations',
            'Page optimization',
            data.pageOptimizations,
            ['created_at'],
            { source: 'Stored on-page analysis' },
        ),
        contentBriefs: sourceEntry('contentBriefs', 'Content briefs', data.contentBriefs, ['created_at'], {
            source: 'Stored content brief data',
        }),
    };
}

module.exports = { buildReportProvenance, latestTimestamp, sourceEntry };
