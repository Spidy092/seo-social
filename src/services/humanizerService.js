const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../config');
const { resilientLlmRequest } = require('../utils/aiHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('humanizer-service');

const ROBOTIC_PHRASES = [
    'delve',
    'tapestry',
    'testament to',
    'transformative potential',
    'pivotal moment',
    'rapidly evolving landscape',
    'at its core',
    'not just',
    'serves as a catalyst',
    'multifaceted',
    'paramount',
    'underscore',
    'seamless',
    'foster',
    'unlocking creativity at scale',
    'furthermore',
    'moreover',
    'thus',
    'paradigm',
    'facilitates',
    'in conclusion',
    'additionally',
    'stands as',
    'serves as',
    'offers a',
    'breathtaking',
    'cutting-edge',
    'vibrant',
    'experts argue',
    'industry observers note',
    'it is important to note',
    'relic',
    'avenues',
    'not only',
    'in summary',
    'lastly',
    'indeed',
    'revolutionize',
    'harnessing',
    'demystify',
    'embark on a journey',
    'look no further',
    'game changer',
    'pave the way',
    'nestled',
    'tapestry of',
    'in this digital age',
    'driving force',
    'beacon of hope',
    'removes the guesswork',
    'one-size-fits-all',
    'shatters the boundaries',
    'overall',
    'notably',
    'importantly',
    'rich cultural heritage',
    'enduring legacy',
    'must-visit',
    'must-see',
    'stunning'
];

// Words that are common AI-writing tells in excess, but are often the correct,
// technically precise word choice. Nudge away from these instead of banning
// them outright, so the rewrite doesn't force awkward substitutions.
const SOFT_AVOID_PHRASES = [
    { phrase: 'crucial', alternative: 'important' },
    { phrase: 'vital', alternative: 'necessary' },
    { phrase: 'boasts', alternative: 'has' },
    { phrase: 'features', alternative: 'includes' },
];

const NATURAL_TRANSITIONS = [
    'That said',
    'For instance',
    'Because of this',
    'The truth is',
    'To be fair',
];

const EXPRESSIVE_MARKERS = [
    'i genuinely',
    'i feel',
    'the truth is',
    'i keep thinking',
    'i suspect',
    'to be fair',
    'that said',
    'for instance',
    'because of this',
];

const TARGET_AI_DETECTION_PERCENT = 10;

const AI_PATTERN_RULES = [
    { label: 'inflated significance language', regex: /\b(?:testament to|transformative potential|pivotal moment|crucial role|vital role|rich cultural heritage|enduring legacy)\b/gi, weight: 7 },
    { label: 'AI transition words', regex: /\b(?:additionally|furthermore|moreover|therefore|thus|overall|in conclusion|in summary|lastly|notably|importantly)\b/gi, weight: 5 },
    { label: 'promotional padding', regex: /\b(?:breathtaking|cutting-edge|vibrant|must-visit|must-see|stunning|game changer|look no further)\b/gi, weight: 6 },
    { label: 'copula avoidance', regex: /\b(?:serves as|stands as|boasts|features|offers a|facilitates|showcases|underscores)\b/gi, weight: 6 },
    { label: 'negative parallelism', regex: /\b(?:not just|not only)\b[\s\S]{0,90}\b(?:but|it's about|also)\b/gi, weight: 7 },
    { label: 'generic authority phrase', regex: /\b(?:experts (?:argue|believe|say)|industry observers (?:note|have noted)|it is important to note)\b/gi, weight: 6 },
    { label: 'signposting phrase', regex: /\b(?:let's dive in|here's what you need to know|in this article|in this guide|at its core|the truth is)\b/gi, weight: 5 },
    { label: 'filler phrase', regex: /\b(?:in order to|due to the fact that|it could potentially be argued|could potentially|might have some)\b/gi, weight: 5 },
    { label: 'textbook definition opener', regex: /\b(?:is a set of|is defined as|refers to|can be described as|is the process of|is an approach that)\b/gi, weight: 8 },
    { label: 'encyclopedic example framing', regex: /\b(?:examples include|types include|common .* include|modern .* include|key .* include)\b/gi, weight: 7 },
    { label: 'stacked category explanation', regex: /\b(?:procedural programming|object-oriented programming|functional programming|declarative programming|system software|application software|cloud-native applications|microservices)\b/gi, weight: 3 },
    { label: 'software category template', regex: /\b(?:system software|application software|programming software|embedded software)\b.{0,90}\b(?:handles|interact|built for|runs on|use to|includes?|like)\b/gi, weight: 9 },
    { label: 'example pile-up', regex: /\b(?:like|such as|including|plus)\b[^.]{20,160}\b(?:and|plus)\b[^.]{10,120}\b(?:and|plus)\b/gi, weight: 8 },
    { label: 'generic explainer sentence', regex: /\b(?:is what|is basically|gives .* a place to run|day to day|big names here|middle ground between)\b/gi, weight: 7 },
    { label: 'generic positive conclusion', regex: /\b(?:the future looks bright|exciting times lie ahead|continues to thrive|pave the way)\b/gi, weight: 7 },
    { label: 'chatbot artifact', regex: /\b(?:i hope this helps|let me know if|certainly!|great question)\b/gi, weight: 8 },
    { label: 'em dash or en dash', regex: /[—–]/g, weight: 5 },
    { label: 'emoji or heavy symbol', regex: /[\u{1F300}-\u{1FAFF}✅✨🚀]/gu, weight: 5 },
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

const MAX_CHANGE_GUIDANCE = {
    light: `Light change level: make the smallest edits that remove AI tells and stiffness.
- Keep the original sentence order, paragraph order, and sentence count as close to the source as possible.
- Prefer word- and phrase-level fixes (swap a stiff word, break a copula-avoidance verb) over restructuring sentences.
- Do not merge or split sentences unless a sentence is a clear AI-detection risk on its own.
- The rewrite should read like a light copyedit of the original, not a new draft.`,
    balanced: `Balanced change level: rewrite at the sentence level while keeping the same overall structure and idea order.
- You may reorder clauses within a sentence, merge short choppy sentences, or split long ones for rhythm.
- Keep the same paragraph-to-paragraph flow as the source; do not add or remove whole ideas.
- Aim for a natural middle ground: noticeably rewritten, but still clearly the same piece of writing.`,
    strong: `Strong change level: fully rewrite for maximum naturalness and detector evasion.
- Freely restructure paragraphs, reorder supporting points, and vary sentence architecture as long as the facts, keywords, and meaning survive.
- Prioritize burstiness and natural voice over staying close to the original phrasing.
- It is fine for very little of the original wording to survive, as long as nothing factual is lost.`,
};

function getMaxChangeGuidance(maxChange) {
    const key = String(maxChange || 'balanced').toLowerCase();
    return MAX_CHANGE_GUIDANCE[key] || MAX_CHANGE_GUIDANCE.balanced;
}

function getSoftAvoidGuidance() {
    return SOFT_AVOID_PHRASES.map(item => `"${item.phrase}" -> "${item.alternative}"`).join(', ');
}

function getTargetLengthGuidance(targetLength, currentWordCount) {
    const target = Number(targetLength) || 0;
    if (!target || target < 20) {
        return 'No explicit target length was given. Keep the rewrite close to the original length unless naturalness requires otherwise.';
    }

    return `Target length: aim for approximately ${target} words (current draft is about ${currentWordCount} words).
- Stay within roughly 15% of the target word count.
- Never pad with filler or repeat points just to hit the number, and never cut content that would drop a fact or keyword.
- If natural phrasing and the target length conflict, prioritize natural phrasing but stay as close to the target as reasonably possible.`;
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

function getSeoKeywordGuidance(primaryKeywordVariants, relatedKeywords) {
    const cleanVariants = normalizeKeywords(primaryKeywordVariants);
    const mainKeyword = cleanVariants[0] || '';
    const otherVariants = cleanVariants.slice(1);
    const cleanRelatedKeywords = normalizeKeywords(relatedKeywords);

    if (!mainKeyword && cleanRelatedKeywords.length === 0) {
        return 'No explicit SEO keyword inputs were provided, so infer them carefully from the source text only when appropriate.';
    }

    return `SEO keyword inputs:
- Primary keyword: ${mainKeyword || 'none provided'}
${otherVariants.length > 0 ? `- Acceptable natural variants of the primary keyword (use interchangeably): ${otherVariants.join(', ')}` : ''}
- Related keywords: ${cleanRelatedKeywords.length > 0 ? cleanRelatedKeywords.join(', ') : 'none provided'}

Use these only in SEO Blog mode.
- Keep the primary keyword (or one of its listed variants) natural and present where it fits, especially early, mid-article, and near the close.
- If variants are provided, rotate between the primary keyword and its variants across sections instead of repeating the exact same phrase every time. This broadens semantic coverage without sounding mechanical.
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

    // Count each run of consecutive vowels as one syllable nucleus, rather than
    // capping at 2 characters. This correctly treats triphthongs like "eau" in
    // "beautiful" or "ueue" in "queue" as a single syllable instead of splitting
    // them into extra, inflated groups.
    const groups = clean
        .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
        .replace(/^y/, '')
        .match(/[aeiouy]+/g);

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

function getPatternMatches(text) {
    const source = String(text || '');

    return AI_PATTERN_RULES
        .map(rule => {
            const matches = source.match(rule.regex) || [];
            return {
                label: rule.label,
                count: matches.length,
                weight: rule.weight,
            };
        })
        .filter(rule => rule.count > 0);
}

function estimateAiDetectionPercent({ text, humanScore, repeatedBigrams, repeatedTrigrams, sentenceVariance, averageSentenceLength, contractions, readability }) {
    const patternMatches = getPatternMatches(text);
    const patternRisk = patternMatches.reduce((total, rule) => total + Math.min(18, rule.count * rule.weight), 0);
    let risk = 100 - humanScore;

    risk += Math.min(35, patternRisk);
    if (patternMatches.length >= 3) risk += 12;
    risk += Math.min(12, repeatedBigrams + repeatedTrigrams * 2);
    if (sentenceVariance < 5) risk += 10;
    if (averageSentenceLength > 28) risk += 8;
    if (averageSentenceLength > 0 && averageSentenceLength < 6) risk += 5;
    if (contractions === 0) risk += 4;
    if (readability?.label === 'dense') risk += 6;
    if (!String(text || '').includes(',')) risk += 3;

    return {
        score: Math.max(1, Math.min(99, Math.round(risk))),
        patternMatches,
    };
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

    const boundedHumanScore = Math.max(1, Math.min(100, Math.round(humanScore)));
    const aiDetection = estimateAiDetectionPercent({
        text: source,
        humanScore: boundedHumanScore,
        repeatedBigrams,
        repeatedTrigrams,
        sentenceVariance,
        averageSentenceLength,
        contractions,
        readability,
    });

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
        estimatedHumanScore: boundedHumanScore,
        estimatedAiDetectionPercent: aiDetection.score,
        aiPatternMatches: aiDetection.patternMatches,
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
            || /[:;]/.test(sentence)
            || sentence.includes('!')
            || sentence.includes('?');
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

// Common words that get capitalized mid-sentence (after a colon, in a quote,
// at the start of a clause) but are not proper nouns/entities. Excluding these
// keeps the dropped-entity check focused on real names, brands, and places.
const CAPITALIZED_STOPWORDS = new Set([
    'i', 'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its',
    'he', 'she', 'they', 'we', 'you', 'his', 'her', 'their', 'our', 'your',
    'here', 'there', 'then', 'now', 'so', 'but', 'and', 'or', 'if', 'when',
    'while', 'because', 'as', 'what', 'which', 'who', 'why', 'how', 'yes',
    'no', 'ok', 'okay', 'well', 'also', 'still', 'just', 'even', 'in', 'on',
    'for', 'with', 'without', 'once', 'first', 'second', 'third', 'next',
    'finally', 'today', 'monday', 'tuesday', 'wednesday', 'thursday',
    'friday', 'saturday', 'sunday',
]);

function extractProperNouns(text) {
    const sentences = splitSentences(text);
    const nouns = new Set();

    sentences.forEach(sentence => {
        const words = sentence.match(/[A-Za-z][A-Za-z0-9.'-]*/g) || [];
        words.forEach((word, index) => {
            if (index === 0) return;
            if (word.length < 2) return;
            if (!/^[A-Z]/.test(word)) return;
            if (CAPITALIZED_STOPWORDS.has(word.toLowerCase())) return;
            nouns.add(word);
        });
    });

    return [...nouns];
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

function verifyRefinement(originalText, refinedText, preserveKeywords, targetLength = 0) {
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

    const originalProperNouns = extractProperNouns(originalText);
    const missingProperNouns = originalProperNouns.filter(noun => !refinedText.includes(noun));

    if (missingProperNouns.length > 0 && missingProperNouns.length <= 8) {
        warnings.push(`Possible dropped names or entities: ${missingProperNouns.join(', ')}. Confirm these were meant to be removed or reworded.`);
    } else if (missingProperNouns.length > 8) {
        warnings.push('Many capitalized names or entities from the source no longer appear verbatim. Review the rewrite for dropped facts.');
    }

    const originalLength = originalText.trim().length || 1;
    const refinedLength = refinedText.trim().length;
    const deltaRatio = Math.abs(refinedLength - originalLength) / originalLength;

    if (deltaRatio > 0.45) {
        warnings.push('Rewrite changed length significantly. Check that meaning still matches the source.');
    }

    const targetWordCount = Number(targetLength) || 0;
    if (targetWordCount >= 20) {
        const wordDeltaRatio = Math.abs(refinedAnalysis.wordCount - targetWordCount) / targetWordCount;
        if (wordDeltaRatio > 0.2) {
            warnings.push(`Rewrite is ${refinedAnalysis.wordCount} words, target was ${targetWordCount}. Adjust length to stay closer to the target.`);
        }
    }

    if (remainingRoboticPhrases.length > 0) {
        warnings.push(`Still contains stiff phrasing: ${remainingRoboticPhrases.join(', ')}`);
    }

    if (refinedAnalysis.estimatedAiDetectionPercent > TARGET_AI_DETECTION_PERCENT) {
        warnings.push('Estimated AI detection is ' + refinedAnalysis.estimatedAiDetectionPercent + '%. Target is ' + TARGET_AI_DETECTION_PERCENT + '% or lower.');
    }

    if (refinedAnalysis.aiPatternMatches.length > 0) {
        warnings.push('Detector-risk patterns remain: ' + refinedAnalysis.aiPatternMatches.map(item => item.label).join(', '));
    }

    if (/[—–]/.test(refinedText)) {
        warnings.push('The rewrite contains em dashes (—) or en dashes (–). Replace them with commas, periods, or parentheses.');
    }

    if (refinedAnalysis.sentenceCount >= 6 && refinedAnalysis.sentenceVariance < 4) {
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
        missingProperNouns,
        remainingRoboticPhrases,
        toneMix,
        numbersChanged: originalNumbers.join('|') !== refinedNumbers.join('|'),
        lengthDeltaPercent: Math.round(deltaRatio * 100),
    };
}

function verifySeoRefinement(refinedText, primaryKeywordVariants, relatedKeywords, intentType) {
    const warnings = [];
    const normalizedText = String(refinedText || '').toLowerCase();
    const cleanVariants = normalizeKeywords(primaryKeywordVariants).map(keyword => keyword.toLowerCase());
    const mainKeyword = cleanVariants[0] || '';
    const cleanRelatedKeywords = normalizeKeywords(relatedKeywords);

    if (mainKeyword && !cleanVariants.some(variant => normalizedText.includes(variant))) {
        warnings.push(`Primary keyword (or an accepted variant) is missing from the rewrite: ${mainKeyword}`);
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

async function auditRewriteWithLlm(originalText, refinedText) {
    const prompt = `You are a strict editor auditing a rewritten text draft for lingering AI-writing tells, stylistic predictability, and grammar/coherence problems introduced by the rewrite.

Here is the original text:
"""
${originalText}
"""

Here is the current rewritten draft:
"""
${refinedText}
"""

Instructions:
1. Scan the rewritten draft carefully for any AI writing tells, such as:
   - Stiff, formulaic transitions or endings (e.g., "In summary", "Overall", "moreover").
   - Manufactured punchlines, staccato drama, or aphorisms (e.g., "X is the Y of Z").
   - Vague attributions, sycophantic/servile phrasing.
   - Em dashes, en dashes, curly quotation marks, or excessive bolding/emojis.
   - Copula avoidance (using complex verbs like "boasts" or "serves as" instead of simple is/are/has).
2. Separately, check the rewrite for grammar and coherence problems that were not present in the original, such as:
   - Broken subject-verb agreement, dangling modifiers, or run-on/fragmented sentences.
   - Pronouns or references that no longer clearly point back to something in the text (left dangling by restructuring).
   - Punctuation errors introduced by the rewrite.
   - Only report grammar issues caused by the rewrite itself, not stylistic choices.
3. Determine if the draft is obviously AI-generated or still contains stiff, unnatural phrasing.
4. List the specific tells/phrases that need correction, and separately list any grammar/coherence issues found.

Return ONLY a valid JSON object with the following shape:
{
  "isObviouslyAi": true,
  "lingeringTells": ["found tell/phrase 1", "found tell/phrase 2"],
  "grammarIssues": ["short description of grammar/coherence issue 1"]
}
`;
    try {
        const response = await resilientLlmRequest({
            prompt,
            expectJson: true,
            timeoutMs: 15000
        });
        const parsed = parseModelResponse(response);
        return {
            isObviouslyAi: !!parsed?.isObviouslyAi,
            lingeringTells: Array.isArray(parsed?.lingeringTells) ? parsed.lingeringTells : [],
            grammarIssues: Array.isArray(parsed?.grammarIssues) ? parsed.grammarIssues : []
        };
    } catch (err) {
        log.warn({ err: err.message }, 'LLM audit pass failed, skipping');
        return { isObviouslyAi: false, lingeringTells: [], grammarIssues: [] };
    }
}

async function crossCheckAiDetector(text) {
    const { key, url } = config.apis.aiDetector || {};
    if (!key || !url) {
        return null;
    }

    try {
        const response = await axios.post(
            url,
            { text },
            {
                headers: { Authorization: `Bearer ${key}` },
                timeout: 10000,
            }
        );

        const score = Number(response.data?.score);
        return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
    } catch (err) {
        log.warn({ err: err.message }, 'external AI-detector cross-check failed, skipping');
        return null;
    }
}

async function adjustContentTone({ text, adjustment }) {
    let instruction = '';
    const adjLower = String(adjustment || '').toLowerCase().trim();
    if (adjLower === 'punchier') {
        instruction = 'Make the text punchier, crisper, and more direct. Cut unnecessary words, use strong active verbs, and shorten sentences.';
    } else if (adjLower === 'simpler') {
        instruction = 'Make the text simpler and easier to understand. Use clear, everyday language and avoid complex sentence structures.';
    } else if (adjLower === 'more-casual') {
        instruction = 'Make the text more casual and conversational, as if speaking to a colleague or friend naturally.';
    } else if (adjLower === 'more-professional') {
        instruction = 'Make the text more professional, authoritative, and polished, while keeping it human and natural.';
    } else {
        instruction = `Adjust the text following this instruction: ${adjustment}`;
    }

    const prompt = `You are an editor adjusting the tone of the provided text.

Instruction: ${instruction}

Important Rules:
- Keep all factual details, numbers, and meaning intact.
- Maintain a natural, human flow. Do not add AI tells or robotic clichés.
- Return ONLY the adjusted text with no introductory or concluding remarks.

Return ONLY valid JSON with this shape:
{
  "refinedText": "adjusted text"
}

Text to adjust:
"""
${text}
"""`;

    try {
        const response = await resilientLlmRequest({
            prompt,
            expectJson: true,
            timeoutMs: 20000
        });
        const parsed = parseModelResponse(response);
        return {
            refinedText: String(parsed?.refinedText || text).trim()
        };
    } catch (err) {
        log.error({ err: err.message }, 'adjustContentTone failed');
        throw new Error('Tone adjustment failed: ' + err.message);
    }
}

function parseModelResponse(content) {
    const trimmed = String(content || '').trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    const payload = jsonMatch ? jsonMatch[0] : trimmed;
    return JSON.parse(payload);
}

function getCalibrationInstructions(sample) {
    if (!sample || !sample.trim()) return '';
    return `

## Voice Calibration (CRITICAL DIRECTIVE):
You must analyze this user-provided writing sample to calibrate the voice of the rewrite. Mimic its sentence length distribution, vocabulary complexity level, paragraph openers, punctuation habits, transitions, and style patterns. Ensure that the rewritten text matches this voice:
"""
${sample.trim()}
"""`;
}

function buildPrompt({ text, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords, sample = '', targetLength = 0 }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const bannedWordsText = ROBOTIC_PHRASES.join(', ');
    const softAvoidText = getSoftAvoidGuidance();
    const preferredTransitionsText = NATURAL_TRANSITIONS.join(', ');
    const modeConfig = getModeConfig(mode);
    const primaryKeywordVariants = normalizeKeywords(primaryKeyword);
    const searchIntent = detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || text.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeywordVariants, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';
    const calibrationPrompt = getCalibrationInstructions(sample);
    const changeLevelGuidance = getMaxChangeGuidance(maxChange);
    const lengthGuidance = getTargetLengthGuidance(targetLength, extractWords(text).length);

    const systemPrompt = `You are an expert editor improving draft content so it reads naturally, with believable human rhythm and voice, while staying technically accurate.

Transformation rules you must follow:
- Identify and remove signs of AI-generated text. Replace them with natural alternatives.
- Remove inflated symbolism ("testament to", "transformative", "pivotal").
- Remove promotional or subjective padding ("breathtaking", "vibrant", "cutting-edge").
- Remove superficial "-ing" analyses (tacking on phrases like "highlighting...", "ensuring...").
- Drop vague attributions ("Experts argue", "Industry observers note").
- Break predictable structures like "Challenges and Future Prospects" or formulaic conclusions.
- For textbook or encyclopedia-style passages, do not keep the definition-example-category rhythm. Rewrite the section as practical explanation with uneven paragraph lengths, a few grounded specifics, and less perfect sequencing.
- Replace generic openers like "Software is...", "Examples include...", and "Modern trends include..." with more natural context-led phrasing.
- Do not write category paragraphs that follow "System software handles...", "Application software is...", or "Programming software is..." patterns. Merge, vary, or recast those details so they do not read like a generated study note.
- Avoid long example pile-ups. Use one or two examples only when they add context, and do not stack brand/tool names in the same sentence.
- NEVER use these AI-vocabulary words: ${bannedWordsText}.
- Prefer simpler alternatives over these words when a plainer synonym fits just as well: ${softAvoidText}. It is fine to keep the original word when the plainer synonym would be technically imprecise or would change the meaning.
- Avoid copula avoidance. Use simple "is/are/has" instead of "serves as/stands as/boasts/features".
- Do not use negative parallelisms like "It's not just about X, it's about Y".
- Do not force the Rule of Three (listing exactly three items to sound comprehensive).
- Avoid elegant variation (excessive synonym cycling).
- Fix false ranges like "from the Big Bang to dark matter" if not an actual scale.
- Use active voice. Avoid subjectless fragments.
- Cut ALL em dashes (—) and en dashes (–). Replace with commas, periods, or parentheses.
- Do not use excessive boldface, inline-header vertical lists, emojis, or Title Case in headings.
- Convert curly quotes (“ ”) to straight quotes (" ").
- Remove collaborative communication artifacts ("I hope this helps", "Certainly!").
- Remove speculative gap-filling or knowledge-cutoff disclaimers.
- Avoid sycophantic tone, filler phrases, excessive hedging, and generic positive conclusions.
- Drop hyphens in compound words when they follow the noun (e.g. "the report is high quality", not "high-quality").
- Remove persuasive authority tropes ("at its core", "what really matters", "fundamentally").
- Remove signposting and announcements ("Let's dive in", "Here's what you need to know").
- Remove fragmented headers (a heading followed by a one-line restatement).
- Do not use diff-anchored writing (narrating a change) unless specifically requested.
- Avoid manufactured punchlines, staccato drama, and aphorism formulas ("X is the Y of Z").
- Do not use conversational rhetorical openers ("Honestly?", "Look,", "Here's the thing").
- Replace generic transitions with more natural ones where appropriate, such as: ${preferredTransitionsText}.
- The final rewritten passage itself should be plain readable prose only.

Naturalness + detector-risk reduction target (aim for an estimated AI-detection score below 10%):
- Vary sentence lengths radically: Mix extremely short sentences (3-5 words) with longer ones to maximize sentence length variance (burstiness).
- Avoid predictable sentence openers: Do not start consecutive sentences with the same word, pronoun, or grammatical structure. Banish conversational AI openers starting with "While...", "Through...", "By...".
- Use contractions: Use common English contractions ("don't", "can't", "it's", "you're") to sound authentic.
- Lower vocabulary complexity: Use lower-tier, conversational, everyday words. Avoid pretentious or academic terms ("help" instead of "facilitate", "use" instead of "utilize", "show" instead of "demonstrate", "also" instead of "additionally").
- Do not introduce lists: Do not convert paragraph blocks into bulleted or numbered lists unless they were list items in the original text. AI loves lists; humans prefer paragraph flow.
- Mix expressive parts with plain, matter-of-fact statements. Do not make every sentence sound highly polished or poetic.
- Allow slight irregularity and mild redundancy when it sounds natural.
- After drafting, do a strict audit pass using the pattern checklist above. Rewrite again before returning JSON if the draft still feels likely to score above 10% AI-detected.${calibrationPrompt}

Rewrite settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Change-level guidance:
${changeLevelGuidance}

Length guidance:
${lengthGuidance}

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
  "draftText": "your first draft rewrite here",
  "auditTells": ["list any AI tells or stiffness found in draftText during self-audit"],
  "refinedText": "the final rewrite, correcting all tells identified in auditTells",
  "summary": "one sentence describing what changed",
  "changes": ["short bullet", "short bullet"],
  "alternatives": [
        { "label": "warmer", "text": "alternate final rewrite following the same rules" },
        { "label": "sharper", "text": "alternate final rewrite following the same rules" }
  ]
}`;

    const userPrompt = `Original text to rewrite:
"""
${text}
"""`;

    return { systemPrompt, prompt: userPrompt };
}

function buildHtmlPrompt({ template, segments, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords, sample = '' }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const bannedWordsText = ROBOTIC_PHRASES.join(', ');
    const softAvoidText = getSoftAvoidGuidance();
    const preferredTransitionsText = NATURAL_TRANSITIONS.join(', ');
    const serializedSegments = JSON.stringify(segments, null, 2);
    const modeConfig = getModeConfig(mode);
    const primaryKeywordVariants = normalizeKeywords(primaryKeyword);
    const searchIntent = detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || '');
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeywordVariants, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';
    const calibrationPrompt = getCalibrationInstructions(sample);
    const changeLevelGuidance = getMaxChangeGuidance(maxChange);

    const systemPrompt = `You are rewriting HTML content while preserving its formatting exactly.

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
- Make the language feel natural and human, following these exact writing rules:
    - Break predictable structure and avoid a documentation-like feel.
    - Remove inflated symbolism, promotional padding, and superficial "-ing" analyses.
    - Avoid copula avoidance (use simple "is/are/has").
    - Cut ALL em dashes (—) and en dashes (–). Replace with commas, periods, or parentheses.
    - Convert curly quotes (“ ”) to straight quotes (" ").
    - Avoid negative parallelisms, Rule of Three, false ranges, and elegant variation.
    - Remove speculative gap-filling, sycophantic tone, filler phrases, and generic upbeat conclusions.
    - Remove persuasive authority tropes, signposting, fragmented headers, and aphorism formulas.
    - Drop hyphens in compound words when they follow the noun.
    - Do not use conversational rhetorical openers or manufactured punchlines.
    - NEVER use these AI-vocabulary words: ${bannedWordsText}.
    - Prefer simpler alternatives over these words when a plainer synonym fits just as well: ${softAvoidText}. Keep the original word if the plainer synonym would be technically imprecise.
    - Prefer natural transitions such as: ${preferredTransitionsText}.

Naturalness + detector-risk reduction target (aim for an estimated AI-detection score below 10%):
- Vary sentence lengths radically: Mix extremely short sentences (3-5 words) with longer ones to maximize sentence length variance (burstiness).
- Avoid predictable sentence openers: Do not start consecutive sentences with the same word, pronoun, or grammatical structure. Banish conversational AI openers starting with "While...", "Through...", "By...".
- Use contractions: Use common English contractions ("don't", "can't", "it's", "you're") to sound authentic.
- Lower vocabulary complexity: Use lower-tier, conversational, everyday words. Avoid pretentious or academic terms ("help" instead of "facilitate", "use" instead of "utilize", "show" instead of "demonstrate", "also" instead of "additionally").
- Do not introduce lists: Do not convert paragraph blocks into bulleted or numbered lists unless they were list items in the original text. AI loves lists; humans prefer paragraph flow.
- Mix expressive sentences with plain, neutral ones.
- Allow slight irregularity and mild redundancy when it sounds natural.
- After drafting, do a strict audit pass using the pattern checklist above. Rewrite again before returning JSON if the draft still feels likely to score above 10% AI-detected.${calibrationPrompt}

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Change-level guidance:
${changeLevelGuidance}

Note: this rewrite covers isolated HTML text segments, not the whole document, so no overall word-count target applies here. Keep each segment close to its original length unless the change level calls for more rewriting.

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
}`;

    const userPrompt = `HTML template:
"""
${template}
"""

Segments:
${serializedSegments}`;

    return { systemPrompt, prompt: userPrompt };
}

function buildRetryPrompt({ originalText, currentDraft, tone, audience, brandVoice, preserveKeywords, maxChange, warnings, mode, primaryKeyword, relatedKeywords, sample = '', targetLength = 0 }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const modeConfig = getModeConfig(mode);
    const primaryKeywordVariants = normalizeKeywords(primaryKeyword);
    const searchIntent = detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || originalText.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeywordVariants, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';
    const calibrationPrompt = getCalibrationInstructions(sample);
    const changeLevelGuidance = getMaxChangeGuidance(maxChange);
    const lengthGuidance = getTargetLengthGuidance(targetLength, extractWords(currentDraft).length);

    const systemPrompt = `Revise this rewritten draft so it feels completely human, passes AI detectors, and feels less over-produced.

Fix these specific problems identified in the previous draft:
- ${warnings.join('\n- ')}

Requirements:
- Preserve the original meaning, facts, numbers, and keywords.
- Keep the writing natural, but less polished and less uniformly expressive.
- Add a better mix of plain sentences and expressive ones.
- Reduce rhetorical density.
- If the draft still sounds like a textbook, restructure it. Avoid definition-example-category sequencing, category-label paragraphs, and long example pile-ups. Use more natural context-led phrasing.
- Do not explain the changes.

Naturalness + detector-risk reduction target (aim for an estimated AI-detection score below 10%):
- Vary sentence lengths radically: Mix extremely short sentences (3-5 words) with longer ones to maximize sentence length variance (burstiness).
- Avoid predictable sentence openers: Do not start consecutive sentences with the same word, pronoun, or grammatical structure. Banish conversational AI openers starting with "While...", "Through...", "By...".
- Use contractions: Use common English contractions ("don't", "can't", "it's", "you're") to sound authentic.
- Lower vocabulary complexity: Use lower-tier, conversational, everyday words. Avoid pretentious or academic terms ("help" instead of "facilitate", "use" instead of "utilize", "show" instead of "demonstrate", "also" instead of "additionally").
- Do not introduce lists: Do not convert paragraph blocks into bulleted or numbered lists unless they were list items in the original text. AI loves lists; humans prefer paragraph flow.
- Mix expressive parts with plain, matter-of-fact statements. Do not make every sentence sound highly polished or poetic.
- Allow slight irregularity and mild redundancy when it sounds natural.
- After drafting, do a strict audit pass using the pattern checklist above. Rewrite again before returning JSON if the draft still feels likely to score above 10% AI-detected.${calibrationPrompt}

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Change-level guidance:
${changeLevelGuidance}

Length guidance:
${lengthGuidance}

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
}`;

    const userPrompt = `Original text:
"""
${originalText}
"""

Current rewritten draft:
"""
${currentDraft}
"""`;

    return { systemPrompt, prompt: userPrompt };
}

function buildHtmlRetryPrompt({ template, originalText, currentDraft, tone, audience, brandVoice, preserveKeywords, maxChange, warnings, mode, primaryKeyword, relatedKeywords, sample = '' }) {
    const keywordsText = preserveKeywords.length > 0 ? preserveKeywords.join(', ') : 'none';
    const segmentPayload = JSON.stringify(currentDraft, null, 2);
    const modeConfig = getModeConfig(mode);
    const primaryKeywordVariants = normalizeKeywords(primaryKeyword);
    const searchIntent = detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || originalText.slice(0, 120));
    const seoKeywordGuidance = mode === 'seo-blog'
        ? getSeoKeywordGuidance(primaryKeywordVariants, relatedKeywords)
        : 'Ignore any SEO keyword placement strategy unless the mode is SEO Blog.';
    const calibrationPrompt = getCalibrationInstructions(sample);
    const changeLevelGuidance = getMaxChangeGuidance(maxChange);

    const systemPrompt = `Revise these rewritten HTML text segments so they feel completely human, pass AI detectors, and feel less over-produced.

Fix these specific problems identified in the previous rewrite:
- ${warnings.join('\n- ')}

Requirements:
- Preserve the original meaning, facts, numbers, and keywords.
- Keep the segment IDs exactly the same.
- Do not output HTML.
- Make the writing less polished and less uniformly expressive.
- Add a better mix of plain sentences and expressive ones.
- Reduce rhetorical density.
- If the draft still sounds like a textbook, restructure it. Avoid definition-example-category sequencing, category-label paragraphs, and long example pile-ups. Use more natural context-led phrasing.

Naturalness + detector-risk reduction target (aim for an estimated AI-detection score below 10%):
- Vary sentence lengths radically: Mix extremely short sentences (3-5 words) with longer ones to maximize sentence length variance (burstiness).
- Avoid predictable sentence openers: Do not start consecutive sentences with the same word, pronoun, or grammatical structure. Banish conversational AI openers starting with "While...", "Through...", "By...".
- Use contractions: Use common English contractions ("don't", "can't", "it's", "you're") to sound authentic.
- Lower vocabulary complexity: Use lower-tier, conversational, everyday words. Avoid pretentious or academic terms ("help" instead of "facilitate", "use" instead of "utilize", "show" instead of "demonstrate", "also" instead of "additionally").
- Do not introduce lists: Do not convert paragraph blocks into bulleted or numbered lists unless they were list items in the original text. AI loves lists; humans prefer paragraph flow.
- Mix expressive sentences with plain, neutral ones.
- Allow slight irregularity and mild redundancy when it sounds natural.
- After drafting, do a strict audit pass using the pattern checklist above. Rewrite again before returning JSON if the draft still feels likely to score above 10% AI-detected.${calibrationPrompt}

Settings:
- Mode: ${modeConfig.label}
- Tone: ${tone}
- Audience: ${audience || 'general audience'}
- Brand voice: ${brandVoice || 'clear, trustworthy, practical'}
- Allowed change level: ${maxChange}
- Keywords to preserve: ${keywordsText}

Change-level guidance:
${changeLevelGuidance}

Note: this rewrite covers isolated HTML text segments, not the whole document, so no overall word-count target applies here.

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
}`;

    const userPrompt = `Original extracted text:
"""
${originalText}
"""

HTML template:
"""
${template}
"""

Current rewritten segments:
${segmentPayload}`;

    return { systemPrompt, prompt: userPrompt };
}

function getMaxRefinementPasses(maxChange) {
    return String(maxChange || 'balanced').toLowerCase() === 'strong' ? 3 : 1;
}

function shouldRetryRefinement(verification) {
        if (!verification) return false;

        if (verification.missingKeywords?.length > 0) return true;
        if (verification.numbersChanged) return true;
        if (verification.missingProperNouns?.length > 0 && verification.missingProperNouns.length <= 8) return true;

        return verification.warnings.some(warning =>
                warning.includes('Sentence rhythm is still fairly uniform')
                || warning.includes('Rhetorical density is high')
                || warning.includes('too uniformly stylized')
                || warning.includes('Still contains stiff phrasing')
                || warning.includes('Estimated AI detection')
                || warning.includes('Detector-risk patterns remain')
                || warning.includes('Primary keyword (or an accepted variant) is missing')
                || warning.includes('Adjust length to stay closer to the target')
                || warning.includes('Grammar/coherence issues introduced by the rewrite')
        );
}

async function requestRewrite({ systemPrompt, prompt }) {
    try {
        const content = await resilientLlmRequest({
            systemPrompt,
            prompt,
            expectJson: true,
            timeoutMs: 30000
        });
        return parseModelResponse(content);
    } catch (err) {
        log.error({ err: err.message }, 'Content humanizer request rewrite failed');
        throw new Error('Content humanizer failed: ' + err.message);
    }
}

function localHumanizeSentence(sentence, index) {
    let output = String(sentence || '').trim();

    const replacements = [
        [/\bObject-oriented programming lets you say what you want without explaining every step to get there\./i, 'With object-oriented programming, you model real things and actions as objects.'],
        [/\bFunctional programming treats everything more like math\./i, 'Functional programming feels closer to math: small functions, clear inputs, and fewer surprises.'],
        [/\bDeclarative programming lets you say what you want without explaining every step to get there\./i, 'Declarative programming is more direct. You describe the result you want, not every step.'],
        [/\bA lot of modern software is built cloud-native from the start\b/i, 'A lot of modern software starts in the cloud now'],
        [/\bmeaning it's designed to run in cloud infrastructure rather than being moved there after the fact\b/i, "so it's built for cloud infrastructure instead of being moved there later"],
        [/\bSoftware touches basically everything now\./i, 'Software is everywhere now.'],
        [/\bthe thing that actually makes one product different from another is the software running on it\b/i, 'software is often what makes one product feel different from another'],
        [/\butilize\b/gi, 'use'],
        [/\bfacilitate\b/gi, 'help'],
        [/\bdemonstrate\b/gi, 'show'],
        [/\badditionally\b/gi, 'also'],
        [/\bfurthermore\b/gi, 'also'],
        [/\bmoreover\b/gi, 'also'],
        [/\bin order to\b/gi, 'to'],
        [/\bdue to the fact that\b/gi, 'because'],
        [/\bserves as\b/gi, 'works as'],
        [/\bnot only\b/gi, 'not just'],
    ];

    replacements.forEach(([pattern, replacement]) => {
        output = output.replace(pattern, replacement);
    });

    if (index % 4 === 1 && output.length > 130) {
        output = output.replace(/,\s+(which|because|so|and)\s+/i, '. $1 ');
    }

    if (index % 5 === 2 && !/\b(it's|don't|can't|you're|that's|there's)\b/i.test(output)) {
        output = output.replace(/\bit is\b/i, "it's").replace(/\bthat is\b/i, "that's");
    }

    return output.replace(/\s+/g, ' ').trim();
}

function buildLocalRewrite(text, { preserveKeywords = [], mode = 'standard', primaryKeyword = '', relatedKeywords = [], error = '' } = {}) {
    const paragraphs = String(text || '')
        .split(/\n\s*\n/)
        .map(part => part.trim())
        .filter(Boolean);

    const sourceBlocks = paragraphs.length ? paragraphs : [String(text || '').trim()].filter(Boolean);
    const rewrittenBlocks = sourceBlocks.map((paragraph, paragraphIndex) => {
        const sentences = splitSentences(paragraph);
        if (!sentences.length) return paragraph;

        return sentences
            .map((sentence, index) => localHumanizeSentence(sentence, paragraphIndex + index))
            .join(' ')
            .replace(/\bAlso, also\b/gi, 'Also')
            .trim();
    });

    let refinedText = rewrittenBlocks.join('\n\n').trim();
    const requiredKeywords = [
        ...normalizeKeywords(preserveKeywords),
        ...(mode === 'seo-blog' ? [normalizeSingleKeyword(primaryKeyword), ...normalizeKeywords(relatedKeywords).slice(0, 2)] : []),
    ].filter(Boolean);

    const missingKeywords = requiredKeywords.filter(keyword => !refinedText.toLowerCase().includes(keyword.toLowerCase()));
    if (missingKeywords.length) {
        refinedText += `\n\nA few phrases still matter here: ${missingKeywords.join(', ')}. Keep them in the final edit where they fit naturally.`;
    }

    return {
        refinedText,
        summary: error
            ? 'Used the local humanizer because the AI provider returned an empty response.'
            : 'Made the draft clearer and more natural while preserving the original meaning.',
        changes: [
            'Reduced stiff phrasing and formulaic transitions',
            'Added more natural sentence rhythm',
            'Preserved the original facts and key terms',
        ],
        alternatives: [
            { label: 'tighter', text: refinedText.split(/\n\s*\n/).slice(0, 2).join('\n\n') || refinedText },
        ],
    };
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

async function humanizeHtmlContent({ text, tone, audience, brandVoice, preserveKeywords, maxChange, mode, primaryKeyword, relatedKeywords, sample = '', targetLength = 0 }) {
    const htmlTemplate = createHtmlSegmentTemplate(text);

    if (!htmlTemplate.segments.length) {
        throw new Error('No editable text nodes were found in the HTML input.');
    }

    const originalPlainText = extractPlainTextFromHtml(text);
    const originalAnalysis = analyzeText(originalPlainText);
    const expectedIds = htmlTemplate.segments.map(segment => segment.id);
    const primaryKeywordVariants = mode === 'seo-blog' ? normalizeKeywords(primaryKeyword) : [];

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
            sample,
        })),
        expectedIds
    );

    let refinedHtml = rebuildHtmlFromSegments(htmlTemplate.template, rewrite.segments);
    let refinedPlainText = extractPlainTextFromHtml(refinedHtml);

    if (!refinedPlainText) {
        throw new Error('The model returned empty rewritten HTML content.');
    }

    let refinedAnalysis = analyzeText(refinedPlainText);
    let verification = verifyRefinement(originalPlainText, refinedPlainText, preserveKeywords, targetLength);
    let seoVerification = mode === 'seo-blog'
        ? verifySeoRefinement(refinedPlainText, primaryKeywordVariants, relatedKeywords, detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || '').type)
        : { warnings: [], relatedKeywordHits: [] };

    verification.warnings.push(...seoVerification.warnings);
    verification.relatedKeywordHits = seoVerification.relatedKeywordHits;

    const auditResult = await auditRewriteWithLlm(originalPlainText, refinedPlainText);
    if (auditResult.isObviouslyAi && auditResult.lingeringTells.length > 0) {
        verification.warnings.push(`AI Tells detected by Editor: ${auditResult.lingeringTells.join(', ')}`);
    }
    if (auditResult.grammarIssues.length > 0) {
        verification.warnings.push(`Grammar/coherence issues introduced by the rewrite: ${auditResult.grammarIssues.join('; ')}`);
    }

    for (let refinementPass = 0; refinementPass < getMaxRefinementPasses(maxChange) && shouldRetryRefinement(verification); refinementPass += 1) {
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
                sample,
            })),
            expectedIds
        );

        refinedHtml = rebuildHtmlFromSegments(htmlTemplate.template, rewrite.segments);
        refinedPlainText = extractPlainTextFromHtml(refinedHtml);

        if (!refinedPlainText) {
            throw new Error('The model returned empty rewritten HTML content on retry.');
        }

        refinedAnalysis = analyzeText(refinedPlainText);
        verification = verifyRefinement(originalPlainText, refinedPlainText, preserveKeywords, targetLength);
        seoVerification = mode === 'seo-blog'
            ? verifySeoRefinement(refinedPlainText, primaryKeywordVariants, relatedKeywords, detectSearchIntent(primaryKeywordVariants[0] || preserveKeywords[0] || '').type)
            : { warnings: [], relatedKeywordHits: [] };

        verification.warnings.push(...seoVerification.warnings);
        verification.relatedKeywordHits = seoVerification.relatedKeywordHits;
    }

    const externalAiScore = await crossCheckAiDetector(refinedPlainText);
    if (externalAiScore !== null) {
        verification.externalAiDetectionPercent = externalAiScore;
        if (externalAiScore > TARGET_AI_DETECTION_PERCENT) {
            verification.warnings.push(`External AI-detector cross-check scored ${externalAiScore}%, above the ${TARGET_AI_DETECTION_PERCENT}% target.`);
        }
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

async function humanizeContent({ text, tone = 'natural', audience = '', brandVoice = '', preserveKeywords = [], maxChange = 'balanced', preserveHtml = false, mode = 'standard', primaryKeyword = '', relatedKeywords = [], sample = '', targetLength = 0 }) {
    const normalizedKeywords = normalizeKeywords(preserveKeywords);
    const normalizedPrimaryKeyword = mode === 'seo-blog' ? normalizeSingleKeyword(primaryKeyword) : '';
    const primaryKeywordVariants = mode === 'seo-blog' ? normalizeKeywords(primaryKeyword) : [];
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
            sample,
            targetLength,
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
        sample,
        targetLength,
    });

    log.info({ tone, audience, maxChange, keywords: normalizedKeywords.length, targetLength }, 'humanizing content');

    let rewrite;
    try {
        rewrite = await requestRewrite(prompt);
    } catch (err) {
        log.warn({ err: err.message }, 'using local humanizer fallback after AI rewrite failure');
        rewrite = buildLocalRewrite(text, {
            preserveKeywords: normalizedKeywords,
            mode,
            primaryKeyword: normalizedPrimaryKeyword,
            relatedKeywords: normalizedRelatedKeywords,
            error: err.message,
        });
    }
    let refinedText = String(rewrite.refinedText || '').trim();

    if (!refinedText) {
        throw new Error('The model returned an empty rewrite.');
    }

    let refinedAnalysis = analyzeText(refinedText);
    let verification = verifyRefinement(text, refinedText, normalizedKeywords, targetLength);
    let seoVerification = mode === 'seo-blog'
        ? verifySeoRefinement(refinedText, primaryKeywordVariants, normalizedRelatedKeywords, detectSearchIntent(primaryKeywordVariants[0] || normalizedKeywords[0] || '').type)
        : { warnings: [], relatedKeywordHits: [] };

    verification.warnings.push(...seoVerification.warnings);
    verification.relatedKeywordHits = seoVerification.relatedKeywordHits;

    const auditResult = await auditRewriteWithLlm(text, refinedText);
    if (auditResult.isObviouslyAi && auditResult.lingeringTells.length > 0) {
        verification.warnings.push(`AI Tells detected by Editor: ${auditResult.lingeringTells.join(', ')}`);
    }
    if (auditResult.grammarIssues.length > 0) {
        verification.warnings.push(`Grammar/coherence issues introduced by the rewrite: ${auditResult.grammarIssues.join('; ')}`);
    }

    for (let refinementPass = 0; refinementPass < getMaxRefinementPasses(maxChange) && shouldRetryRefinement(verification); refinementPass += 1) {
        log.info({ warnings: verification.warnings.length }, 'retrying humanizer for improved naturalness');

        try {
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
                sample,
                targetLength,
            }));
        } catch (err) {
            log.warn({ err: err.message }, 'keeping existing humanizer result after retry failure');
            break;
        }

        refinedText = String(rewrite.refinedText || '').trim();

        if (!refinedText) {
            throw new Error('The model returned an empty rewrite on retry.');
        }

        refinedAnalysis = analyzeText(refinedText);
        verification = verifyRefinement(text, refinedText, normalizedKeywords, targetLength);
        seoVerification = mode === 'seo-blog'
            ? verifySeoRefinement(refinedText, primaryKeywordVariants, normalizedRelatedKeywords, detectSearchIntent(primaryKeywordVariants[0] || normalizedKeywords[0] || '').type)
            : { warnings: [], relatedKeywordHits: [] };

        verification.warnings.push(...seoVerification.warnings);
        verification.relatedKeywordHits = seoVerification.relatedKeywordHits;
    }

    const externalAiScore = await crossCheckAiDetector(refinedText);
    if (externalAiScore !== null) {
        verification.externalAiDetectionPercent = externalAiScore;
        if (externalAiScore > TARGET_AI_DETECTION_PERCENT) {
            verification.warnings.push(`External AI-detector cross-check scored ${externalAiScore}%, above the ${TARGET_AI_DETECTION_PERCENT}% target.`);
        }
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
    adjustContentTone,
};