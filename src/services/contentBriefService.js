const keywordService = require('./keywordService');
const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('content-brief-service');

const STOP_WORDS = new Set([
    'about', 'after', 'again', 'against', 'also', 'and', 'are', 'best', 'but', 'can',
    'for', 'from', 'get', 'has', 'have', 'how', 'into', 'near', 'not', 'the',
    'this', 'top', 'use', 'what', 'when', 'where', 'which', 'with', 'your',
]);

function uniq(values) {
    const seen = new Set();
    return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .filter(value => {
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function titleCase(value) {
    return String(value || '')
        .split(/\s+/)
        .map(word => word ? word[0].toUpperCase() + word.slice(1) : '')
        .join(' ');
}

function cleanMeta(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function extractTopicTerms(research) {
    const fromGaps = research.contentGaps?.topicsToCover || [];
    const related = (research.relatedKeywords || []).map(item => item.keyword);
    const titles = (research.competitors || []).slice(0, 10).flatMap(item =>
        String(item.title || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, ' ')
            .split(/\s+/)
            .filter(word => word.length > 3 && !STOP_WORDS.has(word))
    );

    return uniq([...fromGaps, ...related, ...titles]).slice(0, 24);
}

function inferPageType(keyword, intent) {
    const lower = String(keyword || '').toLowerCase();
    if (intent?.primary === 'transactional') return 'landing-page';
    if (intent?.primary === 'commercial') return 'comparison-or-buying-guide';
    if (/\b(near me|in [a-z]+|service|company|agency|clinic|restaurant|dealer)\b/.test(lower)) return 'service-or-local-page';
    if (/^(how|what|why|when|where|which)\b/.test(lower)) return 'blog-guide';
    return 'seo-blog';
}

function buildDeterministicBrief(keyword, research, options = {}) {
    const intent = research.intent || keywordService.analyzeKeywordIntent(keyword);
    const pageType = inferPageType(keyword, intent);
    const relatedKeywords = (research.relatedKeywords || []).slice(0, 10).map(item => item.keyword);
    const entities = extractTopicTerms(research);
    const competitorExamples = (research.competitors || []).slice(0, 5).map(item => ({
        position: item.position,
        domain: item.domain,
        url: item.url,
        title: item.title,
        description: item.description,
    }));
    const avgWords = Number(research.topPagesAnalysis?.averageWordCount || 0);
    const gapTarget = Number(research.contentGaps?.contentLengthTarget || 0);
    const targetMid = Math.max(1200, Math.round((avgWords || gapTarget || 1800) * 1.15));
    const targetWordCount = {
        min: Math.max(900, Math.round(targetMid * 0.85)),
        ideal: targetMid,
        max: Math.round(targetMid * 1.25),
        basis: avgWords > 0
            ? `Based on top competitor average of ${avgWords} words, plus extra depth.`
            : 'Based on SERP depth and a default SEO article benchmark.',
    };
    const faqCandidates = uniq([
        ...(research.contentGaps?.questionsNotAnswered || []),
        ...(research.relatedKeywords || [])
            .filter(item => item.type === 'question' || String(item.keyword || '').includes('?'))
            .map(item => item.keyword),
    ]).slice(0, 8);
    const h2s = [
        `What Is ${titleCase(keyword)}?`,
        `Why ${titleCase(keyword)} Matters`,
        `Key Benefits and Use Cases`,
        `How to Choose the Right Option`,
        `Common Mistakes to Avoid`,
        `FAQs About ${titleCase(keyword)}`,
    ];

    if (pageType === 'service-or-local-page') {
        h2s.splice(1, 0, `Our ${titleCase(keyword)} Services`, `Why Choose Us for ${titleCase(keyword)}`);
    }

    const schemaTypes = ['BreadcrumbList'];
    if (faqCandidates.length >= 3) schemaTypes.unshift('FAQPage');
    if (pageType === 'blog-guide' || pageType === 'seo-blog') schemaTypes.unshift('Article');
    if (pageType === 'service-or-local-page') schemaTypes.unshift('Service', 'LocalBusiness');
    if (pageType === 'comparison-or-buying-guide') schemaTypes.unshift('ItemList', 'Review');

    return {
        keyword,
        location: options.location || 'India',
        searchIntent: {
            primary: intent.primary,
            secondary: intent.secondary,
            stage: intent.stage,
            description: research.intent?.description || '',
            pageType,
        },
        suggestedTitle: `${titleCase(keyword)}: Complete Guide, Benefits, and Expert Tips`,
        metaDescription: cleanMeta(`Learn about ${keyword}, compare important options, and get practical tips to choose the right approach for your needs.`),
        h1: titleCase(keyword),
        outline: {
            h1: titleCase(keyword),
            h2: h2s.map((heading, index) => ({
                heading,
                purpose: index === 0
                    ? 'Match search intent quickly and set context.'
                    : 'Build topical depth and answer related user needs.',
                h3: index === h2s.length - 1
                    ? faqCandidates.slice(0, 4)
                    : [],
            })),
        },
        targetWordCount,
        entitiesAndTopics: entities,
        faqs: faqCandidates,
        schemaRecommendation: {
            primary: schemaTypes[0] || 'Article',
            recommendedTypes: uniq(schemaTypes),
            notes: 'Use schema only for content that is visible on the page. Add FAQ schema when the FAQ section is present.',
        },
        internalLinkSuggestions: [
            {
                anchorText: keyword,
                target: options.myDomain ? `Core service or landing page on ${options.myDomain}` : 'Primary service or landing page',
                reason: 'Reinforces the main commercial target for this topic.',
            },
            ...relatedKeywords.slice(0, 4).map(related => ({
                anchorText: related,
                target: 'Relevant supporting blog, service, or category page',
                reason: 'Builds topical authority and helps users continue their journey.',
            })),
        ],
        competitorExamples,
        humanizerSettings: {
            mode: 'seo-blog',
            primaryKeyword: keyword,
            relatedKeywords: relatedKeywords.slice(0, 8),
            preserveKeywords: uniq([keyword, ...relatedKeywords.slice(0, 5)]),
            tone: 'natural',
            audience: options.audience || '',
            brandVoice: options.brandVoice || 'clear, trustworthy, practical',
            maxChange: 'balanced',
        },
        sourceData: {
            metrics: research.metrics,
            serpFeatures: research.serpFeatures,
            contentGaps: research.contentGaps,
            topPagesAnalysis: research.topPagesAnalysis,
        },
        generatedAt: new Date().toISOString(),
    };
}

function buildAiPrompt(baseBrief) {
    return `You are a senior SEO strategist creating a content brief from SERP data.

Improve the provided brief without inventing facts. Keep it practical, publishable, and aligned to search intent.
Use competitor titles/descriptions only as examples of SERP patterns, not as claims.

Return ONLY valid JSON with this exact shape:
{
  "suggestedTitle": "SEO title under 65 characters",
  "metaDescription": "Meta description under 155 characters",
  "h1": "recommended H1",
  "outline": {
    "h1": "recommended H1",
    "h2": [
      { "heading": "H2 text", "purpose": "why this section exists", "h3": ["optional H3"] }
    ]
  },
  "entitiesAndTopics": ["topic"],
  "faqs": ["question"],
  "schemaRecommendation": {
    "primary": "schema type",
    "recommendedTypes": ["schema type"],
    "notes": "implementation note"
  },
  "internalLinkSuggestions": [
    { "anchorText": "anchor", "target": "target page type", "reason": "why it helps" }
  ]
}

Base brief:
${JSON.stringify(baseBrief, null, 2)}`;
}

function mergeAiBrief(baseBrief, aiBrief) {
    if (!aiBrief || typeof aiBrief !== 'object') return baseBrief;

    return {
        ...baseBrief,
        suggestedTitle: cleanMeta(aiBrief.suggestedTitle || baseBrief.suggestedTitle).slice(0, 70),
        metaDescription: cleanMeta(aiBrief.metaDescription || baseBrief.metaDescription).slice(0, 160),
        h1: String(aiBrief.h1 || baseBrief.h1).trim(),
        outline: aiBrief.outline?.h2 ? aiBrief.outline : baseBrief.outline,
        entitiesAndTopics: uniq([...(aiBrief.entitiesAndTopics || []), ...baseBrief.entitiesAndTopics]).slice(0, 30),
        faqs: uniq([...(aiBrief.faqs || []), ...baseBrief.faqs]).slice(0, 10),
        schemaRecommendation: aiBrief.schemaRecommendation || baseBrief.schemaRecommendation,
        internalLinkSuggestions: Array.isArray(aiBrief.internalLinkSuggestions)
            ? aiBrief.internalLinkSuggestions.slice(0, 8)
            : baseBrief.internalLinkSuggestions,
        aiEnhanced: true,
    };
}

async function generateContentBrief({
    keyword,
    location = 'India',
    audience = '',
    brandVoice = '',
    myDomain = '',
    numResults = 10,
    useAi = true,
} = {}) {
    const cleanKeyword = String(keyword || '').trim();
    if (!cleanKeyword) {
        throw new Error('Keyword is required.');
    }

    log.info({ keyword: cleanKeyword, location }, 'generating content brief');

    const research = await keywordService.advancedKeywordResearch(cleanKeyword, {
        location,
        includeSerpFeatures: true,
        includeIntent: true,
        includeContentGap: true,
        includeCompetitorAnalysis: true,
        numResults: Math.min(Math.max(Number(numResults) || 10, 5), 20),
    });

    const baseBrief = buildDeterministicBrief(cleanKeyword, research, {
        location,
        audience,
        brandVoice,
        myDomain,
    });

    if (!useAi) {
        return { ...baseBrief, aiEnhanced: false };
    }

    try {
        const content = await resilientLlmRequest({
            prompt: buildAiPrompt(baseBrief),
            expectJson: true,
            timeoutMs: 30000,
        });
        return mergeAiBrief(baseBrief, extractJson(content));
    } catch (err) {
        log.warn({ err: err.message, keyword: cleanKeyword }, 'AI brief enhancement failed; using deterministic brief');
        return {
            ...baseBrief,
            aiEnhanced: false,
            aiWarning: 'AI enhancement unavailable. Returned rule-based brief from SERP data.',
        };
    }
}

module.exports = {
    generateContentBrief,
    buildDeterministicBrief,
};
