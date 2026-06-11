/**
 * 📈 Existing Page Optimization Service
 *
 * Compares a single URL + target keyword against the top 10 SERP competitors
 * across 8 on-page categories:
 *   1. Missing headings
 *   2. Weak title / meta description
 *   3. Content depth gap
 *   4. Missing FAQs
 *   5. Missing schema
 *   6. Image alt issues
 *   7. Internal link opportunities
 *   8. Keyword / entity coverage
 */

const cheerio = require('cheerio');
const { createLogger } = require('../utils/logger');
const { analyzeOnPage } = require('./onpageService');
const keywordService = require('./keywordService');
const { extractDomain } = require('../utils/domainUtils');

const log = createLogger('page-optimization');

// Words to ignore when comparing entity / keyword coverage
const STOP_WORDS = new Set([
    'a','an','and','or','but','of','to','in','on','for','the','is','are','was','were','be','been',
    'being','have','has','had','do','does','did','will','would','should','could','can','may','might',
    'must','shall','i','you','he','she','it','we','they','them','this','that','these','those',
    'with','from','by','as','at','about','into','over','under','than','then','so','if','not',
    'your','our','my','me','us','his','her','its','their','what','which','who','whom','how',
    'why','when','where','here','there','all','any','some','no','yes','more','most','less',
    'least','very','just','also','only','own','same','such','s','t','d','ll','m','re','ve',
]);

function tokenize(text) {
    if (!text) return [];
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map(w => w.replace(/-+/g, '').trim())
        .filter(w => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
}

function uniq(arr) { return Array.from(new Set(arr)); }

function topEntities(text, max = 12) {
    const counts = new Map();
    tokenize(text).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, max)
        .map(([word, count]) => ({ word, count }));
}

function arrayAverage(values) {
    const valid = values.filter(v => typeof v === 'number' && !isNaN(v));
    if (!valid.length) return 0;
    return Math.round((valid.reduce((s, v) => s + v, 0) / valid.length) * 10) / 10;
}

function countFaqs($, bodyText) {
    if (!bodyText) return { count: 0, signals: [] };
    const signals = [];
    const h2s = $('h2, h3').map((_, el) => $(el).text().trim()).get();
    const faqHeaders = h2s.filter(h => /^(faq|frequently asked|common questions|q\s*&\s*a|questions)\??$/i.test(h)
        || /\?$/.test(h));
    if (faqHeaders.length) signals.push({ type: 'faq-heading', count: faqHeaders.length, samples: faqHeaders.slice(0, 3) });

    const faqSchema = $('script[type="application/ld+json"]').filter((_, el) => {
        try {
            const text = $(el).html() || '';
            return /"@type"\s*:\s*"FAQPage"/i.test(text);
        } catch { return false; }
    }).length;
    if (faqSchema) signals.push({ type: 'faq-schema', count: faqSchema });

    const questionCount = h2s.filter(h => /\?$/.test(h)).length;
    if (questionCount) signals.push({ type: 'question-headers', count: questionCount });

    return {
        count: faqHeaders.length || questionCount,
        signals,
        hasFaqSection: (faqHeaders.length > 0) || faqSchema > 0,
    };
}

function extractSchemaTypes($) {
    const types = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse($(el).html());
            const items = Array.isArray(parsed) ? parsed : [parsed];
            items.forEach(item => {
                const collect = (node) => {
                    if (!node || typeof node !== 'object') return;
                    if (Array.isArray(node['@type'])) node['@type'].forEach(t => types.push(t));
                    else if (typeof node['@type'] === 'string') types.push(node['@type']);
                    if (Array.isArray(node['@graph'])) node['@graph'].forEach(collect);
                };
                collect(item);
            });
        } catch { /* ignore parse errors */ }
    });
    return uniq(types);
}

function detectImageAltIssues($) {
    const images = $('img').map((_, el) => ({
        src: $(el).attr('src') || '',
        alt: $(el).attr('alt'),
    })).get();
    const total = images.length;
    const noAlt = images.filter(i => i.alt === undefined || i.alt === null || i.alt.trim() === '').length;
    const emptyAlt = images.filter(i => i.alt === '').length;
    const descriptiveAlt = total - noAlt;
    const altRatio = total > 0 ? Math.round((descriptiveAlt / total) * 100) : 100;
    return { total, noAlt, emptyAlt, descriptiveAlt, altRatio };
}

function collectHeadings($) {
    return {
        h1: $('h1').map((_, el) => $(el).text().trim()).get(),
        h2: $('h2').map((_, el) => $(el).text().trim()).get(),
        h3: $('h3').map((_, el) => $(el).text().trim()).get(),
        h4: $('h4').map((_, el) => $(el).text().trim()).get(),
    };
}

function bodyTextOnly($) {
    return $('body').clone().find('script,style,noscript').remove().end().text().replace(/\s+/g, ' ').trim();
}

function safePercent(num, den) {
    if (!den || den === 0) return 0;
    return Math.round((num / den) * 100);
}

function deriveHeadline(value, fallback) {
    if (!value) return fallback;
    const str = String(value).trim();
    if (str.length <= 90) return str;
    return str.slice(0, 87).trim() + '…';
}

// ──────────────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────────────
async function optimizePage({ url, keyword, location = 'India' }) {
    log.info({ url, keyword, location }, 'page optimization started');

    if (!url || !keyword) {
        throw new Error('Both URL and target keyword are required.');
    }

    let normalizedUrl = url.trim();
    if (!/^https?:\/\//i.test(normalizedUrl)) normalizedUrl = 'https://' + normalizedUrl;

    // ── Step 1: run the existing on-page analyzer on the user's URL ──────────
    const myOnPage = await analyzeOnPage(normalizedUrl, keyword, false);

    // ── Step 2: discover top competitors via SERP ────────────────────────────
    let serpResults = [];
    let serpError = null;
    try {
        serpResults = await keywordService.getSERPResults(keyword, location, 12);
    } catch (err) {
        serpError = err.message;
        log.warn({ err: err.message }, 'SERP fetch failed');
    }

    const myDomain = extractDomain(normalizedUrl);
    const uniqueCompetitors = [];
    const seenDomains = new Set([myDomain]);
    for (const entry of serpResults) {
        const domain = entry.domain;
        if (!domain || seenDomains.has(domain)) continue;
        if (!entry.url) continue;
        seenDomains.add(domain);
        uniqueCompetitors.push({ domain, url: entry.url, position: entry.position, title: entry.title, snippet: entry.description });
        if (uniqueCompetitors.length >= 10) break;
    }

    // ── Step 3: deep-crawl each competitor ───────────────────────────────────
    const competitorAnalyses = [];
    for (let i = 0; i < uniqueCompetitors.length; i++) {
        const comp = uniqueCompetitors[i];
        try {
            const page = await keywordService.analyzePageContent(comp.url, keyword);
            competitorAnalyses.push({
                domain: comp.domain,
                url: comp.url,
                position: comp.position,
                title: comp.title,
                snippet: comp.snippet,
                analysis: summarizeCompetitor(page, comp.domain),
                error: null,
            });
        } catch (err) {
            log.warn({ domain: comp.domain, err: err.message }, 'competitor crawl failed');
            competitorAnalyses.push({
                domain: comp.domain,
                url: comp.url,
                position: comp.position,
                title: comp.title,
                snippet: comp.snippet,
                analysis: null,
                error: err.message,
            });
        }
        if (i < uniqueCompetitors.length - 1) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }

    // ── Step 4: build the 8-category gap report ──────────────────────────────
    const successfulCompetitors = competitorAnalyses.filter(c => c.analysis);
    const report = buildGapReport({
        url: normalizedUrl,
        keyword,
        location,
        myOnPage,
        competitors: successfulCompetitors,
        myDomain,
    });

    return {
        url: normalizedUrl,
        keyword,
        location,
        myDomain,
        analyzedAt: new Date().toISOString(),
        serp: {
            total: serpResults.length,
            error: serpError,
            results: serpResults.slice(0, 10).map(r => ({
                position: r.position,
                domain: r.domain,
                url: r.url,
                title: r.title,
            })),
        },
        myAnalysis: myOnPage,
        competitors: competitorAnalyses,
        report,
    };
}

// ─── Lightweight competitor summary (we hit SERP URLs we have not pre-crawled) ───
function summarizeCompetitor(page, domain) {
    if (!page) return null;
    const $ = cheerio.load(''); // not used here — analyzer already pulled counts

    const wordCount = page.wordCount || 0;
    const exactMatches = page.keywordAnalysis?.exactMatches || 0;
    const density = page.keywordAnalysis?.density || 0;
    const seo = page.seoElements || {};

    return {
        domain,
        wordCount,
        exactMatches,
        density,
        h1: seo.h1Text || '',
        h1Present: !!seo.hasH1,
        h2Count: seo.headings?.h2 || 0,
        h3Count: seo.headings?.h3 || 0,
        hasMetaDescription: !!seo.hasMetaDescription,
        metaDescription: seo.metaDescription || '',
        hasSchema: !!seo.hasSchema,
        schemaTypes: seo.schemaDetails?.detectedTypes || [],
        schemaErrors: seo.schemaDetails?.errors || [],
        hasFaqSchema: (seo.schemaDetails?.detectedTypes || []).includes('FAQPage'),
        hasBreadcrumbSchema: (seo.schemaDetails?.detectedTypes || []).includes('BreadcrumbList'),
        pageType: seo.pageType?.primary || 'WebPage',
        internalLinks: seo.internalLinks || 0,
        externalLinks: seo.externalLinks || 0,
        images: seo.images || 0,
        imagesWithAlt: seo.imagesWithAlt || 0,
        altRatio: seo.images > 0 ? Math.round((seo.imagesWithAlt / seo.images) * 100) : 100,
    };
}

// ─── Build the 8-category gap report from already-crawled competitor data ────
function buildGapReport({ url, keyword, myOnPage, competitors, myDomain, location }) {
    const comps = competitors.map(c => c.analysis).filter(Boolean);
    const gaps = [];

    // ────── 1) Headings ──────
    const myH2 = myOnPage.headings?.h2s?.length || 0;
    const myH3 = myOnPage.headings?.h3s?.length || 0;
    const avgCompH2 = arrayAverage(comps.map(c => c.h2Count || 0));
    const avgCompH3 = arrayAverage(comps.map(c => c.h3Count || 0));
    const h2Gap = Math.round(avgCompH2 - myH2);
    const h3Gap = Math.round(avgCompH3 - myH3);
    if (h2Gap >= 2 || h3Gap >= 3) {
        gaps.push({
            id: 'headings',
            category: 'Headings',
            priority: h2Gap >= 5 ? 'high' : 'medium',
            summary: `You're using ${myH2} H2s and ${myH3} H3s. The average top-10 competitor uses ${avgCompH2} H2s and ${avgCompH3} H3s.`,
            mine: { h1: myOnPage.headings.h1s, h2: myOnPage.headings.h2s, h3: myOnPage.headings.h3s, h2Count: myH2, h3Count: myH3 },
            competitors: {
                avgH2: avgCompH2,
                avgH3: avgCompH3,
                bestH2: comps.length ? Math.max(...comps.map(c => c.h2Count || 0)) : 0,
                bestH3: comps.length ? Math.max(...comps.map(c => c.h3Count || 0)) : 0,
            },
            action: h2Gap > 0
                ? `Add ${h2Gap} more H2 section headings to match competitor structure. Cover sub-topics like "${suggestMissingSubtopic(myOnPage.bodyText, comps)}".`
                : `Add ${h3Gap} more H3 sub-headings to break up long sections.`,
            exampleHeadings: deriveCompetitorHeadings(comps).slice(0, 6),
        });
    } else {
        gaps.push({
            id: 'headings',
            category: 'Headings',
            priority: 'low',
            summary: `Heading structure is on par with competitors (${myH2} H2s vs avg ${avgCompH2}).`,
            mine: { h2Count: myH2, h3Count: myH3 },
            competitors: { avgH2: avgCompH2, avgH3: avgCompH3 },
            action: 'Maintain the current heading structure and ensure each H2 targets a distinct sub-topic.',
        });
    }

    // ────── 2) Title / Meta ──────
    const myTitle = myOnPage.meta?.title || '';
    const myDesc = myOnPage.meta?.metaDesc || '';
    const myTitleLen = myTitle.length;
    const myDescLen = myDesc.length;
    const compTitles = comps.map(c => (c.h1 || '').trim()).filter(Boolean);
    const compDescs = comps.map(c => c.metaDescription || '').filter(Boolean);
    const titleIssues = [];
    if (myTitleLen < 30) titleIssues.push(`Your title is short (${myTitleLen} chars).`);
    else if (myTitleLen > 60) titleIssues.push(`Your title is long (${myTitleLen} chars; Google cuts off after ~60).`);
    if (!myOnPage.content?.kwInFirst100) titleIssues.push(`"${keyword}" is missing from your opening paragraph.`);
    const descIssues = [];
    if (!myDesc) descIssues.push('Meta description is missing.');
    else if (myDescLen < 70) descIssues.push(`Meta description is short (${myDescLen} chars).`);
    else if (myDescLen > 160) descIssues.push(`Meta description is long (${myDescLen} chars).`);
    if (myDesc && !myDesc.toLowerCase().includes(keyword.toLowerCase())) descIssues.push('Meta description does not mention the target keyword.');

    gaps.push({
        id: 'title-meta',
        category: 'Title & Meta',
        priority: titleIssues.length > 0 || descIssues.length > 0 ? (titleIssues.length > 1 ? 'high' : 'medium') : 'low',
        summary: titleIssues.length || descIssues.length
            ? `${titleIssues.concat(descIssues).slice(0, 2).join(' ')} Competitor titles average ${compTitles.length ? Math.round(compTitles.join(' ').length / compTitles.length) : 0} chars.`
            : 'Title and meta description look competitive.',
        mine: {
            title: myTitle,
            titleLength: myTitleLen,
            description: myDesc,
            descriptionLength: myDescLen,
        },
        competitors: {
            avgTitleLength: compTitles.length ? Math.round(compTitles.reduce((s, t) => s + t.length, 0) / compTitles.length) : 0,
            avgDescriptionLength: compDescs.length ? Math.round(compDescs.reduce((s, t) => s + t.length, 0) / compDescs.length) : 0,
            sampleTitles: compTitles.slice(0, 3),
            sampleDescriptions: compDescs.slice(0, 3),
        },
        action: buildTitleMetaAction({ titleIssues, descIssues, keyword, myTitle, myDesc }),
    });

    // ────── 3) Content depth ──────
    const myWords = myOnPage.content?.wordCount || 0;
    const compWordCounts = comps.map(c => c.wordCount || 0);
    const avgCompWords = Math.round(arrayAverage(compWordCounts));
    const minCompWords = compWordCounts.length ? Math.min(...compWordCounts) : 0;
    const maxCompWords = compWordCounts.length ? Math.max(...compWordCounts) : 0;
    const wordGap = avgCompWords - myWords;
    gaps.push({
        id: 'content-depth',
        category: 'Content depth',
        priority: wordGap > 600 ? 'high' : wordGap > 200 ? 'medium' : 'low',
        summary: wordGap > 0
            ? `Your page is ${myWords.toLocaleString()} words. Top-10 competitors average ${avgCompWords.toLocaleString()} words (range ${minCompWords.toLocaleString()}–${maxCompWords.toLocaleString()}).`
            : `Your page is ${myWords.toLocaleString()} words, in line with the competitor average of ${avgCompWords.toLocaleString()}.`,
        mine: {
            wordCount: myWords,
            fleschScore: myOnPage.content?.flesch || 0,
            keywordDensity: myOnPage.content?.kwDensity || 0,
        },
        competitors: {
            averageWordCount: avgCompWords,
            minWordCount: minCompWords,
            maxWordCount: maxCompWords,
            wordDistribution: compWordCounts.slice().sort((a, b) => a - b),
        },
        action: wordGap > 200
            ? `Add ${Math.ceil(wordGap / 100) * 100} words across the page. Target sections competitors cover that you don't: ${suggestMissingTopics(myOnPage.bodyText, comps).slice(0, 4).join(', ') || 'comparison, pricing, process, examples'}.`
            : 'Add 1–2 supporting examples or short case studies to deepen thin sections.',
    });

    // ────── 4) FAQs ──────
    const myFaq = myOnPage.content?.hasFaq;
    const compsWithFaq = comps.filter(c => (c.hasFaqSchema) || (c.schemaTypes || []).includes('FAQPage') || /faq|frequent/i.test(c.h1 || ''));
    gaps.push({
        id: 'faqs',
        category: 'FAQs',
        priority: !myFaq && compsWithFaq.length >= 3 ? 'high' : (!myFaq && compsWithFaq.length >= 1 ? 'medium' : 'low'),
        summary: !myFaq
            ? `No FAQ section detected on your page. ${compsWithFaq.length}/${comps.length} competitors include FAQPage schema.`
            : `You already have FAQ content. ${compsWithFaq.length}/${comps.length} competitors include FAQPage schema.`,
        mine: { hasFaqSection: !!myFaq },
        competitors: {
            withFaqSchema: compsWithFaq.length,
            withoutFaqSchema: comps.length - compsWithFaq.length,
            sampleSchemas: compsWithFaq.slice(0, 3).map(c => c.domain),
        },
        action: !myFaq
            ? 'Add an "FAQ" H2 with 4–6 question/answer pairs that cover the People-Also-Ask questions for this keyword, then add FAQPage JSON-LD schema.'
            : 'You already have an FAQ. Add FAQPage schema (JSON-LD) so Google can show rich snippets.',
        schemaSnippet: !myFaq ? buildFaqSchemaSnippet(keyword) : null,
    });

    // ────── 5) Schema ──────
    const mySchemaTypes = myOnPage.schema?.types || [];
    const compsWithSchema = comps.filter(c => c.hasSchema);
    const compSchemaTypes = uniq(comps.flatMap(c => c.schemaTypes || []));
    const missingSchemaTypes = compSchemaTypes.filter(t => !mySchemaTypes.includes(t));
    gaps.push({
        id: 'schema',
        category: 'Schema markup',
        priority: compsWithSchema.length >= Math.ceil(comps.length * 0.6) && !mySchemaTypes.length ? 'high'
            : missingSchemaTypes.length ? 'medium' : 'low',
        summary: mySchemaTypes.length
            ? `You have ${mySchemaTypes.length} schema type(s). Competitors add ${compSchemaTypes.length} on average (${compSchemaTypes.slice(0, 5).join(', ')}).`
            : `No schema found on your page. ${compsWithSchema.length}/${comps.length} competitors use schema markup.`,
        mine: { types: mySchemaTypes, valid: !!myOnPage.schema?.valid },
        competitors: {
            withSchema: compsWithSchema.length,
            withoutSchema: comps.length - compsWithSchema.length,
            commonTypes: compSchemaTypes,
            missingTypes: missingSchemaTypes,
        },
        action: !mySchemaTypes.length
            ? `Add the most common schema types competitors use (${compSchemaTypes.slice(0, 4).join(', ') || 'Article + BreadcrumbList'}). Start with the page-type-appropriate one.`
            : missingSchemaTypes.length
                ? `Add the missing schema types competitors are using: ${missingSchemaTypes.slice(0, 4).join(', ')}.`
                : 'Your schema coverage matches competitors. Validate it with Google Rich Results Test.',
    });

    // ────── 6) Image alt issues ──────
    const myImg = myOnPage.images || {};
    const compImgTotals = comps.map(c => c.images || 0);
    const compImgAlts = comps.map(c => c.altRatio || 0);
    const avgCompImgTotal = Math.round(arrayAverage(compImgTotals));
    const avgCompAltRatio = Math.round(arrayAverage(compImgAlts));
    const myAltRatio = myImg.total > 0 ? Math.round(((myImg.total - myImg.noAlt) / myImg.total) * 100) : 100;
    const imgIssues = [];
    if (myImg.noAlt > 0) imgIssues.push(`${myImg.noAlt}/${myImg.total} images are missing alt text.`);
    if (myImg.total < avgCompImgTotal) imgIssues.push(`You use ${myImg.total} images vs the competitor average of ${avgCompImgTotal}.`);
    gaps.push({
        id: 'images',
        category: 'Image alt text',
        priority: myImg.noAlt > 0 ? 'high' : (myImg.total < avgCompImgTotal * 0.5 ? 'medium' : 'low'),
        summary: imgIssues.length
            ? imgIssues.join(' ')
            : `Image alt coverage is ${myAltRatio}%, in line with competitors (${avgCompAltRatio}%).`,
        mine: {
            total: myImg.total || 0,
            missingAlt: myImg.noAlt || 0,
            altCoverage: myAltRatio,
        },
        competitors: {
            averageImageCount: avgCompImgTotal,
            averageAltCoverage: avgCompAltRatio,
        },
        action: myImg.noAlt > 0
            ? `Add descriptive alt text to ${myImg.noAlt} image(s). At least the primary image should mention "${keyword}".`
            : `Add ${Math.max(0, avgCompImgTotal - myImg.total)} more relevant images with keyword-rich alt text.`,
    });

    // ────── 7) Internal link opportunities ──────
    const myInt = myOnPage.links?.internal || 0;
    const compsInternal = comps.map(c => c.internalLinks || 0);
    const avgCompInt = Math.round(arrayAverage(compsInternal));
    const intGap = avgCompInt - myInt;
    gaps.push({
        id: 'internal-links',
        category: 'Internal linking',
        priority: intGap > 5 ? 'high' : intGap > 2 ? 'medium' : 'low',
        summary: intGap > 0
            ? `You have ${myInt} internal links; the competitor average is ${avgCompInt} (add ~${intGap} more).`
            : `You have ${myInt} internal links, matching the competitor average of ${avgCompInt}.`,
        mine: {
            internal: myInt,
            external: myOnPage.links?.external || 0,
            weakAnchors: myOnPage.links?.weakAnchors || 0,
        },
        competitors: {
            averageInternal: avgCompInt,
            averageExternal: Math.round(arrayAverage(comps.map(c => c.externalLinks || 0))),
            bestInternal: compsInternal.length ? Math.max(...compsInternal) : 0,
        },
        action: intGap > 0
            ? `Add ${intGap} contextual internal links from related blog posts, service pages, or category hubs using descriptive anchor text (not "click here").`
            : 'Add 1–2 internal links from your highest-authority pages to this URL to push equity into it.',
    });

    // ────── 8) Keyword / entity coverage ──────
    const myText = (myOnPage.bodyText || '').toLowerCase();
    const compTexts = competitors
        .map(c => (c.analysis && c.analysis.h1) ? c.analysis.h1 : '')
        .filter(Boolean);
    const allCompetitorWords = uniq([
        ...comps.flatMap(c => collectTopWords(`${c.h1 || ''} ${c.metaDescription || ''}`, 18).map(w => w.word)),
    ]);
    const myTopWords = new Set(topEntities(myOnPage.bodyText || '', 50).map(e => e.word));
    const missingEntities = allCompetitorWords.filter(w => !myTopWords.has(w)).slice(0, 12);
    const kwInTitle = myOnPage.meta?.title?.toLowerCase().includes(keyword.toLowerCase());
    const kwInH1 = myOnPage.headings?.h1s?.some(h => h.toLowerCase().includes(keyword.toLowerCase()));
    const kwInFirst100 = myOnPage.content?.kwInFirst100;
    const myDensity = myOnPage.content?.kwDensity || 0;
    const compsDensity = comps.map(c => c.density || 0);
    const avgCompDensity = arrayAverage(compsDensity);

    gaps.push({
        id: 'keyword-coverage',
        category: 'Keyword & entity coverage',
        priority: missingEntities.length >= 6 ? 'high' : missingEntities.length >= 3 ? 'medium' : 'low',
        summary: missingEntities.length
            ? `Competitors consistently mention these entities you don't: ${missingEntities.slice(0, 6).join(', ')}.`
            : 'You cover the same entities and keyword as the competitor average.',
        mine: {
            keywordInTitle: !!kwInTitle,
            keywordInH1: !!kwInH1,
            keywordInFirst100: !!kwInFirst100,
            keywordDensity: myDensity,
            keywordOccurrences: myOnPage.content?.kwMatches || 0,
        },
        competitors: {
            averageDensity: avgCompDensity,
            commonEntities: allCompetitorWords.slice(0, 12),
        },
        action: buildEntityAction({ missingEntities, kwInTitle, kwInH1, kwInFirst100, keyword, myDensity, avgCompDensity }),
        missingEntities,
    });

    // ── Overall summary ──
    const high = gaps.filter(g => g.priority === 'high').length;
    const medium = gaps.filter(g => g.priority === 'medium').length;
    const low = gaps.filter(g => g.priority === 'low').length;
    const myScore = myOnPage.overall || 0;
    const compScores = competitorAnalysesScores(comps);
    const avgCompScore = Math.round(arrayAverage(compScores));
    return {
        myScore,
        averageCompetitorScore: avgCompScore,
        scoreDelta: myScore - avgCompScore,
        highPriorityGaps: high,
        mediumPriorityGaps: medium,
        lowPriorityGaps: low,
        competitorCount: comps.length,
        keyword,
        url,
        location,
        analyzedAt: new Date().toISOString(),
        gaps,
    };
}

function competitorAnalysesScores(comps) {
    // Synthesize a 0–100 on-page score from the data we already pulled
    return comps.map(c => {
        let score = 50;
        if (c.h1Present) score += 8;
        if (c.hasMetaDescription) score += 8;
        if (c.hasSchema) score += 10;
        if (c.hasFaqSchema) score += 6;
        if (c.hasBreadcrumbSchema) score += 4;
        if (c.wordCount >= 1500) score += 10;
        else if (c.wordCount >= 800) score += 6;
        else if (c.wordCount >= 400) score += 3;
        if (c.altRatio >= 90) score += 5;
        if (c.internalLinks >= 5) score += 4;
        return Math.min(100, score);
    });
}

function deriveCompetitorHeadings(comps) {
    // We don't have competitor headings here (only counts), so use a heuristic
    const common = [
        'What is [keyword]?',
        'How does [keyword] work?',
        'Benefits of [keyword]',
        '[keyword] vs alternatives',
        'Pricing / cost',
        'Step-by-step process',
        'Frequently asked questions',
        'Conclusion',
    ];
    return common;
}

function collectTopWords(text, max) {
    return topEntities(text, max);
}

function suggestMissingSubtopic(myText, comps) {
    const candidates = [
        'pricing', 'cost', 'benefits', 'comparison', 'process', 'how it works',
        'examples', 'case study', 'tools', 'best practices', 'mistakes to avoid', 'FAQs',
    ];
    const lower = (myText || '').toLowerCase();
    return candidates.find(c => !lower.includes(c)) || candidates[0];
}

function suggestMissingTopics(myText, comps) {
    return ['pricing', 'comparison', 'process', 'examples'];
}

function buildTitleMetaAction({ titleIssues, descIssues, keyword, myTitle, myDesc }) {
    if (!titleIssues.length && !descIssues.length) {
        return 'Your title and meta are competitive. A/B test different CTAs in the meta description to lift CTR.';
    }
    const parts = [];
    if (titleIssues.length) {
        const suggested = myTitle && myTitle.length > 60
            ? myTitle.slice(0, 57) + '…'
            : `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} | Benefits, Cost & How to Start`;
        parts.push(`Rewrite title to ~55 chars: "${suggested}".`);
    }
    if (descIssues.length) {
        const suggested = myDesc && myDesc.length > 160
            ? myDesc.slice(0, 157) + '…'
            : `Looking for ${keyword}? Compare top options, see real pricing, and get a free quote in under 2 minutes.`;
        parts.push(`Rewrite meta description to ~155 chars including "${keyword}" and a CTA.`);
    }
    return parts.join(' ');
}

function buildFaqSchemaSnippet(keyword) {
    return `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is ${keyword}?",
      "acceptedAnswer": { "@type": "Answer", "text": "Short answer that addresses the searcher intent for "${keyword}"." }
    },
    {
      "@type": "Question",
      "name": "How much does ${keyword} cost?",
      "acceptedAnswer": { "@type": "Answer", "text": "Typical price ranges and the variables that affect the cost." }
    }
  ]
}`;
}

function buildEntityAction({ missingEntities, kwInTitle, kwInH1, kwInFirst100, keyword, myDensity, avgCompDensity }) {
    const fixes = [];
    if (!kwInTitle) fixes.push(`Add "${keyword}" to the title tag (front-load it).`);
    if (!kwInH1) fixes.push(`Make sure the H1 includes "${keyword}".`);
    if (!kwInFirst100) fixes.push(`Mention "${keyword}" in the first 100 words.`);
    if (myDensity < 0.5) fixes.push(`Raise keyword density from ${myDensity}% to ~1% (the competitor average is ${avgCompDensity}%).`);
    if (missingEntities.length) {
        fixes.push(`Naturally work in these missing entities: ${missingEntities.slice(0, 6).join(', ')}.`);
    }
    return fixes.join(' ');
}

module.exports = { optimizePage };
