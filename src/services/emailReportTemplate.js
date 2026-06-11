/**
 * Email-safe HTML report template.
 * Uses inline CSS only (no <style> blocks) for maximum email client compatibility.
 */

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function scoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
}

function positionBadge(pos) {
    if (!pos || pos === 0) return '<span style="color:#94a3b8">—</span>';
    const color = pos <= 3 ? '#10b981' : pos <= 10 ? '#3b82f6' : pos <= 20 ? '#f59e0b' : '#94a3b8';
    return `<span style="color:${color};font-weight:700">#${pos}</span>`;
}

function renderEmailReport(report) {
    const { meta, summary, aiNarrative, data } = report;
    const s = summary || {};
    const ai = aiNarrative || {};
    const baseUrl = process.env.APP_URL || 'http://localhost:4000';

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
<tr><td align="center" style="padding:24px 12px;">
<table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:32px 28px;color:#fff;">
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;">${escHtml(meta.title || 'SEO Report')}</h1>
    <p style="margin:0 0 6px;font-size:14px;opacity:0.9;">${escHtml(meta.clientName || meta.domain || '')} &middot; ${escHtml(meta.periodStart || '')} — ${escHtml(meta.periodEnd || '')}</p>
    ${ai.executiveSummary ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;opacity:0.92;">${escHtml(ai.executiveSummary)}</p>` : ''}
</td></tr>

<!-- Health Score + Key Stats -->
<tr><td style="padding:24px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td width="120" align="center" style="padding-right:16px;">
            <div style="width:80px;height:80px;border-radius:50%;background:${scoreColor(ai.overallHealthScore || s.technicalScore || 0)};color:#fff;font-size:28px;font-weight:700;line-height:80px;text-align:center;">${ai.overallHealthScore || s.technicalScore || '—'}</div>
            <div style="font-size:11px;color:#64748b;margin-top:6px;">Health Score</div>
        </td>
        <td>
            <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
                ${statCell('Keywords', s.totalKeywordsTracked || 0)}
                ${statCell('Top 10', s.top10Count || 0)}
                ${statCell('Top 3', s.top3Count || 0)}
            </tr>
            <tr>
                ${statCell('Avg Position', s.avgPosition ? s.avgPosition.toFixed(1) : '—')}
                ${statCell('Improved', '+' + (s.improvedCount || 0), '#10b981')}
                ${statCell('Dropped', '−' + (s.droppedCount || 0), '#ef4444')}
            </tr>
            </table>
        </td>
    </tr>
    </table>
</td></tr>

${ai.keyWins && ai.keyWins.length ? `
<!-- Key Wins -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;color:#10b981;">&#10003; Key Wins</h3>
    ${ai.keyWins.map(w => `<p style="margin:0 0 6px;font-size:13px;color:#334155;">&#8226; ${escHtml(w)}</p>`).join('')}
</td></tr>` : ''}

${ai.keyIssues && ai.keyIssues.length ? `
<!-- Key Issues -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;color:#ef4444;">&#9888; Issues to Address</h3>
    ${ai.keyIssues.map(i => `<p style="margin:0 0 6px;font-size:13px;color:#334155;">&#8226; ${escHtml(i)}</p>`).join('')}
</td></tr>` : ''}

<!-- Estimated Traffic -->
<tr><td style="padding:20px 28px 0;">
    <div style="background:#f8fafc;border-radius:8px;padding:16px;text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#6366f1;">${(s.estimatedMonthlyTraffic || 0).toLocaleString()}</div>
        <div style="font-size:12px;color:#64748b;">Estimated Monthly Organic Visits</div>
    </div>
</td></tr>

${s.pageSpeedScore != null ? `
<!-- PageSpeed -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;">PageSpeed &amp; Core Web Vitals</h3>
    <table width="100%" cellpadding="6" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:13px;">
    <tr style="background:#f8fafc;">
        <td style="font-weight:600;">Performance</td><td style="color:${scoreColor(s.pageSpeedScore)};font-weight:700;">${s.pageSpeedScore}/100</td>
        <td style="font-weight:600;">Technical</td><td style="color:${scoreColor(s.technicalScore)};font-weight:700;">${s.technicalScore || '—'}/100</td>
    </tr>
    </table>
</td></tr>` : ''}

${data.biggestGains && data.biggestGains.length ? `
<!-- Keyword Gains -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;color:#10b981;">Biggest Keyword Gains</h3>
    <table width="100%" cellpadding="6" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
    <tr style="background:#f8fafc;"><th style="text-align:left;">Keyword</th><th>From</th><th>To</th><th>Change</th></tr>
    ${data.biggestGains.slice(0, 8).map(g => `
    <tr>
        <td style="border-top:1px solid #f1f5f9;">${escHtml(g.keyword)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;">${positionBadge(g.from)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;">${positionBadge(g.to)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;color:#10b981;font-weight:600;">+${g.change}</td>
    </tr>`).join('')}
    </table>
</td></tr>` : ''}

${data.biggestDrops && data.biggestDrops.length ? `
<!-- Keyword Drops -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;color:#ef4444;">Notable Drops</h3>
    <table width="100%" cellpadding="6" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
    <tr style="background:#f8fafc;"><th style="text-align:left;">Keyword</th><th>From</th><th>To</th><th>Change</th></tr>
    ${data.biggestDrops.slice(0, 8).map(d => `
    <tr>
        <td style="border-top:1px solid #f1f5f9;">${escHtml(d.keyword)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;">${positionBadge(d.from)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;">${positionBadge(d.to)}</td>
        <td style="border-top:1px solid #f1f5f9;text-align:center;color:#ef4444;font-weight:600;">${d.change}</td>
    </tr>`).join('')}
    </table>
</td></tr>` : ''}

${ai.contentRecommendations && ai.contentRecommendations.length ? `
<!-- Content Recommendations -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;">Content Recommendations</h3>
    ${ai.contentRecommendations.slice(0, 4).map(c => `
    <div style="background:#f8fafc;border-radius:8px;padding:12px;margin-bottom:8px;">
        <div style="font-weight:600;font-size:13px;">${escHtml(c.title)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px;">${escHtml(c.rationale)}</div>
    </div>`).join('')}
</td></tr>` : ''}

${ai.technicalFixes && ai.technicalFixes.length ? `
<!-- Technical Fixes -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;">Technical Fixes</h3>
    ${ai.technicalFixes.map((f, i) => `<p style="margin:0 0 6px;font-size:13px;color:#334155;">${i + 1}. ${escHtml(f)}</p>`).join('')}
</td></tr>` : ''}

${ai.nextMonthPlan && ai.nextMonthPlan.length ? `
<!-- Next Month Plan -->
<tr><td style="padding:20px 28px 0;">
    <h3 style="margin:0 0 10px;font-size:15px;">Next Month Action Plan</h3>
    <table width="100%" cellpadding="8" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
    <tr style="background:#f8fafc;"><th style="text-align:left;">Week</th><th>Action</th></tr>
    ${ai.nextMonthPlan.map(p => `
    <tr>
        <td style="border-top:1px solid #f1f5f9;font-weight:600;">Week ${p.week}</td>
        <td style="border-top:1px solid #f1f5f9;">${escHtml(p.action)}</td>
    </tr>`).join('')}
    </table>
</td></tr>` : ''}

<!-- CTA -->
<tr><td style="padding:24px 28px;text-align:center;">
    <a href="${baseUrl}" style="display:inline-block;background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">View Full Dashboard</a>
</td></tr>

<!-- Footer -->
<tr><td style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
        Generated ${escHtml(meta.generatedAt || new Date().toISOString())} &middot; Keyword Analyzer
    </p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function statCell(label, value, color) {
    return `<td style="padding:6px 8px;text-align:center;">
        <div style="font-size:18px;font-weight:700;color:${color || '#1e293b'};">${escHtml(String(value))}</div>
        <div style="font-size:10px;color:#64748b;">${escHtml(label)}</div>
    </td>`;
}

module.exports = { renderEmailReport };
