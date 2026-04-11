const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('humanizer-service');

const ROBOTIC_PHRASES = [
    'furthermore',
    'moreover',
    'thus',
    'paradigm',
    'facilitates',
    'in conclusion',
    'additionally',
];

const NATURAL_TRANSITIONS = [
    'That said',
    'The interesting part is',
    'What really matters is',
    'In most cases',
    'That’s the thing',
    'Honestly',
    'In reality',
    'That’s where things get interesting',
    'The bigger point is',
];

const EXPRESSIVE_MARKERS = [
    'honestly',
    'in reality',
    'that’s where things get interesting',
    "that's where things get interesting",
    'what really matters is',
    'the bigger point is',
    'that said',
    'the interesting part is',
];

const MODE_GUIDANCE = {
    standard: {
        label: 'Standard',
        prompt: 'Keep the rewrite general-purpose and natural for mixed business or product writing.',
    },
    'seo-blog': {
        label: 'SEO Blog',
        prompt: `Treat the text like an SEO-focused blog draft.
- Keep the article useful and readable, not spammy.
- Preserve headings, subheading intent, and search-focused structure when present.
- Keep primary keywords natural in the copy; do not force repetition.
- Place important primary keywords naturally across the piece, especially near the opening, somewhere in the middle context, and again near the closing section when it fits.
- Do not stuff keywords or repeat them mechanically.
- Add semantic expansion with closely related terms and adjacent phrasing when it helps the article feel richer and more search-relevant, but never invent new facts.
- Blend explanation with insight instead of turning the article into a flat point-by-point list.
- Add light value framing where appropriate, such as why something matters, why developers choose it, or what difference it makes in practice.
- Keep a light conversational layer and subtle emphasis when it fits, for example phrases like "that’s where Node.js stands out," but do not overdo it.
- Avoid flat structure. Combine explanation and perspective in the same passage when that feels natural.
- Maintain scannability, but avoid sounding like formulaic SEO content.
- Keep intros and transitions natural instead of clickbait.
- If the source contains informative sections, preserve that article-style usefulness.`,
    },
};

function getModeConfig(mode) {
    return MODE_GUIDANCE[mode] || MODE_GUIDANCE.standard;
}

function normalizeKeywords(input) {
    if (!input) return [];

    const values = Array.isArray(input) ? input : String(input).split(',');

    return [...new Set(values
        .map(value => String(value).trim())
        .filter(Boolean))];
}

function normalizeSingleKeyword(input) {
    return String(input || '').trim();
}

function getSeoKeywordGuidance(primaryKeyword, relatedKeywords) {
    const cleanPrimaryKeyword = normalizeSingleKeyword(primaryKeyword);
    const cleanRelatedKeywords = normalizeKeywords(relatedKeywords);

    if (!cleanPrimaryKeyword && cleanRelatedKeywords.length === 0) {
        return 'No explicit SEO keyword inputs were provided, so infer them carefully from the source text only when appropriate.';
    }

    return `SEO keyword inputs:
- Primary keyword: ${cleanPrimaryKeyword || 'none provided'}
- Related keywords: ${cleanRelatedKeywords.length > 0 ? cleanRelatedKeywords.join(', ') : 'none provided'}

Use these only in SEO Blog mode.
- Keep the primary keyword natural and present where it fits, especially early, mid-article, and near the close.
- Use related keywords as semantic support, not as a checklist.
- Pair keywords with real context, such as use case, benefit, implementation angle, or outcome.
- Do not force keywords into every paragraph.`;
}

function detectSearchIntent(query) {
    const normalized = String(query || '').trim().toLowerCase();

    if (!normalized) {
        return { type: 'general', guidance: 'No explicit search intent detected. Keep the article useful and naturally informative.' };
    }

    if (/\bwhy\b/.test(normalized)) {
        return {
            type: 'why',
            guidance: 'This looks like a WHY query. Lead with benefits and reasoning. Use language like "because," "this is why," or "the main reason" where it feels natural. Do not just list features; connect features to benefits.',
        };
    }

    if (/\bhow\b/.test(normalized)) {
        return {
            type: 'how',
            guidance: 'This looks like a HOW query. Make the explanation practical, outcome-oriented, and easy to follow. Keep steps or process logic clear without sounding mechanical.',
        };
    }

    if (/\bwhat\b/.test(normalized)) {
        return {
            type: 'what',
            guidance: 'This looks like a WHAT query. Clarify the concept quickly, then explain why it matters in practice instead of staying purely descriptive.',
        };
    }

    if (/\bbest\b/.test(normalized)) {
        return {
            type: 'best',
            guidance: 'This looks like a BEST query. Emphasize selection criteria, practical advantages, and what makes one option stand out, while keeping the tone grounded and natural.',
        };
    }

    return {
        type: 'general',
        guidance: 'No strong search-intent cue detected. Keep the writing naturally helpful and connect features to real outcomes where relevant.',
    };
}

function splitSentences(text) {
    return String(text)
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
}

function extractWords(text) {
    return String(text)
        .toLowerCase()
        .match(/[a-z0-9']+/g) || [];
}

function countSyllables(word) {
    const clean = String(word).toLowerCase().replace(/[^a-z]/g, '');
    if (!clean) return 0;
    if (clean.length <= 3) return 1;

    const groups = clean
        .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
        .replace(/^y/, '')
        .match(/[aeiouy]{1,2}/g);

    return groups ? groups.length : 1;
}

function scoreReadability(words, sentences) {
    if (!words.length || !sentences.length) {
        return { score: 0, label: 'unknown' };
    }

    const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
    const readingEase = 206.835
        - 1.015 * (words.length / sentences.length)
        - 84.6 * (syllables / words.length);

    let label = 'dense';
    if (readingEase >= 70) label = 'easy';
    else if (readingEase >= 55) label = 'clear';
    else if (readingEase >= 40) label = 'moderate';

    return {
        score: Math.round(readingEase),
        label,
    };
}

function countRepeatedPhrases(words, size) {
    const counts = new Map();

    for (let index = 0; index <= words.length - size; index += 1) {
        const phrase = words.slice(index, index + size).join(' ');
        if (phrase.length < 8) continue;
        counts.set(phrase, (counts.get(phrase) || 0) + 1);
    }

    return [...counts.values()].filter(count => count > 1).length;
}

function analyzeText(text) {
    const source = String(text || '').trim();
    const sentences = splitSentences(source);
    const paragraphs = source.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
    const words = extractWords(source);
    const sentenceLengths = sentences.map(sentence => extractWords(sentence).length);
    const averageSentenceLength = sentenceLengths.length
        ? Number((sentenceLengths.reduce((sum, value) => sum + value, 0) / sentenceLengths.length).toFixed(1))
        : 0;
    const sentenceVariance = sentenceLengths.length
        ? Math.max(...sentenceLengths) - Math.min(...sentenceLengths)
        : 0;
    const contractions = (source.match(/\b\w+'\w+\b/g) || []).length;
    const repeatedBigrams = countRepeatedPhrases(words, 2);
    const repeatedTrigrams = countRepeatedPhrases(words, 3);
    const readability = scoreReadability(words, sentences);

    let humanScore = 62;

    if (averageSentenceLength >= 8 && averageSentenceLength <= 22) humanScore += 10;
    if (sentenceVariance >= 8) humanScore += 8;
    if (paragraphs.length >= 2) humanScore += 5;
    if (contractions > 0) humanScore += 4;
    if (readability.label === 'clear' || readability.label === 'easy') humanScore += 6;
    humanScore -= Math.min(15, repeatedBigrams * 2 + repeatedTrigrams * 3);
    if (averageSentenceLength > 30) humanScore -= 8;
    if (!source.includes(',')) humanScore -= 4;

    return {
        wordCount: words.length,
        sentenceCount: sentences.length,
        paragraphCount: paragraphs.length,
        averageSentenceLength,
        sentenceVariance,
        contractions,
        repeatedBigrams,
        repeatedTrigrams,
        readability,
        estimatedHumanScore: Math.max(1, Math.min(100, Math.round(humanScore))),
    };
}

function analyzeToneMix(text) {
    const sentences = splitSentences(text);
    const expressiveSentences = [];
    const plainSentences = [];

    sentences.forEach(sentence => {
        const normalized = sentence.toLowerCase();
        const wordCount = extractWords(sentence).length;
        const isExpressive = EXPRESSIVE_MARKERS.some(marker => normalized.includes(marker))
            || /[—:;]/.test(sentence)
            || sentence.includes('!');
        const isPlain = !isExpressive && wordCount >= 5 && wordCount <= 14;

        if (isExpressive) expressiveSentences.push(sentence);
        if (isPlain) plainSentences.push(sentence);
    });

    return {
        sentenceCount: sentences.length,
        expressiveCount: expressiveSentences.length,
        plainCount: plainSentences.length,
        expressiveRatio: sentences.length ? expressiveSentences.length / sentences.length : 0,
        plainRatio: sentences.length ? plainSentences.length / sentences.length : 0,
    };
}

function extractNumbers(text) {
    return String(text).match(/\b\d+(?:[.,]\d+)?%?\b/g) || [];
}

function looksLikeHtml(text) {
    return /<\/?[a-z][\s\S]*>/i.test(String(text || ''));
}

function escapeHtmlText(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function extractPlainTextFromHtml(html) {
    const $ = cheerio.load(String(html || ''), { decodeEntities: false });
    $('script, style, noscript').remove();
    return $.root().text().replace(/\s+/g, ' ').trim();
}

function createHtmlSegmentTemplate(html) {
    const $ = cheerio.load(String(html || ''), { decodeEntities: false });
    const segments = [];
    let segmentIndex = 1;
    const ignoredTags = new Set(['script', 'style', 'noscript']);

    function walk(node) {
        if (!node) return;

        if (node.type === 'tag' && ignoredTags.has(node.name)) {
            return;
        }

        if (node.type === 'text') {
            const original = node.data || '';
            const trimmed = original.trim();

            if (!trimmed) {
                return;
            }

            const id = `seg_${segmentIndex++}`;
            const leadingWhitespace = original.match(/^\s*/)?.[0] || '';
            const trailingWhitespace = original.match(/\s*$/)?.[0] || '';

            segments.push({ id, text: trimmed });
            node.data = `${leadingWhitespace}[[${id}]]${trailingWhitespace}`;
            return;
        }

        if (Array.isArray(node.children)) {
            node.children.forEach(child => walk(child));
        }
    }

    $.root().contents().each((_, node) => walk(node));

    return {
        template: $.root().html(),
        segments,
    };
}

function rebuildHtmlFromSegments(template, segmentMap) {
    return String(template || '').replace(/\[\[(seg_\d+)\]\]/g, (match, segmentId) => {
        return Object.prototype.hasOwnProperty.call(segmentMap, segmentId)
            ? escapeHtmlText(segmentMap[segmentId])
            : '';
    });
}

function verifyRefinement(originalText, refinedText, preserveKeywords) {
    const warnings = [];
    const originalNumbers = extractNumbers(originalText);
    const refinedNumbers = extractNumbers(refinedText);
    const missingKeywords = preserveKeywords.filter(keyword =>
        !refinedText.toLowerCase().includes(keyword.toLowerCase())
    );
    const refinedLower = refinedText.toLowerCase();
    const remainingRoboticPhrases = ROBOTIC_PHRASES.filter(phrase => refinedLower.includes(phrase));
    const refinedAnalysis = analyzeText(refinedText);
    const toneMix = analyzeToneMix(refinedText);

    if (missingKeywords.length > 0) {
        warnings.push(`Missing preserved keywords: ${missingKeywords.join(', ')}`);
    }

    if (originalNumbers.join('|') !== refinedNumbers.join('|')) {
        warnings.push('Numbers changed during rewrite. Review facts before publishing.');
    }

    const originalLength = originalText.trim().length || 1;
    const refinedLength = refinedText.trim().length;
    const deltaRatio = Math.abs(refinedLength - originalLength) / originalLength;

    if (deltaRatio > 0.45) {
        warnings.push('Rewrite changed length significantly. Check that meaning still matches the source.');
    }

    if (remainingRoboticPhrases.length > 0) {
        warnings.push(`Still contains stiff phrasing: ${remainingRoboticPhrases.join(', ')}`);
    }

    if (refinedAnalysis.sentenceVariance < 5) {
        warnings.push('Sentence rhythm is still fairly uniform. A little more variation may help it read more naturally.');
    }

    if (toneMix.sentenceCount >= 4 && toneMix.expressiveRatio > 0.6) {
        warnings.push('Rhetorical density is high. The rewrite needs more simple, direct sentences between expressive ones.');
    }

    if (toneMix.sentenceCount >= 4 && toneMix.plainCount === 0) {
        warnings.push('The rewrite is too uniformly stylized. Mix in a few neutral, plain sentences.');
    }

    return {
        warnings,
        missingKeywords,
        remainingRoboticPhrases,
        toneMix,
        numbersChanged: originalNumbers.join('|') !== refinedNumbers.join('|'),
        lengthDeltaPercent: Math.round(deltaRatio * 100),
    };
}

function verifySeoRefinement(refinedText, primaryKeyword, relatedKeywords, intentType) {
    const warnings = [];
    const normalizedText = String(refinedText || '').toLowerCase();
    const cleanPrimaryKeyword = normalizeSingleKeyword(primaryKeyword).toLowerCase();
    const cleanRelatedKeywords = normalizeKeywords(relatedKeywords);

    if (cleanPrimaryKeyword && !normalizedText.includes(cleanPrimaryKeyword)) {
        warnings.push(`Primary keyword is missing from the rewrite: ${cleanPrimaryKeyword}`);
    }

    const relatedKeywordHits = cleanRelatedKeywords.filter(keyword => normalizedText.includes(keyword.toLowerCase()));
    if (cleanRelatedKeywords.length > 0 && relatedKeywordHits.length === 0) {
        warnings.push('No related keywords were naturally reinforced in the SEO rewrite.');
    }

    if (intentType === 'why' && !/\bbecause\b|\bthis is why\b|\bthe main reason\b/.test(normalizedText)) {
        warnings.push('WHY intent is under-served. Add benefit-first reasoning language, not just feature description.');
    }

    return {
        warnings,
        relatedKeywordHits,
    };
}

function parseModelResponse(content) {
    const trimmed = String(content || '').trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    const payload = jsonMatch ? jsonMatch[0] : trimmed;
    return JSON.parse(payload);
}

function buildPrompt({ text, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const bannedWordsText = ROBOTIC_PHRASES.join(', ');
    const preferredTransitionsText = NATURAL_TRANSITIONS.join(', ');
    const modeConfig = getModeConfig(mode);
    const searchIntent = detectSearchIntent(primaryKeyword || preserveKeywords[0] || text.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeyword, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';

    return `You are an expert editor improving draft content so it reads naturally, with believable human rhythm and voice, while staying technically accurate.

Your job:
- Rewrite the text so it sounds natural and human-written.
- Preserve the original meaning, facts, numbers, entities, and intent.
- Keep any required keywords present.
- Remove robotic phrasing, repetition, stiffness, and obvious template language.
- Do not invent claims, statistics, testimonials, or personal experience.
- Do not mention AI, detectors, or that the text was rewritten.

Transformation rules you must follow:
- Break predictable structure. Do not force a rigid sequence like definition -> explanation -> example -> conclusion.
- Reorder ideas slightly when it improves natural flow, but keep the meaning intact.
- Break structural predictability further when possible. Do not make the passage read like clean documentation or a neatly staged article.
- Occasionally let explanations arrive a little out of order, or circle back to a point after a brief shift, as long as the meaning stays clear enough.
- Slight topic shifts inside a paragraph are acceptable if they feel natural and human rather than messy.
- Vary sentence rhythm. Mix short, medium, and long sentences. A fragment is okay once in a while.
- Reduce formal tone. Prefer natural wording over academic or robotic phrasing.
- Avoid these words or transitions unless the source truly requires them: ${bannedWordsText}.
- Replace generic transitions with more natural ones where appropriate, such as: ${preferredTransitionsText}.
- Add human texture when it fits: light conversational cues, mild perspective, gentle emphasis, and small opinion-like phrases such as "honestly," "in reality," "that’s where things get interesting," "what really matters is," or "the bigger point is."
- Do not over-optimize the prose into something too polished or too symmetrical.
- Avoid making every sentence perfectly balanced or perfectly structured. A little irregularity is good if it still reads naturally.
- The result should not sound like documentation, a textbook, or an overly finished article.
- Introduce controlled imperfection. Slight redundancy is fine now and then. Slightly informal phrasing is fine too.
- Do not make every sentence stylistically strong. Mix expressive lines with plain, neutral ones.
- Reduce rhetorical density. Do not use a hook, dramatic transition, or emphasis phrase in every paragraph.
- Keep tone humanly inconsistent in a natural way: some parts can feel expressive, while others stay simple and matter-of-fact.
- Preserve technical correctness strictly. Do not add new facts. Do not distort intent.
- Keep formatting simple. Do not introduce bullet points unless the source genuinely needs them.
- The final rewritten passage itself should be plain readable prose only.

Rewrite settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Mode-specific guidance:
${modeConfig.prompt}

SEO input guidance:
${seoKeywordGuidance}

Search intent guidance:
${mode === 'seo-blog' ? searchIntent.guidance : 'Ignore explicit search-intent shaping unless the mode is SEO Blog.'}

SEO + human balance rule:
${mode === 'seo-blog' ? 'If forced to choose, always prefer natural tone first, then subtly reintroduce any missing keywords without making the copy sound forced.' : 'Use natural tone as the default priority.'}

Return ONLY valid JSON with this shape:
{
    "refinedText": "only the rewritten text, with no explanation around it",
  "summary": "one sentence describing what changed",
  "changes": ["short bullet", "short bullet"],
  "alternatives": [
        { "label": "warmer", "text": "alternate rewrite following the same rules" },
        { "label": "sharper", "text": "alternate rewrite following the same rules" }
  ]
}

Original text:
"""
${text}
"""`;
}

function buildHtmlPrompt({ template, segments, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const bannedWordsText = ROBOTIC_PHRASES.join(', ');
    const preferredTransitionsText = NATURAL_TRANSITIONS.join(', ');
    const serializedSegments = JSON.stringify(segments, null, 2);
    const modeConfig = getModeConfig(mode);
    const searchIntent = detectSearchIntent(primaryKeyword || preserveKeywords[0] || '');
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeyword, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';

    return `You are rewriting HTML content while preserving its formatting exactly.

You will receive:
1. An HTML template containing placeholders like [[seg_1]]
2. A JSON array of text segments to rewrite

Rules:
- Rewrite only the text segment values. Do not output HTML.
- Keep the placeholder IDs exactly the same.
- Do not merge, split, remove, or rename segment IDs.
- Preserve the meaning, facts, numbers, entities, and intent.
- Keep required keywords present where appropriate.
- Preserve technical correctness strictly.
- Make the language feel natural and human, following these same writing rules:
    - Break predictable structure and avoid a documentation-like feel.
    - Vary sentence rhythm.
    - Reduce formal tone.
    - Avoid these words unless truly necessary: ${bannedWordsText}.
    - Prefer natural transitions such as: ${preferredTransitionsText}.
    - Mix expressive sentences with plain, neutral ones.
    - Allow slight irregularity and mild redundancy when it sounds natural.
    - Avoid rhetorical density and over-polishing.

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Mode-specific guidance:
${modeConfig.prompt}

SEO input guidance:
${seoKeywordGuidance}

Search intent guidance:
${mode === 'seo-blog' ? searchIntent.guidance : 'Ignore explicit search-intent shaping unless the mode is SEO Blog.'}

SEO + human balance rule:
${mode === 'seo-blog' ? 'If forced to choose, always prefer natural tone first, then subtly reintroduce any missing keywords without making the copy sound forced.' : 'Use natural tone as the default priority.'}

Return ONLY valid JSON in this shape:
{
    "segments": {
        "seg_1": "rewritten text",
        "seg_2": "rewritten text"
    },
    "summary": "one sentence describing what changed",
    "changes": ["short bullet", "short bullet"]
}

HTML template:
"""
${template}
"""

Segments:
${serializedSegments}`;
}

function buildRetryPrompt({ originalText, currentDraft, tone, audience, brandVoice, preserveKeywords, maxChange, warnings, mode, primaryKeyword, relatedKeywords }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const modeConfig = getModeConfig(mode);
    const searchIntent = detectSearchIntent(primaryKeyword || preserveKeywords[0] || originalText.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeyword, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';

    return `Revise this rewritten draft so it feels more naturally human and less over-produced.

Fix these specific problems:
- ${warnings.join('\n- ')}

Requirements:
- Preserve the original meaning, facts, numbers, and keywords.
- Keep the writing natural, but less polished and less uniformly expressive.
- Add a better mix of plain sentences and expressive ones.
- Reduce rhetorical density.
- Keep a little irregularity and mild redundancy if it helps.
- Do not explain the changes.

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Mode-specific guidance:
${modeConfig.prompt}

SEO input guidance:
${seoKeywordGuidance}

Search intent guidance:
${mode === 'seo-blog' ? searchIntent.guidance : 'Ignore explicit search-intent shaping unless the mode is SEO Blog.'}

SEO + human balance rule:
${mode === 'seo-blog' ? 'Prefer natural tone first. If a keyword is missing, add it back subtly and contextually rather than forcing it.' : 'Prefer natural tone first.'}

Return ONLY valid JSON with this shape:
{
    "refinedText": "only the rewritten text, with no explanation around it",
    "summary": "one sentence describing what changed",
    "changes": ["short bullet", "short bullet"],
    "alternatives": [
        { "label": "warmer", "text": "alternate rewrite following the same rules" },
        { "label": "sharper", "text": "alternate rewrite following the same rules" }
    ]
}

Original text:
"""
${originalText}
"""

Current rewritten draft:
"""
${currentDraft}
"""`;
}

function buildHtmlRetryPrompt({ template, originalText, currentDraft, tone, audience, brandVoice, preserveKeywords, maxChange, warnings, mode, primaryKeyword, relatedKeywords }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const segmentPayload = JSON.stringify(currentDraft, null, 2);
    const modeConfig = getModeConfig(mode);
    const searchIntent = detectSearchIntent(primaryKeyword || preserveKeywords[0] || originalText.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeyword, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';

    return `Revise these rewritten HTML text segments so they feel more naturally human and less over-produced.

Fix these specific problems:
- ${warnings.join('\n- ')}

Requirements:
- Preserve the original meaning, facts, numbers, and keywords.
- Keep the segment IDs exactly the same.
- Do not output HTML.
- Make the writing less polished and less uniformly expressive.
- Add a better mix of plain sentences and expressive ones.
- Reduce rhetorical density.
- Keep mild irregularity if it helps the text feel human.

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Mode-specific guidance:
${modeConfig.prompt}

SEO input guidance:
${seoKeywordGuidance}

Search intent guidance:
${mode === 'seo-blog' ? searchIntent.guidance : 'Ignore explicit search-intent shaping unless the mode is SEO Blog.'}

SEO + human balance rule:
${mode === 'seo-blog' ? 'Prefer natural tone first. If a keyword is missing, add it back subtly and contextually rather than forcing it.' : 'Prefer natural tone first.'}

Return ONLY valid JSON in this shape:
{
    "segments": {
        "seg_1": "rewritten text",
        "seg_2": "rewritten text"
    },
    "summary": "one sentence describing what changed",
    "changes": ["short bullet", "short bullet"]
}

Original extracted text:
"""
${originalText}
"""

HTML template:
"""
${template}
"""

Current rewritten segments:
${segmentPayload}`;
}

function shouldRetryRefinement(verification) {
        if (!verification) return false;

        if (verification.missingKeywords?.length > 0) return true;
        if (verification.numbersChanged) return true;

        return verification.warnings.some(warning =>
                warning.includes('Sentence rhythm is still fairly uniform')
                || warning.includes('Rhetorical density is high')
                || warning.includes('too uniformly stylized')
                || warning.includes('Still contains stiff phrasing')
        );
}

async function requestRewrite(prompt) {
    let response;

    if (config.apis.openRouter && config.apis.openRouter.key) {
        try {
            response = await axios.post(config.apis.openRouter.url, {
                model: config.apis.openRouter.model,
                messages: [{ role: 'user', content: prompt }],
            }, {
                headers: {
                    Authorization: `Bearer ${config.apis.openRouter.key}`,
                    'HTTP-Referer': 'http://localhost:3000',
                    'X-Title': 'Keyword Analyzer Content Humanizer',
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });
        } catch (err) {
            log.warn({ err: err.message }, 'OpenRouter rewrite failed, trying Groq');
        }
    }

    if (!response && config.apis.groq && config.apis.groq.key) {
        response = await axios.post(config.apis.groq.url, {
            model: config.apis.groq.model,
            messages: [{ role: 'user', content: prompt }],
        }, {
            headers: {
                Authorization: `Bearer ${config.apis.groq.key}`,
                'Content-Type': 'application/json',
            },
            timeout: 30000,
        });
    }

    if (!response) {
        throw new Error('Configure OPENROUTER_API_KEY or GROQ_API_KEY to use the content humanizer.');
    }

    const content = response.data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('No rewrite content returned by the model.');
    }

    return parseModelResponse(content);
}

function normalizeSegmentRewriteResponse(response, expectedIds) {
    const mappedSegments = response?.segments || {};
    const normalizedSegments = {};

    expectedIds.forEach(id => {
        const value = mappedSegments[id];
        normalizedSegments[id] = String(value || '').trim();
    });

    return {
        segments: normalizedSegments,
        summary: response?.summary,
        changes: response?.changes,
    };
}

async function humanizeHtmlContent({ text, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords }) {
    const htmlTemplate = createHtmlSegmentTemplate(text);

    if (!htmlTemplate.segments.length) {
        throw new Error('No editable text nodes were found in the HTML input.');
    }

    const originalPlainText = extractPlainTextFromHtml(text);
    const originalAnalysis = analyzeText(originalPlainText);
    const expectedIds = htmlTemplate.segments.map(segment => segment.id);

    let rewrite = normalizeSegmentRewriteResponse(
        await requestRewrite(buildHtmlPrompt({
            template: htmlTemplate.template,
            segments: htmlTemplate.segments,
            tone,
            audience,
            brandVoice,
            preserveKeywords,
            maxChange,
            mode,
            primaryKeyword,
            relatedKeywords,
        })),
        expectedIds
    );

    let refinedHtml = rebuildHtmlFromSegments(htmlTemplate.template, rewrite.segments);
    let refinedPlainText = extractPlainTextFromHtml(refinedHtml);

    if (!refinedPlainText) {
        throw new Error('The model returned empty rewritten HTML content.');
    }

    let refinedAnalysis = analyzeText(refinedPlainText);
    let verification = verifyRefinement(originalPlainText, refinedPlainText, preserveKeywords);
    let seoVerification = mode === 'seo-blog'
        ? verifySeoRefinement(refinedPlainText, primaryKeyword, relatedKeywords, detectSearchIntent(primaryKeyword || preserveKeywords[0] || '').type)
        : { warnings: [], relatedKeywordHits: [] };

    verification.warnings.push(...seoVerification.warnings);
    verification.relatedKeywordHits = seoVerification.relatedKeywordHits;

    if (shouldRetryRefinement(verification)) {
        log.info({ warnings: verification.warnings.length }, 'retrying HTML humanizer for improved naturalness');

        rewrite = normalizeSegmentRewriteResponse(
            await requestRewrite(buildHtmlRetryPrompt({
                template: htmlTemplate.template,
                originalText: originalPlainText,
                currentDraft: rewrite.segments,
                tone,
                audience,
                brandVoice,
                preserveKeywords,
                maxChange,
                warnings: verification.warnings,
                mode,
                primaryKeyword,
                relatedKeywords,
            })),
            expectedIds
        );

        refinedHtml = rebuildHtmlFromSegments(htmlTemplate.template, rewrite.segments);
        refinedPlainText = extractPlainTextFromHtml(refinedHtml);

        if (!refinedPlainText) {
            throw new Error('The model returned empty rewritten HTML content on retry.');
        }

        refinedAnalysis = analyzeText(refinedPlainText);
        verification = verifyRefinement(originalPlainText, refinedPlainText, preserveKeywords);
        seoVerification = mode === 'seo-blog'
            ? verifySeoRefinement(refinedPlainText, primaryKeyword, relatedKeywords, detectSearchIntent(primaryKeyword || preserveKeywords[0] || '').type)
            : { warnings: [], relatedKeywordHits: [] };

        verification.warnings.push(...seoVerification.warnings);
        verification.relatedKeywordHits = seoVerification.relatedKeywordHits;
    }

    return {
        refinedText: refinedHtml,
        summary: rewrite.summary || 'Refined the text content while keeping the original HTML structure intact.',
        changes: Array.isArray(rewrite.changes) ? rewrite.changes.slice(0, 6) : [],
        alternatives: [],
        originalAnalysis,
        refinedAnalysis,
        verification,
        preservedKeywords: preserveKeywords,
        primaryKeyword: mode === 'seo-blog' ? normalizeSingleKeyword(primaryKeyword) : '',
        relatedKeywords: mode === 'seo-blog' ? normalizeKeywords(relatedKeywords) : [],
    };
}

async function humanizeContent({ text, tone = 'natural', audience = '', brandVoice = '', preserveKeywords = [], maxChange = 'balanced', preserveHtml = false, mode = 'standard', primaryKeyword = '', relatedKeywords = [] }) {
    const normalizedKeywords = normalizeKeywords(preserveKeywords);
    const normalizedPrimaryKeyword = mode === 'seo-blog' ? normalizeSingleKeyword(primaryKeyword) : '';
    const normalizedRelatedKeywords = mode === 'seo-blog' ? normalizeKeywords(relatedKeywords) : [];

    if (preserveHtml && looksLikeHtml(text)) {
        return humanizeHtmlContent({
            text,
            tone,
            audience,
            brandVoice,
            preserveKeywords: normalizedKeywords,
            maxChange,
            mode,
            primaryKeyword: normalizedPrimaryKeyword,
            relatedKeywords: normalizedRelatedKeywords,
        });
    }

    const originalAnalysis = analyzeText(text);
    const prompt = buildPrompt({
        text,
        tone,
        audience,
        brandVoice,
        preserveKeywords: normalizedKeywords,
        maxChange,
        mode,
        primaryKeyword: normalizedPrimaryKeyword,
        relatedKeywords: normalizedRelatedKeywords,
    });

    log.info({ tone, audience, maxChange, keywords: normalizedKeywords.length }, 'humanizing content');

    let rewrite = await requestRewrite(prompt);
    let refinedText = String(rewrite.refinedText || '').trim();

    if (!refinedText) {
        throw new Error('The model returned an empty rewrite.');
    }

    let refinedAnalysis = analyzeText(refinedText);
    let verification = verifyRefinement(text, refinedText, normalizedKeywords);
    let seoVerification = mode === 'seo-blog'
        ? verifySeoRefinement(refinedText, normalizedPrimaryKeyword, normalizedRelatedKeywords, detectSearchIntent(normalizedPrimaryKeyword || normalizedKeywords[0] || '').type)
        : { warnings: [], relatedKeywordHits: [] };

    verification.warnings.push(...seoVerification.warnings);
    verification.relatedKeywordHits = seoVerification.relatedKeywordHits;

    if (shouldRetryRefinement(verification)) {
        log.info({ warnings: verification.warnings.length }, 'retrying humanizer for improved naturalness');

        rewrite = await requestRewrite(buildRetryPrompt({
            originalText: text,
            currentDraft: refinedText,
            tone,
            audience,
            brandVoice,
            preserveKeywords: normalizedKeywords,
            maxChange,
            warnings: verification.warnings,
            mode,
            primaryKeyword: normalizedPrimaryKeyword,
            relatedKeywords: normalizedRelatedKeywords,
        }));

        refinedText = String(rewrite.refinedText || '').trim();

        if (!refinedText) {
            throw new Error('The model returned an empty rewrite on retry.');
        }

        refinedAnalysis = analyzeText(refinedText);
        verification = verifyRefinement(text, refinedText, normalizedKeywords);
        seoVerification = mode === 'seo-blog'
            ? verifySeoRefinement(refinedText, normalizedPrimaryKeyword, normalizedRelatedKeywords, detectSearchIntent(normalizedPrimaryKeyword || normalizedKeywords[0] || '').type)
            : { warnings: [], relatedKeywordHits: [] };

        verification.warnings.push(...seoVerification.warnings);
        verification.relatedKeywordHits = seoVerification.relatedKeywordHits;
    }

    return {
        refinedText,
        summary: rewrite.summary || 'Improved flow, clarity, and variation while preserving the original message.',
        changes: Array.isArray(rewrite.changes) ? rewrite.changes.slice(0, 6) : [],
        alternatives: Array.isArray(rewrite.alternatives)
            ? rewrite.alternatives
                .filter(option => option && option.label && option.text)
                .slice(0, 2)
            : [],
        originalAnalysis,
        refinedAnalysis,
        verification,
        preservedKeywords: normalizedKeywords,
        primaryKeyword: normalizedPrimaryKeyword,
        relatedKeywords: normalizedRelatedKeywords,
    };
}

module.exports = {
    humanizeContent,
};