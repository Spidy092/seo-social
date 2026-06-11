/**
 * Agency Report Service
 * Aggregates SEO data from all modules into comprehensive client-ready reports.
 */

const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { safeRunPageSpeed } = require('./pageSpeedService');
const { buildSummary: buildGscSummary } = require('./gscService');
const seoPerformanceService = require('./seoPerformanceService');
const { createLogger } = require('../utils/logger');

const log = createLogger('report-service');

function normalizeDomain(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return new URL(raw.startsWith('http') ? raw : `https://${raw}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch (_) {
        return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase();
    }
}

function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function toJsonArray(value) {
    return Array.isArray(value) ? value : [];
}

function buildPageSpeedFallback(technicalAudits) {
    const latest = technicalAudits?.[0];
    if (!latest) return null;
    const pages = toJsonArray(latest.pages);
    const loadTimes = pages.map(page => Number(page.loadMs)).filter(ms => ms > 0);
    if (!loadTimes.length) return null;
    const avgLoadMs = Math.round(loadTimes.reduce((sum, ms) => sum + ms, 0) / loadTimes.length);
    const slowPages = pages
        .filter(page => Number(page.loadMs) > 1500)
        .sort((a, b) => Number(b.loadMs) - Number(a.loadMs))
        .slice(0, 5)
        .map(page => ({ url: page.url, loadMs: Number(page.loadMs) }));

    return {
        source: 'technical-crawl',
        url: latest.site_url,
        fetchedAt: latest.audit_date || latest.created_at,
        scores: {
            performance: Math.max(0, Math.min(100, Math.round(100 - avgLoadMs / 50))),
            accessibility: null,
            bestPractices: null,
            seo: Number(latest.overall_score) || null,
        },
        metrics: {
            avgLoad: { title: 'Average crawled page load', displayValue: `${avgLoadMs} ms`, numericValue: avgLoadMs, score: null },
        },
        opportunities: slowPages.map(page => ({
            title: `Speed up ${page.url.replace(/^https?:\/\//, '')}`,
            displayValue: `${page.loadMs} ms crawl response`,
            savingsMs: Math.max(0, page.loadMs - 1000),
        })),
    };
}

async function gatherReportData(db, { clientId, domain, periodDays = 30, includePageSpeed = true }) {
    const safePeriodDays = Math.max(1, Math.min(365, parseInt(periodDays, 10) || 30));
    const since = `NOW() - INTERVAL '${safePeriodDays} days'`;
    const clientResult = clientId
        ? await db.query('SELECT * FROM seo_clients WHERE id = $1', [clientId])
        : { rows: [{ name: normalizeDomain(domain) || domain || 'Your Website', website_url: domain }] };
    const client = clientResult.rows[0] || {};
    const reportDomain = normalizeDomain(domain || client.website_url);
    const reportUrl = normalizeUrl(client.website_url || domain || reportDomain);
    const domainPattern = `%${reportDomain}%`;
    const hasClient = !!clientId;

    const projectKeywordJoin = hasClient
        ? `JOIN seo_project_keywords pk ON pk.keyword_id = k.id
           JOIN seo_projects p ON p.id = pk.project_id AND p.client_id = $1`
        : '';
    const clientParam = hasClient ? [clientId] : [];
    const domainParam = hasClient ? [clientId, reportDomain] : [reportDomain];
    const siteParam = [domainPattern];
    const scopedPlaceholder = hasClient ? 2 : 1;
    const sitePlaceholder = 1;

    const [projectsResult, keywordsResult, rankingsResult, rankHistoryResult, alertsResult, competitorsResult, technicalResult, pageOptimizationResult, contentBriefResult, pageSpeedCheckResult, gscResult] = await Promise.all([
        hasClient
            ? db.query(
                `SELECT p.id, p.name, p.project_type, p.target_location, p.goals, p.status,
                        COUNT(pk.keyword_id) AS keyword_count
                 FROM seo_projects p
                 LEFT JOIN seo_project_keywords pk ON pk.project_id = p.id
                 WHERE p.client_id = $1
                 GROUP BY p.id
                 ORDER BY p.updated_at DESC`,
                [clientId]
            )
            : Promise.resolve({ rows: [] }),
        db.query(
            `SELECT DISTINCT k.id, k.keyword, k.search_volume, k.competition, k.difficulty, k.location
             FROM keywords k
             ${projectKeywordJoin}
             ORDER BY k.search_volume DESC NULLS LAST
             LIMIT 150`,
            clientParam
        ),
        reportDomain
            ? db.query(
                `SELECT DISTINCT ON (LOWER(TRIM(k.keyword))) dr.domain, dr.rank_position, dr.checked_at, dr.url, k.keyword, k.search_volume
                 FROM domain_rankings dr
                 JOIN keywords k ON dr.keyword_id = k.id
                 ${projectKeywordJoin}
                 WHERE LOWER(REPLACE(dr.domain, 'www.', '')) = $${scopedPlaceholder}
                 ORDER BY LOWER(TRIM(k.keyword)), dr.rank_position ASC, dr.checked_at DESC`,
                domainParam
            )
            : Promise.resolve({ rows: [] }),
        reportDomain
            ? db.query(
                `SELECT rh.keyword_id, rh.previous_rank AS old_rank, rh.rank_position AS new_rank,
                        (rh.previous_rank - rh.rank_position) AS rank_change, rh.change_direction,
                        rh.checked_at, k.keyword, k.search_volume
                 FROM rank_history rh
                 JOIN keywords k ON rh.keyword_id = k.id
                 ${projectKeywordJoin}
                 WHERE LOWER(REPLACE(rh.domain, 'www.', '')) = $${scopedPlaceholder}
                   AND rh.checked_at > ${since}
                   AND rh.previous_rank IS NOT NULL
                   AND rh.previous_rank > 0
                 ORDER BY ABS(rh.previous_rank - rh.rank_position) DESC`,
                domainParam
            )
            : Promise.resolve({ rows: [] }),
        reportDomain
            ? db.query(
                `SELECT a.*, k.keyword
                 FROM alerts a
                 JOIN keywords k ON a.keyword_id = k.id
                 ${projectKeywordJoin}
                 WHERE LOWER(REPLACE(a.domain, 'www.', '')) = $${scopedPlaceholder}
                   AND a.created_at > ${since}
                 ORDER BY a.created_at DESC
                 LIMIT 50`,
                domainParam
            )
            : Promise.resolve({ rows: [] }),
        db.query(
            `SELECT c.domain, COUNT(DISTINCT c.keyword_id) as keyword_count,
                    ROUND(AVG(c.rank_position), 1) as avg_position,
                    MIN(c.rank_position) as best_position
             FROM competitors c
             JOIN keywords k ON k.id = c.keyword_id
             ${projectKeywordJoin}
             GROUP BY c.domain
             ORDER BY keyword_count DESC
             LIMIT 10`,
            clientParam
        ),
        reportDomain
            ? db.query(
                `SELECT ta.*, ta.created_at as audit_date
                 FROM technical_audits ta
                 WHERE ta.site_url ILIKE $${sitePlaceholder}
                 ORDER BY ta.created_at DESC
                 LIMIT 5`,
                siteParam
            ).catch(() => ({ rows: [] }))
            : Promise.resolve({ rows: [] }),
        reportDomain
            ? db.query(
                `SELECT po.url, po.keyword, po.location, po.my_score, po.avg_competitor_score,
                        po.gaps, po.summary, po.created_at
                 FROM page_optimizations po
                 WHERE po.created_at > ${since}
                   AND po.url ILIKE $${sitePlaceholder}
                 ORDER BY po.created_at DESC
                 LIMIT 10`,
                siteParam
            ).catch(() => ({ rows: [] }))
            : Promise.resolve({ rows: [] }),
        hasClient
            ? db.query(
                `SELECT cb.keyword, cb.location, cb.source_metrics, cb.created_at, p.name AS project_name
                 FROM content_briefs cb
                 LEFT JOIN seo_projects p ON p.id = cb.project_id
                 WHERE p.client_id = $1 AND cb.created_at > ${since}
                 ORDER BY cb.created_at DESC
                 LIMIT 10`,
                [clientId]
            ).catch(() => ({ rows: [] }))
            : Promise.resolve({ rows: [] }),
        reportDomain
            ? db.query(
                hasClient
                    ? `SELECT result, created_at
                       FROM page_speed_checks
                       WHERE client_id = $1
                       ORDER BY created_at DESC
                       LIMIT 1`
                    : `SELECT result, created_at
                       FROM page_speed_checks
                       WHERE url ILIKE $1 OR final_url ILIKE $1
                       ORDER BY created_at DESC
                       LIMIT 1`,
                hasClient ? [clientId] : [domainPattern]
            ).catch(() => ({ rows: [] }))
            : Promise.resolve({ rows: [] }),
        hasClient
            ? db.query(
                `SELECT *
                 FROM gsc_search_analytics
                 WHERE client_id = $1
                   AND date_start = (SELECT MAX(date_start) FROM gsc_search_analytics WHERE client_id = $1)
                 ORDER BY impressions DESC
                 LIMIT 1200`,
                [clientId]
            ).catch(() => ({ rows: [] }))
            : Promise.resolve({ rows: [] }),
    ]);

    const savedPageSpeed = pageSpeedCheckResult.rows[0]?.result || null;
    if (savedPageSpeed && pageSpeedCheckResult.rows[0]?.created_at) {
        savedPageSpeed.savedAt = pageSpeedCheckResult.rows[0].created_at;
    }
    const pageSpeed = includePageSpeed
        ? savedPageSpeed || (await safeRunPageSpeed(reportUrl)) || buildPageSpeedFallback(technicalResult.rows)
        : savedPageSpeed || buildPageSpeedFallback(technicalResult.rows);
    const gscRows = gscResult.rows.map(row => ({
        dimensionType: row.dimension_type,
        query: row.query,
        page: row.page,
        device: row.device,
        country: row.country,
        clicks: parseInt(row.clicks, 10) || 0,
        impressions: parseInt(row.impressions, 10) || 0,
        ctr: parseFloat(row.ctr) || 0,
        position: parseFloat(row.position) || 0,
    }));
    const gsc = gscRows.length ? buildGscSummary(gscRows) : null;
    let seoPerformance = null;
    if (hasClient) {
        try {
            seoPerformance = {
                overview: await seoPerformanceService.getOverview(db, clientId),
                opportunities: await seoPerformanceService.getOpportunities(db, clientId, { limit: 20 }),
                keywordPages: await seoPerformanceService.getKeywordPagePerformance(db, clientId, { limit: 30 }),
            };
        } catch (err) {
            log.warn({ err: err.message, clientId }, 'combined SEO performance report data unavailable');
        }
    }

    return { client, projects: projectsResult.rows, keywords: keywordsResult.rows, rankings: rankingsResult.rows, rankHistory: rankHistoryResult.rows, alerts: alertsResult.rows, competitors: competitorsResult.rows, technicalAudits: technicalResult.rows, contentHistory: [], pageOptimizations: pageOptimizationResult.rows, contentBriefs: contentBriefResult.rows, pageSpeed, gsc, seoPerformance, reportDomain };
}

function computeSummary(data, periodDays) {
    const { keywords, rankings, rankHistory, alerts, projects, technicalAudits, pageOptimizations, contentBriefs, pageSpeed, gsc, seoPerformance } = data;
    const improved = rankHistory.filter(r => r.change_direction === 'up');
    const dropped = rankHistory.filter(r => r.change_direction === 'down');
    const newRankings = rankHistory.filter(r => r.change_direction === 'new');
    const lostRankings = alerts.filter(a => a.alert_type === 'lost_ranking');
    const top10 = rankings.filter(r => r.rank_position <= 10).length;
    const top3 = rankings.filter(r => r.rank_position <= 3).length;
    const top30 = rankings.filter(r => r.rank_position <= 30).length;
    const biggestGains = [...improved].sort((a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change)).slice(0, 5);
    const biggestDrops = [...dropped].sort((a, b) => Math.abs(b.rank_change) - Math.abs(a.rank_change)).slice(0, 5);
    const avgPosition = rankings.length ? Math.round(rankings.reduce((s, r) => s + Number(r.rank_position), 0) / rankings.length) : null;
    const CTR_BY_POS = [0.28, 0.15, 0.11, 0.08, 0.07, 0.06, 0.05, 0.04, 0.04, 0.03];
    const estimatedTraffic = rankings.reduce((total, r) => {
        const pos = Math.min(Number(r.rank_position), 10) - 1;
        const ctr = CTR_BY_POS[pos] || 0.01;
        return total + Math.round((Number(r.search_volume) || 0) * ctr);
    }, 0);
    return { period: periodDays, totalKeywords: keywords.length, trackedKeywords: rankings.length, projectCount: projects.length, projectKeywords: keywords.length, top3, top10, top30, avgPosition, estimatedMonthlyTraffic: estimatedTraffic, improved: improved.length, dropped: dropped.length, newRankings: newRankings.length, lostRankings: lostRankings.length, biggestGains, biggestDrops, totalAlerts: alerts.length, latestTechnicalScore: technicalAudits[0]?.overall_score ?? null, technicalIssueCount: toJsonArray(technicalAudits[0]?.issues).length, pageSpeedScore: pageSpeed?.scores?.performance ?? null, pageOptimizations: pageOptimizations.length, contentBriefs: contentBriefs.length, gscClicks: gsc?.clicks || 0, gscImpressions: gsc?.impressions || 0, gscCtr: gsc?.ctr || 0, gscPosition: gsc?.position || null, gscQuickWins: gsc?.quickWinKeywords?.length || 0, gscLowCtrPages: gsc?.lowCtrPages?.length || 0, organicSessions: seoPerformance?.overview?.sessions || 0, seoConversions: seoPerformance?.overview?.conversions || 0, seoHighPriorityIssues: seoPerformance?.overview?.highPriorityIssues || 0 };
}

async function generateAiNarrative(summary, data) {
    const { client, competitors } = data;
    const clientName = client?.name || 'Client';
    const prompt = `You are a senior SEO strategist writing a monthly report for ${clientName}.

Here is the performance data for the past ${summary.period} days:
- Projects included: ${summary.projectCount}
- Project keyword set: ${summary.projectKeywords}
- Keywords currently ranking: ${summary.trackedKeywords}
- Top 3 positions: ${summary.top3} keywords
- Top 10 positions: ${summary.top10} keywords
- Average ranking position: ${summary.avgPosition || 'N/A'}
- Estimated monthly traffic from rankings: ${summary.estimatedMonthlyTraffic.toLocaleString()} visits
- Keywords improved: ${summary.improved}
- Keywords dropped: ${summary.dropped}
- New rankings gained: ${summary.newRankings}
- Latest technical SEO score: ${summary.latestTechnicalScore || 'N/A'}
- Technical issues found: ${summary.technicalIssueCount}
- Mobile PageSpeed performance score: ${summary.pageSpeedScore || 'N/A'}
- Recent page optimization reports: ${summary.pageOptimizations}
- Recent content briefs: ${summary.contentBriefs}
- GSC clicks: ${summary.gscClicks}
- GSC impressions: ${summary.gscImpressions}
- GSC CTR: ${summary.gscCtr ? (summary.gscCtr * 100).toFixed(1) + '%' : 'N/A'}
- GSC average position: ${summary.gscPosition ? summary.gscPosition.toFixed(1) : 'N/A'}
- GSC quick-win keywords: ${summary.gscQuickWins}
- Low CTR pages: ${summary.gscLowCtrPages}

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
        const response = await resilientLlmRequest({ prompt, expectJson: true, timeoutMs: 45000 });
        return extractJson(response);
    } catch (err) {
        log.warn({ err: err.message }, 'AI narrative generation failed, using fallback');
        return {
            executiveSummary: `${clientName} has ${summary.projectKeywords} project keywords with ${summary.top10} ranking in the top 10. The report also includes technical health, PageSpeed, page optimization, competitor, and content planning signals for the selected client.`,
            keyWins: [`${summary.top10} keywords ranking in top 10 positions`, `${summary.improved} keyword position improvements this period`, `${summary.pageOptimizations} page optimization reports reviewed`],
            keyIssues: [`${summary.dropped} keywords experienced ranking drops`, summary.pageSpeedScore ? `Mobile PageSpeed performance is ${summary.pageSpeedScore}/100` : 'Run PageSpeed Insights for Core Web Vitals visibility', 'Continue monitoring and addressing technical SEO issues'],
            contentRecommendations: [
                { title: 'Target high-volume informational keywords', rationale: 'Capture top-of-funnel traffic', type: 'blog' },
                { title: 'Service page optimization', rationale: 'Strengthen commercial intent pages', type: 'service-page' },
                { title: 'Local SEO content', rationale: 'Target location-specific searches', type: 'landing-page' },
            ],
            technicalFixes: ['Audit PageSpeed and Core Web Vitals', 'Check for crawl errors and fix broken links', 'Optimize meta titles and descriptions for CTR'],
            competitorInsights: 'Monitor top competitors and look for keyword gaps to exploit.',
            nextMonthPlan: [
                { week: 1, action: 'Technical audit and PageSpeed quick wins implementation' },
                { week: 2, action: 'Content creation for top keyword opportunities' },
                { week: 3, action: 'On-page optimization for target pages' },
                { week: 4, action: 'Link building and competitor gap analysis' },
            ],
            overallHealthScore: Math.min(100, Math.round(40 + summary.top10 * 2 + summary.improved + (summary.pageSpeedScore || 0) / 10)),
        };
    }
}

async function buildReport(db, options) {
    const { clientId, domain, periodDays = 30, reportTitle, includePageSpeed = true } = options;
    log.info({ clientId, domain, periodDays, includePageSpeed }, 'Building SEO report');
    const data = await gatherReportData(db, { clientId, domain, periodDays, includePageSpeed });
    const summary = computeSummary(data, periodDays);
    const aiNarrative = await generateAiNarrative(summary, data);
    const reportDate = new Date();
    const periodStart = new Date(reportDate - periodDays * 24 * 60 * 60 * 1000);
    return {
        meta: { title: reportTitle || `SEO Report - ${data.client?.name || data.reportDomain || 'Website'}`, clientName: data.client?.name || data.reportDomain || 'Website', domain: data.reportDomain || normalizeDomain(domain || data.client?.website_url) || '', generatedAt: reportDate.toISOString(), periodStart: periodStart.toISOString(), periodEnd: reportDate.toISOString(), periodDays },
        summary,
        aiNarrative,
        data: { rankings: data.rankings.slice(0, 50), biggestGains: summary.biggestGains, biggestDrops: summary.biggestDrops, competitors: data.competitors, recentAlerts: data.alerts.slice(0, 20), technicalAudits: data.technicalAudits.slice(0, 3), pageSpeed: data.pageSpeed, gsc: data.gsc, projects: data.projects, projectKeywords: data.keywords.slice(0, 50), pageOptimizations: data.pageOptimizations, contentBriefs: data.contentBriefs, seoPerformance: data.seoPerformance },
    };
}

module.exports = { buildReport };
