const axios = require('axios');
const { createLogger } = require('../utils/logger');
const { assertSafeHttpUrl } = require('../utils/urlSecurity');

const log = createLogger('services:page-speed');
const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const DEFAULT_CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const METRIC_AUDITS = {
    fcp: 'first-contentful-paint',
    lcp: 'largest-contentful-paint',
    cls: 'cumulative-layout-shift',
    inp: 'interaction-to-next-paint',
    speedIndex: 'speed-index',
    tbt: 'total-blocking-time',
};

function normalizeUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
}

function scoreCategory(categories, key) {
    const value = categories?.[key]?.score;
    return typeof value === 'number' ? Math.round(value * 100) : null;
}

function normalizeAudit(audits, key) {
    const audit = audits?.[key] || {};
    return {
        id: key,
        title: audit.title || key,
        description: audit.description || '',
        displayValue: audit.displayValue || '',
        numericValue: audit.numericValue ?? null,
        numericUnit: audit.numericUnit || '',
        score: typeof audit.score === 'number' ? Math.round(audit.score * 100) : null,
    };
}

function buildSuggestions(result) {
    const suggestions = [];
    const scores = result.scores || {};
    const metrics = result.metrics || {};

    if (scores.performance !== null && scores.performance < 70) {
        suggestions.push('Prioritize performance work before cosmetic SEO changes: reduce JavaScript, optimize images, and remove render-blocking resources.');
    }
    if (Number(metrics.lcp?.numericValue || 0) > 2500) {
        suggestions.push('Improve LCP by optimizing the hero image, using preload for critical assets, and reducing server response time.');
    }
    if (Number(metrics.cls?.numericValue || 0) > 0.1) {
        suggestions.push('Fix CLS by reserving image/ad/embed dimensions and avoiding late-loading banners above existing content.');
    }
    if (Number(metrics.inp?.numericValue || 0) > 200) {
        suggestions.push('Improve INP by breaking long JavaScript tasks, deferring non-critical scripts, and reducing third-party script cost.');
    }
    if (scores.accessibility !== null && scores.accessibility < 90) {
        suggestions.push('Review accessibility issues because they often overlap with better UX and stronger conversion performance.');
    }
    if (scores.seo !== null && scores.seo < 90) {
        suggestions.push('Fix Lighthouse SEO basics such as crawlable links, meta tags, canonical signals, and mobile-friendly viewport rules.');
    }

    // CrUX field-data suggestions
    const crux = result.crux?.metrics || {};
    if (crux.lcp?.rating === 'poor') {
        suggestions.push(`Real-user LCP is ${crux.lcp.p75}ms (field data). Optimize server response, preload hero images, and reduce render-blocking resources.`);
    }
    if (crux.cls?.rating === 'poor') {
        suggestions.push(`Real-user CLS is ${crux.cls.p75} (field data). Reserve dimensions for images/ads and avoid injecting content above the fold.`);
    }
    if (crux.inp?.rating === 'poor') {
        suggestions.push(`Real-user INP is ${crux.inp.p75}ms (field data). Break up long JavaScript tasks and defer non-critical event handlers.`);
    }

    return suggestions.slice(0, 8);
}

function paramsSerializer(values) {
    const searchParams = new URLSearchParams();
    Object.entries(values).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach(item => searchParams.append(key, item));
        } else if (value !== undefined && value !== null) {
            searchParams.append(key, value);
        }
    });
    return searchParams.toString();
}

// ── CrUX Field Data ──────────────────────────────────────────────────────────
function parseCruxMetric(metricData) {
    if (!metricData?.histogram) return null;
    const p75 = metricData.percentiles?.p75 ?? null;
    const fractions = metricData.histogram.map(bucket => ({
        start: bucket.start,
        end: bucket.end,
        density: parseFloat((bucket.density * 100).toFixed(1)),
    }));
    return { p75, fractions };
}

function classifyCruxMetric(value, thresholds) {
    if (value === null || value === undefined) return 'unknown';
    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.needs_improvement) return 'needs_improvement';
    return 'poor';
}

async function fetchCruxData(url) {
    const apiKey = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_CSE_API_KEY;
    if (!apiKey) {
        return null;
    }

    try {
        const origin = new URL(normalizeUrl(url)).origin;
        const { data } = await axios.post(`${CRUX_ENDPOINT}?key=${apiKey}`, { origin }, { timeout: 10000 });

        const record = data?.record;
        if (!record?.metrics) {
            return null;
        }

        const m = record.metrics;
        const metrics = {};

        const cruxMap = {
            largest_contentful_paint: { key: 'lcp', unit: 'ms', thresholds: { good: 2500, needs_improvement: 4000 } },
            cumulative_layout_shift: { key: 'cls', unit: 'unitless', thresholds: { good: 0.1, needs_improvement: 0.25 } },
            interaction_to_next_paint: { key: 'inp', unit: 'ms', thresholds: { good: 200, needs_improvement: 500 } },
            first_contentful_paint: { key: 'fcp', unit: 'ms', thresholds: { good: 1800, needs_improvement: 3000 } },
            time_to_first_byte: { key: 'ttfb', unit: 'ms', thresholds: { good: 800, needs_improvement: 1800 } },
        };

        for (const [cruxKey, config] of Object.entries(cruxMap)) {
            const metricData = m[cruxKey];
            if (!metricData) continue;
            const parsed = parseCruxMetric(metricData);
            if (!parsed) continue;
            metrics[config.key] = {
                p75: parsed.p75,
                unit: config.unit,
                rating: classifyCruxMetric(parsed.p75, config.thresholds),
                fractions: parsed.fractions,
            };
        }

        return {
            source: 'chrome-ux-report',
            url: origin,
            recordPeriod: record.collectionPeriod ? `${record.collectionPeriod.firstDate} — ${record.collectionPeriod.lastDate}` : null,
            metrics,
        };
    } catch (err) {
        log.warn({ err: err.message, url }, 'CrUX data fetch failed');
        return null;
    }
}

async function runPageSpeed(url, options = {}) {
    const targetUrl = normalizeUrl(url);
    if (!targetUrl) {
        throw new Error('A valid URL is required');
    }
    await assertSafeHttpUrl(targetUrl);

    const strategy = options.strategy === 'desktop' ? 'desktop' : 'mobile';
    const categories = Array.isArray(options.categories) && options.categories.length
        ? options.categories
        : DEFAULT_CATEGORIES;
    const params = { url: targetUrl, strategy, category: categories };
    if (process.env.PAGESPEED_API_KEY) {
        params.key = process.env.PAGESPEED_API_KEY;
    }

    const { data } = await axios.get(PAGESPEED_ENDPOINT, {
        params,
        paramsSerializer,
        timeout: options.timeoutMs || 25000,
    });

    // Fetch CrUX field data in parallel
    const crux = await fetchCruxData(targetUrl);

    const lighthouse = data?.lighthouseResult || {};
    const categoriesData = lighthouse.categories || {};
    const audits = lighthouse.audits || {};
    const metrics = Object.fromEntries(
        Object.entries(METRIC_AUDITS).map(([name, auditId]) => [name, normalizeAudit(audits, auditId)])
    );

    const result = {
        source: 'google-pagespeed-insights',
        url: targetUrl,
        finalUrl: lighthouse.finalUrl || targetUrl,
        strategy,
        fetchedAt: new Date().toISOString(),
        crux,
        scores: {
            performance: scoreCategory(categoriesData, 'performance'),
            accessibility: scoreCategory(categoriesData, 'accessibility'),
            bestPractices: scoreCategory(categoriesData, 'best-practices'),
            seo: scoreCategory(categoriesData, 'seo'),
        },
        metrics,
        opportunities: Object.values(audits)
            .filter(audit => audit?.details?.type === 'opportunity' && Number(audit.numericValue) > 0)
            .sort((a, b) => Number(b.numericValue) - Number(a.numericValue))
            .slice(0, 8)
            .map(audit => ({
                id: audit.id,
                title: audit.title,
                description: audit.description || '',
                displayValue: audit.displayValue || '',
                savingsMs: Math.round(Number(audit.numericValue) || 0),
                score: typeof audit.score === 'number' ? Math.round(audit.score * 100) : null,
            })),
        diagnostics: Object.values(audits)
            .filter(audit => audit?.score !== null && audit?.score !== undefined && audit.score < 0.9 && audit.details?.type !== 'opportunity')
            .slice(0, 8)
            .map(audit => ({
                id: audit.id,
                title: audit.title,
                displayValue: audit.displayValue || '',
                score: Math.round(Number(audit.score) * 100),
            })),
    };
    result.suggestions = buildSuggestions(result);
    return result;
}

async function safeRunPageSpeed(url, options = {}) {
    try {
        return await runPageSpeed(url, options);
    } catch (err) {
        log.warn({ err: err.message, url }, 'PageSpeed check failed');
        return null;
    }
}

module.exports = {
    normalizeUrl,
    runPageSpeed,
    safeRunPageSpeed,
};
