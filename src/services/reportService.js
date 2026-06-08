/**
 * 📊 Agency Report Service
 * Aggregates SEO data from all modules into comprehensive client-ready reports.
 */

const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('report-service');

/**
 * Gather all raw data for the report period.
 */
async function gatherReportData(db, { clientId, domain, periodDays = 30 }) {
    const since = `NOW() - INTERVAL '${parseInt(periodDays)} days'`;

    const [
        clientResult,
        keywordsResult,
        rankingsResult,
        rankHistoryResult,
        alertsResult,
        competitorsResult,
        technicalResult,
        contentResult,
    ] = await Promise.all([
        // Client info
        clientId
            ? db.query('SELECT * FROM seo_clients WHERE id = $1', [clientId])
            : Promise.resolve({ rows: [{ name: domain || 'Your Website', website_url: domain }] }),

        // All tracked keywords with volume
        db.query(
            `SELECT k.id, k.keyword, k.search_volume, k.competition, k.difficulty, k.location
             FROM keywords k
             ORDER BY k.search_volume DESC NULLS LAST
             LIMIT 100`
        ),

        // Current rankings for the domain
        domain
            ? db.query(
                `SELECT DISTINCT ON (LOWER(TRIM(k.keyword)))
                    dr.domain, dr.rank_position, dr.checked_at, dr.url,
                    k.keyword, k.search_volume
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 WHERE dr.domain = $1
                 ORDER BY LOWER(TRIM(k.keyword)), dr.rank_position ASC, dr.checked_at DESC`,
                [domain]
            )
            : Promise.resolve({ rows: [] }),

        // Rank movement history — columns: rank_position (new), previous_rank (old)
        domain
            ? db.query(
                `SELECT rh.keyword_id,
                        rh.previous_rank                          AS old_rank,
                        rh.rank_position                          AS new_rank,
                        (rh.previous_rank - rh.rank_position)     AS rank_change,
                        rh.change_direction, rh.checked_at,
                        k.keyword, k.search_volume
                 FROM rank_history rh
                 JOIN keywords k ON rh.keyword_id = k.id
                 WHERE rh.domain = $1
                   AND rh.checked_at > ${since}
                   AND rh.previous_rank IS NOT NULL
                   AND rh.previous_rank > 0
                 ORDER BY ABS(rh.previous_rank - rh.rank_position) DESC`,
                [domain]
            )
            : Promise.resolve({ rows: [] }),

        // Alerts triggered
        domain
            ? db.query(
                `SELECT a.*, k.keyword
                 FROM alerts a
                 JOIN keywords k ON a.keyword_id = k.id
                 WHERE a.domain = $1 AND a.created_at > ${since}
                 ORDER BY a.created_at DESC
                 LIMIT 50`,
                [domain]
            )
            : Promise.resolve({ rows: [] }),

        // Top competitors discovered
        db.query(
            `SELECT c.domain, COUNT(DISTINCT c.keyword_id) as keyword_count,
                    ROUND(AVG(c.rank_position), 1) as avg_position,
                    MIN(c.rank_position) as best_position
             FROM competitors c
             GROUP BY c.domain
             ORDER BY keyword_count DESC
             LIMIT 10`
        ),

        // Latest technical audits
        db.query(
            `SELECT ta.*, ta.created_at as audit_date
             FROM technical_audits ta
             ORDER BY ta.created_at DESC
             LIMIT 5`
        ).catch(() => ({ rows: [] })),

        // Content humanizer history
        db.query(
            `SELECT ch.created_at, ch.word_count, ch.ai_score_before, ch.ai_score_after
             FROM content_history ch
             WHERE ch.created_at > ${since}
             ORDER BY ch.created_at DESC
             LIMIT 20`
        ).catch(() => ({ rows: [] })),
    ]);

    return {
        client: clientResult.rows[0] || {},
        keywords: keywordsResult.rows,
        rankings: rankingsResult.rows,
        rankHistory: rankHistoryResult.rows,
        alerts: alertsResult.rows,
        competitors: competitorsResult.rows,
        technicalAudits: technicalResult.rows,
        contentHistory: contentResult.rows,
    };
}

/**
 * Compute summary statistics from raw data.
 */
function computeSummary(data, periodDays) {
    const { keywords, rankings, rankHistory, alerts } = data;

    // Keyword movement stats
    const improved = rankHistory.filter(r => r.change_direction === 'up');
    const dropped = rankHistory.filter(r => r.change_direction === 'down');
    const newRankings = rankHistory.filter(r => r.change_direction === 'new');
    const lostRankings = alerts.filter(a => a.alert_type === 'lost_ranking');

    // Top 10 rankings
    const top10 = rankings.filter(r => r.rank_position <= 10).length;
    const top3 = rankings.filter(r => r.rank_position <= 3).length;
    const top30 = rankings.filter(r => r.rank_position <= 30).length;

    // Best movers
    const biggestGains = [...improved]
        .sort((a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change))
        .slice(0, 5);
    const biggestDrops = [...dropped]
        .sort((a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change))
        .slice(0, 5);

    // Avg position
    const avgPosition = rankings.length
        ? Math.round(rankings.reduce((s, r) => s + Number(r.rank_position), 0) / rankings.length)
        : null;

    // Potential traffic estimate (rough: vol * CTR by position)
    const CTR_BY_POS = [0.28, 0.15, 0.11, 0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03];
    const estimatedTraffic = rankings.reduce((total, r) => {
        const pos = Math.min(Number(r.rank_position), 10) - 1;
        const ctr = CTR_BY_POS[pos] || 0.01;
        return total + Math.round((Number(r.search_volume) || 0) * ctr);
    }, 0);

    return {
        period: periodDays,
        totalKeywords: keywords.length,
        trackedKeywords: rankings.length,
        top3,
        top10,
        top30,
        avgPosition,
        estimatedMonthlyTraffic: estimatedTraffic,
        improved: improved.length,
        dropped: dropped.length,
        newRankings: newRankings.length,
        lostRankings: lostRankings.length,
        biggestGains,
        biggestDrops,
        totalAlerts: alerts.length,
    };
}

/**
 * Use AI to generate the strategic narrative sections of the report.
 */
async function generateAiNarrative(summary, data) {
    const { client, competitors } = data;
    const clientName = client?.name || 'Client';

    const prompt = `You are a senior SEO strategist writing a monthly report for ${clientName}.

Here is the performance data for the past ${summary.period} days:
- Total tracked keywords: ${summary.trackedKeywords}
- Top 3 positions: ${summary.top3} keywords
- Top 10 positions: ${summary.top10} keywords  
- Average ranking position: ${summary.avgPosition || 'N/A'}
- Estimated monthly traffic from rankings: ${summary.estimatedMonthlyTraffic.toLocaleString()} visits
- Keywords improved: ${summary.improved}
- Keywords dropped: ${summary.dropped}
- New rankings gained: ${summary.newRankings}

Top competitors in their space:
${competitors.slice(0, 5).map(c => `- ${c.domain}: appears in ${c.keyword_count} keywords, avg position ${c.avg_position}`).join('\n')}

Biggest keyword gains this period:
${summary.biggestGains.map(k => `- "${k.keyword}": moved from #${k.old_rank} to #${k.new_rank} (+${Math.abs(k.rank_change)} positions)`).join('\n') || 'None recorded yet'}

Keywords that dropped:
${summary.biggestDrops.map(k => `- "${k.keyword}": fell from #${k.old_rank} to #${k.new_rank} (-${Math.abs(k.rank_change)} positions)`).join('\n') || 'None'}

Write a professional SEO report with these sections. Be specific, data-driven, and actionable. Use plain language suitable for business owners.

Respond ONLY with a JSON object in this exact structure:
{
  "executiveSummary": "2-3 sentence overview of overall performance and trend",
  "keyWins": ["win 1", "win 2", "win 3"],
  "keyIssues": ["issue 1", "issue 2"],
  "contentRecommendations": [
    {"title": "topic/page title", "rationale": "why this will work", "type": "blog|service-page|landing-page"},
    {"title": "...", "rationale": "...", "type": "..."},
    {"title": "...", "rationale": "...", "type": "..."}
  ],
  "technicalFixes": ["fix 1 with specific action", "fix 2", "fix 3"],
  "competitorInsights": "1-2 sentences on competitor landscape",
  "nextMonthPlan": [
    {"week": 1, "action": "specific action"},
    {"week": 2, "action": "specific action"},
    {"week": 3, "action": "specific action"},
    {"week": 4, "action": "specific action"}
  ],
  "overallHealthScore": 75
}`;

    try {
        const response = await resilientLlmRequest({
            prompt,
            expectJson: true,
            timeoutMs: 45000,
        });
        return extractJson(response);
    } catch (err) {
        log.warn({ err: err.message }, 'AI narrative generation failed, using fallback');
        return {
            executiveSummary: `${clientName} has ${summary.trackedKeywords} keywords tracked with ${summary.top10} ranking in the top 10. The site gained ${summary.improved} keyword improvements over the past ${summary.period} days.`,
            keyWins: [
                `${summary.top10} keywords ranking in top 10 positions`,
                `${summary.improved} keyword position improvements this period`,
                `${summary.newRankings} new keyword rankings gained`,
            ],
            keyIssues: [
                `${summary.dropped} keywords experienced ranking drops`,
                'Continue monitoring and addressing technical SEO issues',
            ],
            contentRecommendations: [
                { title: 'Target high-volume informational keywords', rationale: 'Capture top-of-funnel traffic', type: 'blog' },
                { title: 'Service page optimization', rationale: 'Strengthen commercial intent pages', type: 'service-page' },
                { title: 'Local SEO content', rationale: 'Target location-specific searches', type: 'landing-page' },
            ],
            technicalFixes: [
                'Audit page speed and Core Web Vitals',
                'Check for crawl errors and fix broken links',
                'Optimize meta titles and descriptions for CTR',
            ],
            competitorInsights: 'Monitor top competitors and look for keyword gaps to exploit.',
            nextMonthPlan: [
                { week: 1, action: 'Technical audit and quick wins implementation' },
                { week: 2, action: 'Content creation for top keyword opportunities' },
                { week: 3, action: 'On-page optimization for target pages' },
                { week: 4, action: 'Link building and competitor gap analysis' },
            ],
            overallHealthScore: Math.min(100, Math.round(40 + summary.top10 * 2 + summary.improved)),
        };
    }
}

/**
 * Build the complete report object.
 */
async function buildReport(db, options) {
    const { clientId, domain, periodDays = 30, reportTitle } = options;

    log.info({ clientId, domain, periodDays }, 'Building SEO report');

    const data = await gatherReportData(db, { clientId, domain, periodDays });
    const summary = computeSummary(data, periodDays);
    const aiNarrative = await generateAiNarrative(summary, data);

    const reportDate = new Date();
    const periodStart = new Date(reportDate - periodDays * 24 * 60 * 60 * 1000);

    return {
        meta: {
            title: reportTitle || `SEO Report — ${data.client?.name || domain || 'Website'}`,
            clientName: data.client?.name || domain || 'Website',
            domain: domain || data.client?.website_url || '',
            generatedAt: reportDate.toISOString(),
            periodStart: periodStart.toISOString(),
            periodEnd: reportDate.toISOString(),
            periodDays,
        },
        summary,
        aiNarrative,
        data: {
            rankings: data.rankings.slice(0, 50),
            biggestGains: summary.biggestGains,
            biggestDrops: summary.biggestDrops,
            competitors: data.competitors,
            recentAlerts: data.alerts.slice(0, 20),
            technicalAudits: data.technicalAudits.slice(0, 3),
        },
    };
}

module.exports = { buildReport };
