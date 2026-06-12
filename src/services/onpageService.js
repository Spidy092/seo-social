/**
 * 🔍 On-Page SEO Service
 * Runs all 47 checks across 10 categories
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { extractDomain } = require('../utils/domainUtils');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
];
const getRandUA = () => USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

// ─── Main Analyzer ───────────────────────────────────────────────────────────
async function analyzeOnPage(urlOrHtml, keyword = '', isHtml = false) {
    let $, rawHtml = '', pageUrl = '', finalUrl = '';

    if (isHtml) {
        rawHtml = urlOrHtml;
        $ = cheerio.load(rawHtml);
        pageUrl = '';
        finalUrl = '';
    } else {
        pageUrl = urlOrHtml;
        try {
            const res = await axios.get(pageUrl, {
                headers: { 'User-Agent': getRandUA(), 'Accept': 'text/html' },
                timeout: 20000,
                maxRedirects: 10,
                validateStatus: s => s < 500,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
            });
            rawHtml = res.data;
            finalUrl = res.request?.res?.responseUrl || pageUrl;
            $ = cheerio.load(rawHtml);
        } catch (err) {
            throw new Error('Could not fetch URL: ' + err.message);
        }
    }

    const url = finalUrl || pageUrl;
    const kw = keyword.toLowerCase().trim();
    const kwWords = kw.split(/\s+/).filter(Boolean);

    // ── Extract raw data ──────────────────────────────────────────────────────
    const title        = $('title').first().text().trim();
    const metaDesc     = $('meta[name="description"]').attr('content') || '';
    const canonical    = $('link[rel="canonical"]').attr('href') || '';
    const robots       = $('meta[name="robots"]').attr('content') || '';
    const viewport     = $('meta[name="viewport"]').attr('content') || '';
    const langAttr     = $('html').attr('lang') || '';
    // E-E-A-T author signals
    const metaAuthor   = $('meta[name="author"]').attr('content') || '';
    const relAuthor    = $('link[rel="author"]').attr('href') || '';
    const hasAuthor    = !!(metaAuthor || relAuthor);
    const ogTitle      = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc       = $('meta[property="og:description"]').attr('content') || '';
    const ogImage      = $('meta[property="og:image"]').attr('content') || '';
    // Twitter / X card tags
    const twitterCard  = $('meta[name="twitter:card"]').attr('content') || '';
    const twitterTitle = $('meta[name="twitter:title"]').attr('content') || '';
    const twitterImage = $('meta[name="twitter:image"]').attr('content') || '';

    // Headings
    const h1s   = $('h1').map((_, el) => $(el).text().trim()).get();
    const h2s   = $('h2').map((_, el) => $(el).text().trim()).get();
    const h3s   = $('h3').map((_, el) => $(el).text().trim()).get();
    const h4s   = $('h4').map((_, el) => $(el).text().trim()).get();

    // Body text — strip non-content elements before extracting to avoid inflating word count
    // with cookie banners, sidebars, comments, hidden elements, and decorative content.
    $([
        'script', 'style',                      // code
        'nav', 'header', 'footer',               // chrome
        'aside',                                 // sidebars/widgets
        '.cookie-banner', '.cookie-notice',      // cookie popups
        '[aria-hidden="true"]',                  // decorative / screen-reader-hidden
        'form',                                  // forms add stop words, not content
        '#comments', '.comments-section',        // blog comments
        'noscript',                              // fallback content
    ].join(',')).remove();
    const bodyText  = $('body').text().replace(/\s+/g, ' ').trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    const first100  = bodyText.split(/\s+/).slice(0, 100).join(' ').toLowerCase();

    // Images
    const allImgs = $('img').map((_, el) => ({
        src:    $(el).attr('src') || '',
        alt:    $(el).attr('alt'),
        width:  $(el).attr('width'),
        height: $(el).attr('height'),
        loading:$(el).attr('loading'),
    })).get();

    // Links
    const domain = url ? extractDomain(url) : '';
    const allLinks = $('a[href]').map((_, el) => ({
        href:   $(el).attr('href') || '',
        text:   $(el).text().trim(),
        target: $(el).attr('target') || '',
        rel:    $(el).attr('rel')   || '',
    })).get();
    const internalLinks = allLinks.filter(l =>
        l.href.startsWith('/') || (domain && l.href.includes(domain))
    );
    const externalLinks = allLinks.filter(l =>
        l.href.startsWith('http') && domain && !l.href.includes(domain)
    );

    // Schema
    const schemaScripts = [];
    const schemaTypes   = [];
    let schemaValid     = true;
    const schemaValidationResults = [];
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse($(el).html());
            const items  = Array.isArray(parsed) ? parsed : [parsed];
            items.forEach(item => {
                if (item['@type']) {
                    const types = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
                    types.forEach(t => schemaTypes.push(t));
                }
                if (item['@graph']) {
                    item['@graph'].forEach(g => {
                        if (g['@type']) {
                            const ts = Array.isArray(g['@type']) ? g['@type'] : [g['@type']];
                            ts.forEach(t => schemaTypes.push(t));
                        }
                    });
                }
                schemaScripts.push(item);
                const validation = validateSchema(item);
                if (validation) schemaValidationResults.push(validation);
            });
        } catch { schemaValid = false; }
    });

    // Breadcrumb
    const hasBreadcrumbNav    = $('nav[aria-label*="breadcrumb" i], .breadcrumb, [class*="breadcrumb"]').length > 0;
    const hasBreadcrumbSchema = schemaTypes.includes('BreadcrumbList');

    // Keyword checks
    const kwInTitle    = kw && title.toLowerCase().includes(kw);
    const kwPosInTitle = kw && title.toLowerCase().indexOf(kw);
    const kwInDesc     = kw && metaDesc.toLowerCase().includes(kw);
    const kwInH1       = kw && h1s.some(h => h.toLowerCase().includes(kw));
    const kwInFirst100 = kw && first100.includes(kw);
    const kwMatches    = kw ? (bodyText.toLowerCase().match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length : 0;
    // Keyword density = phrase occurrences / total words (industry-standard definition).
    // Previously multiplied by kwWords.length which inflated density for multi-word keywords.
    const kwDensity    = wordCount > 0 ? parseFloat((kwMatches / wordCount * 100).toFixed(2)) : 0;

    // Heading order check
    const headingOrder = checkHeadingOrder($);

    // Flesch reading ease (approximate)
    const sentences    = bodyText.split(/[.!?]+/).filter(s => s.trim().length > 10).length;
    const syllables    = countSyllables(bodyText);
    const flesch       = sentences > 0 && wordCount > 0
        ? Math.round(206.835 - 1.015 * (wordCount / sentences) - 84.6 * (syllables / wordCount))
        : 0;

    // FAQ detection
    const hasFaq = bodyText.toLowerCase().includes('faq') ||
        h2s.concat(h3s).some(h => /faq|frequent|question/i.test(h));

    // HTTPS
    const isHttps = url.startsWith('https://') || isHtml;

    // hreflang links (multi-region/multi-language signal)
    const hreflangLinks = $('link[rel="alternate"][hreflang]').map((_, el) => ({
        hreflang: $(el).attr('hreflang') || '',
        href:     $(el).attr('href') || '',
    })).get();
    const hasHreflang = hreflangLinks.length > 0;

    // Sitemap link in <head>
    const sitemapLink = $('head link[rel="sitemap"]').attr('href') || '';
    const hasSitemapLink = !!sitemapLink;

    // Render-blocking scripts
    const headScripts = [];
    $('head script[src]:not([async]):not([defer])').each((_, el) => {
        headScripts.push($(el).attr('src') || '');
    });

    // Image alt text quality
    const imgsNoAlt      = allImgs.filter(i => i.alt === undefined || i.alt === '');
    const imgsNoDimension = allImgs.filter(i => !i.width || !i.height);
    const imgsNoLazy     = allImgs.filter(i => i.loading !== 'lazy');
    const kwInAnyAlt     = kw && allImgs.some(i => (i.alt || '').toLowerCase().includes(kw));
    // Detect generic/meaningless alt text (passes "has alt" check but provides zero SEO value)
    const GENERIC_ALT_RE = /^(image|img|photo|banner|picture|pic|icon|logo\d*|graphic|thumbnail|undefined|null|\.(jpg|jpeg|png|webp|gif|svg))$/i;
    const imgsGenericAlt = allImgs.filter(i => i.alt && GENERIC_ALT_RE.test(i.alt.trim()));

    // URL checks
    const urlPath        = url ? (new URL(url.startsWith('http') ? url : 'https://example.com').pathname) : '';
    const urlHasKw       = kw && urlPath.toLowerCase().includes(kwWords[0] || kw);
    const urlLength      = urlPath.length;
    const urlHasHyphen   = !urlPath.includes('_');
    const urlLower       = urlPath === urlPath.toLowerCase();
    const urlHasSpecial  = /[?&%#]/.test(urlPath);

    // Internal link anchor text
    const weakAnchors    = internalLinks.filter(l =>
        /^(click here|here|read more|more|link)$/i.test(l.text)
    );
    const brokenInternal = []; // Would need HEAD requests to check — mark as "check manually"

    // ── Build issues list ─────────────────────────────────────────────────────
    const issues = [];
    const addIssue = (category, severity, name, desc, fix, current = '', expected = '') => {
        issues.push({ category, severity, name, desc, fix, current, expected });
    };

    // ── TITLE ─────────────────────────────────────────────────────────────────
    if (!title) {
        addIssue('title', 'critical', 'Title tag missing',
            'Every page must have a <title> tag. Without it Google picks random text.',
            `Add inside <head>:\n<title>${kw ? kw.charAt(0).toUpperCase() + kw.slice(1) + ' | Your Brand' : 'Page Title | Your Brand'}</title>`,
            'None', '50–60 characters with keyword');
    } else {
        if (title.length < 30) addIssue('title', 'critical', 'Title too short (' + title.length + ' chars)',
            'Title is too short. You are wasting valuable ranking space.',
            `Expand your title to 50–60 characters.\nCurrent: "${title}"`,
            title, '50–60 characters');
        if (title.length > 60) addIssue('title', 'critical', 'Title too long (' + title.length + ' chars)',
            'Google will cut off your title in search results after ~60 characters.',
            `Shorten to under 60 characters.\nCurrent: "${title}"`,
            title, 'Under 60 characters');
        if (kw && !kwInTitle) addIssue('title', 'critical', 'Keyword not in title',
            `Target keyword "${keyword}" is missing from the title tag.`,
            `Add keyword near start of title.\nSuggested: "${keyword.charAt(0).toUpperCase() + keyword.slice(1)} Services | Your Brand"`,
            title, `Should contain: "${keyword}"`);
        if (kw && kwInTitle && kwPosInTitle > 30) addIssue('title', 'important', 'Keyword too late in title',
            'Keyword should appear in the first 30 characters of the title for maximum impact.',
            `Move "${keyword}" to the beginning of your title.`,
            title, 'Keyword in first 30 chars');
    }

    // ── META DESCRIPTION ─────────────────────────────────────────────────────
    if (!metaDesc) {
        addIssue('meta', 'critical', 'Meta description missing',
            'Without a meta description Google writes one itself — usually badly.',
            `Add inside <head>:\n<meta name="description" content="${keyword ? 'Professional ' + keyword + ' services. Get a free quote today. Call us now!' : 'Your compelling description here. Include your keyword and a call to action. 150-160 characters.'}">`,
            'None', '150–160 characters');
    } else {
        if (metaDesc.length < 70) addIssue('meta', 'critical', 'Meta description too short (' + metaDesc.length + ' chars)',
            'Too short — you are not giving Google enough context about your page.',
            `Expand to 150–160 characters.\nCurrent: "${metaDesc}"`,
            metaDesc, '150–160 characters');
        if (metaDesc.length > 160) addIssue('meta', 'critical', 'Meta description too long (' + metaDesc.length + ' chars)',
            'Google will cut it off. Users see "..." in search results.',
            `Shorten to under 160 characters.\nCurrent: "${metaDesc}"`,
            metaDesc, 'Under 160 characters');
        if (kw && !kwInDesc) addIssue('meta', 'important', 'Keyword not in meta description',
            `"${keyword}" is missing. Google bolds the keyword in results — helps people click.`,
            `Add "${keyword}" naturally into your description.`,
            metaDesc, `Should contain: "${keyword}"`);
        if (!/get|call|contact|buy|book|order|try|start|learn|discover/i.test(metaDesc))
            addIssue('meta', 'important', 'No call to action in description',
                'Descriptions with a CTA get more clicks. "Get a free quote today" works well.',
                `Add CTA to end: "${metaDesc.slice(0, 130)}. Get a free quote today!"`,
                metaDesc, 'Should include action words');
    }

    // ── URL ───────────────────────────────────────────────────────────────────
    if (url && !isHtml) {
        if (kw && !urlHasKw) addIssue('url', 'critical', 'Keyword not in URL',
            `URL should contain your keyword. Current path: "${urlPath}"`,
            `Change URL to: /${kwWords.join('-')}/`,
            urlPath, `Should contain: "${kwWords[0]}"`);
        if (urlLength > 75) addIssue('url', 'critical', 'URL too long (' + urlLength + ' chars)',
            'Long URLs look bad in search results and are hard to share.',
            `Shorten to: /${urlPath.split('/').filter(Boolean).slice(-1)[0]}/`,
            urlPath, 'Under 75 characters');
        if (!urlHasHyphen) addIssue('url', 'important', 'URL uses underscores instead of hyphens',
            'Google treats hyphens as word separators. Underscores join words together.',
            `Replace underscores with hyphens in: "${urlPath}"`,
            urlPath, 'Use hyphens: word-one-two');
        if (!urlLower) addIssue('url', 'important', 'URL contains uppercase letters',
            'Uppercase URLs can cause duplicate content issues (Google sees /Page and /page as different).',
            `Make URL all lowercase: "${urlPath.toLowerCase()}"`,
            urlPath, 'All lowercase');
    }

    // ── HEADINGS ──────────────────────────────────────────────────────────────
    if (h1s.length === 0) {
        addIssue('headings', 'critical', 'No H1 tag found',
            'H1 is the most important heading. Every page must have exactly one.',
            `Add H1 tag:\n<h1>${keyword ? keyword.charAt(0).toUpperCase() + keyword.slice(1) + ' — Professional Services' : 'Your Main Heading Here'}</h1>`,
            'None', 'Exactly 1 H1 with keyword');
    } else {
        if (h1s.length > 1) addIssue('headings', 'critical', `Multiple H1 tags found (${h1s.length})`,
            'Only one H1 per page. Multiple H1s confuse Google about what the page is about.',
            `Keep only the first H1:\n"${h1s[0]}"\nChange all others to H2 or H3.`,
            h1s.join(' | '), 'Exactly 1 H1');
        if (kw && !kwInH1) addIssue('headings', 'critical', 'Keyword not in H1',
            `H1 should contain your target keyword. Current H1: "${h1s[0]}"`,
            `Rewrite H1 to:\n<h1>${keyword.charAt(0).toUpperCase() + keyword.slice(1)} — Professional Services in Your City</h1>`,
            h1s[0], `Should contain: "${keyword}"`);
    }
    if (h2s.length === 0) addIssue('headings', 'important', 'No H2 tags found',
        'H2 tags break your content into sections. They help Google understand your page structure.',
        'Add H2 headings for each major section:\n<h2>Our Services</h2>\n<h2>Why Choose Us</h2>\n<h2>Frequently Asked Questions</h2>',
        'None', 'At least 3 H2 tags');
    if (!headingOrder.valid) addIssue('headings', 'important', 'Heading order is wrong',
        `Headings skip levels (e.g. H1 → H3). Always go H1 → H2 → H3 in order.`,
        `Fix order: ${headingOrder.suggestion}`,
        headingOrder.found, 'H1 → H2 → H3 in sequence');
    // Detect duplicate heading text — same H2/H3 appearing more than once signals thin structure
    const allSubheadings = [...h2s, ...h3s].map(h => h.toLowerCase().trim()).filter(Boolean);
    const headingCounts  = allSubheadings.reduce((acc, h) => { acc[h] = (acc[h] || 0) + 1; return acc; }, {});
    const dupHeadings    = Object.entries(headingCounts).filter(([, count]) => count > 1).map(([h]) => h);
    if (dupHeadings.length > 0) addIssue('headings', 'important',
        `${dupHeadings.length} duplicate heading(s) found`,
        'Repeating the same H2/H3 text signals weak content structure. Each section should cover a unique topic.',
        `Make these headings unique by adding specifics:\\n${dupHeadings.slice(0, 3).map(h => `"${h}" → rename to a more specific version`).join('\\n')}`,
        dupHeadings.map(h => `"${h}"`).join(', '), 'Every heading should be unique');

    // ── CONTENT ───────────────────────────────────────────────────────────────
    if (kw && !kwInFirst100) addIssue('content', 'critical', 'Keyword not in first 100 words',
        'Google reads the top of your page first. Mention your keyword early and naturally.',
        `Start your first paragraph with something like:\n"Looking for ${keyword}? We are..."`,
        'Keyword missing from opening paragraph', `Mention "${keyword}" early`);
    if (kw && kwDensity < 0.5 && wordCount > 100) addIssue('content', 'critical', `Keyword density too low (${kwDensity}%)`,
        `"${keyword}" appears too rarely. Google may not understand what your page is about.`,
        `Use "${keyword}" naturally more often. Aim for 1–2% density. At ${wordCount} words you need it ~${Math.round(wordCount * 0.01)} times.`,
        `Current: ${kwDensity}%`, 'Target: 1–2%');
    if (kw && kwDensity > 3) addIssue('content', 'critical', `Keyword stuffing detected (${kwDensity}%)`,
        'Too many keyword repetitions. Google penalises keyword stuffing.',
        `Reduce usage of "${keyword}". Replace some with synonyms.`,
        `Current: ${kwDensity}%`, 'Target: 1–2%');
    if (wordCount < 300) addIssue('content', 'critical', `Very thin content (${wordCount} words)`,
        'Pages with under 300 words are considered thin content and rarely rank well.',
        'Expand your content significantly. Aim for at least 800–1500 words.',
        `${wordCount} words`, 'At least 800 words');
    if (wordCount < 800 && wordCount >= 300) addIssue('content', 'important', `Content may be thin (${wordCount} words)`,
        'Competitors in your niche likely have more content. More depth = better rankings.',
        'Add more sections: FAQs, case studies, process explanation, pricing info.',
        `${wordCount} words`, '800–2000 words recommended');
    // flesch > 0 guards against pages with no sentences (would report false "hard to read")
    // flesch < 121 guards against broken calculations from very sparse content
    const fleschValid = flesch > 0 && flesch < 121;
    const fleschLabel = flesch >= 90 ? 'Very Easy' : flesch >= 70 ? 'Easy' : flesch >= 60 ? 'Standard' : flesch >= 50 ? 'Fairly Difficult' : 'Difficult';
    if (fleschValid && flesch < 60) addIssue('content', 'important', `Content hard to read (Flesch: ${flesch} — ${fleschLabel})`,
        'Complex writing loses visitors. Short sentences and simple words rank better.',
        'Break long sentences into shorter ones. Use bullet points. Write like you\'re explaining to a friend.',
        `Score: ${flesch}/100 (${fleschLabel})`, 'Target: 60+ (Standard or easier)');
    if (!hasFaq) addIssue('content', 'good', 'No FAQ section found',
        'FAQ sections win "People Also Ask" boxes in Google — free extra traffic.',
        `Add an FAQ section with H2:\n<h2>Frequently Asked Questions</h2>\nThen use FAQ schema markup.`,
        'No FAQ found', 'Recommended for traffic boost');

    // ── IMAGES ────────────────────────────────────────────────────────────────
    if (allImgs.length > 0) {
        if (imgsNoAlt.length > 0) addIssue('images', 'critical', `${imgsNoAlt.length} image(s) missing alt text`,
            'Alt text tells Google what the image is. Missing alt = missed SEO opportunity + accessibility issue.',
            `Add descriptive alt text to each image:\n${imgsNoAlt.slice(0, 3).map(i => `<img src="${i.src}" alt="Describe what this image shows">`).join('\n')}`,
            `${imgsNoAlt.length} images have no alt`, 'All images need alt text');
        if (imgsGenericAlt.length > 0) addIssue('images', 'important', `${imgsGenericAlt.length} image(s) have generic/meaningless alt text`,
            'Alt text like "image", "banner", or "photo" provides zero SEO value. Google ignores them.',
            `Replace with descriptive alts:\n${imgsGenericAlt.slice(0, 3).map(i => `<img src="${i.src}" alt="Describe exactly what this image shows — include ${keyword || 'your keyword'} if relevant">`).join('\n')}`,
            imgsGenericAlt.map(i => `"${i.alt}"`).join(', '), 'Descriptive alt text for each image');
        if (kw && allImgs.length > 0 && !kwInAnyAlt) addIssue('images', 'important', 'Keyword not in any image alt text',
            `At least one image should have "${keyword}" in its alt text.`,
            `Update your main image:\n<img src="main.jpg" alt="${keyword} - professional services">`,
            'No alt contains keyword', `One alt should include "${keyword}"`);
        if (imgsNoDimension.length > 0) addIssue('images', 'important', `${imgsNoDimension.length} image(s) missing width/height`,
            'Missing dimensions cause page to jump while loading (CLS — hurts Core Web Vitals score).',
            `Add dimensions to all images:\n<img src="img.jpg" width="800" height="600" alt="...">`,
            `${imgsNoDimension.length} images missing dimensions`, 'All images need width + height');
        if (imgsNoLazy.length > 3) addIssue('images', 'good', `${imgsNoLazy.length} images not lazy loading`,
            'Lazy loading makes your page load faster — only loads images when user scrolls to them.',
            `Add loading="lazy" to images below the fold:\n<img src="img.jpg" loading="lazy" alt="...">`,
            `${imgsNoLazy.length} images without lazy`, 'Add loading="lazy" to most images');
    }

    // ── SCHEMA ────────────────────────────────────────────────────────────────
    if (schemaScripts.length === 0) {
        const pageType = detectPageType($, h1s[0] || '', metaDesc);
        addIssue('schema', 'critical', 'No schema markup found',
            'Schema tells Google extra info about your page. Without it you miss rich results (stars, FAQs, breadcrumbs in search).',
            `Add this JSON-LD inside <head> for a ${pageType} page:\n${generateSchemaSnippet(pageType, keyword, url)}`,
            'No schema', `Add ${pageType} schema`);
    } else {
        if (!schemaValid) addIssue('schema', 'critical', 'Schema markup has errors',
            'Broken JSON-LD is ignored by Google. Check with Google Rich Results Test.',
            'Fix JSON syntax errors in your schema. Validate at: https://search.google.com/test/rich-results',
            'Schema has parse errors', 'Valid JSON-LD');
        if (hasFaq && !schemaTypes.includes('FAQPage')) addIssue('schema', 'important', 'FAQ content found but no FAQPage schema',
            'You have FAQs but no schema. Adding FAQPage schema shows your FAQs directly in Google results.',
            `Add FAQPage schema:\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [{\n    "@type": "Question",\n    "name": "Your question here?",\n    "acceptedAnswer": {\n      "@type": "Answer",\n      "text": "Your answer here."\n    }\n  }]\n}\n</script>`,
            'No FAQPage schema', 'Add FAQPage schema');

        // Validation-based issues
        for (const v of schemaValidationResults) {
            if (v.errors && v.errors.length > 0) {
                addIssue('schema', 'important', `${v.type}: missing required properties`,
                    `${v.type} schema is missing: ${v.errors.join(', ')}. Google requires these for rich results.`,
                    `Add the missing properties to your ${v.type} schema. See: https://developers.google.com/search/docs/appearance/structured-data`,
                    `Missing: ${v.errors.join(', ')}`, `Required: ${v.errors.join(', ')}`);
            }
            if (v.warnings && v.warnings.length > 0) {
                addIssue('schema', 'good', `${v.type}: missing recommended properties`,
                    `${v.type} schema is valid, but adding recommended fields can unlock richer search features (e.g. review stars, price range).`,
                    `Consider adding these properties to your ${v.type} schema: ${v.warnings.join(', ')}.`,
                    `Missing recommended: ${v.warnings.join(', ')}`, `Recommended: ${v.warnings.join(', ')}`);
            }
        }
    }

    // ── BREADCRUMBS ───────────────────────────────────────────────────────────
    if (!hasBreadcrumbNav) addIssue('breadcrumb', 'important', 'No breadcrumb navigation found',
        'Breadcrumbs (Home > Services > Web Design) help users and Google understand your site structure.',
        `Add breadcrumb HTML:\n<nav aria-label="breadcrumb">\n  <ol>\n    <li><a href="/">Home</a></li>\n    <li><a href="/services/">Services</a></li>\n    <li>${keyword || 'Current Page'}</li>\n  </ol>\n</nav>`,
        'No breadcrumb found', 'Add breadcrumb nav');
    if (hasBreadcrumbNav && !hasBreadcrumbSchema) addIssue('breadcrumb', 'important', 'Breadcrumb nav found but no schema',
        'Adding BreadcrumbList schema makes your breadcrumbs appear in Google search results.',
        `Add BreadcrumbList schema inside <head>:\n<script type="application/ld+json">\n{\n  "@context": "https://schema.org",\n  "@type": "BreadcrumbList",\n  "itemListElement": [\n    {"@type": "ListItem", "position": 1, "name": "Home", "item": "${url ? new URL(url.startsWith('http') ? url : 'https://x.com').origin : 'https://yoursite.com'}"},\n    {"@type": "ListItem", "position": 2, "name": "${keyword || 'Page Name'}", "item": "${url || 'https://yoursite.com/page'}"}\n  ]\n}\n</script>`,
        'No BreadcrumbList schema', 'Add schema');

    // ── INTERNAL LINKS ────────────────────────────────────────────────────────
    if (internalLinks.length < 3) addIssue('links', 'critical', `Too few internal links (${internalLinks.length})`,
        'Internal links spread authority through your site and help Google find more pages.',
        'Add at least 3–5 links to other pages on your site within your content.',
        `${internalLinks.length} internal links`, 'At least 3–5 links');
    if (weakAnchors.length > 0) addIssue('links', 'important', `${weakAnchors.length} weak anchor text(s) ("click here" etc.)`,
        'Anchor text tells Google what the linked page is about. "Click here" tells it nothing.',
        `Replace weak anchors:\n${weakAnchors.slice(0, 2).map(l => `"${l.text}" \u2192 "View our ${keyword || 'services'} portfolio"`).join('\n')}`,
        weakAnchors.map(l => l.text).join(', '), 'Descriptive anchor text');
    // External links: check for missing rel="noopener" on target="_blank" links (security + technical SEO)
    const unsafeExternalLinks = externalLinks.filter(l =>
        l.target === '_blank' && !l.rel.includes('noopener')
    );
    if (unsafeExternalLinks.length > 0) addIssue('links', 'important',
        `${unsafeExternalLinks.length} external link(s) missing rel="noopener"`,
        'Links that open in a new tab without rel="noopener" allow the linked page to access your window object (reverse tabnapping). This is both a security risk and a technical SEO signal.',
        `Add rel="noopener noreferrer" to all external links that open in a new tab:\n${unsafeExternalLinks.slice(0, 3).map(l => `<a href="${l.href}" target="_blank" rel="noopener noreferrer">${l.text || 'Link text'}</a>`).join('\n')}`,
        `${unsafeExternalLinks.length} links use target="_blank" without noopener`, 'Add rel="noopener noreferrer"');
    if (externalLinks.length === 0) addIssue('links', 'good', 'No external links found',
        'Linking to authoritative external sources (Wikipedia, official sites) builds trust.',
        'Add 2–3 links to reputable sources related to your topic.',
        'No external links', '2–3 authoritative links');

    // ── TECHNICAL ────────────────────────────────────────────────────────────
    if (!isHtml && !isHttps) addIssue('technical', 'critical', 'Site is not HTTPS',
        'Google flags HTTP sites as "Not Secure". HTTPS is a direct ranking factor.',
        'Install an SSL certificate. Most hosts (cPanel, Plesk) offer free Let\'s Encrypt SSL.',
        'HTTP (not secure)', 'HTTPS required');
    if (!canonical && !isHtml) addIssue('technical', 'critical', 'No canonical tag',
        'Canonical tag prevents duplicate content penalties by telling Google which URL is the official one.',
        `Add inside <head>:\n<link rel="canonical" href="${url || 'https://yoursite.com/this-page/'}">`,
        'No canonical', 'Add canonical tag');
    if (!viewport) addIssue('technical', 'critical', 'No viewport meta tag',
        'Without viewport tag your site looks broken on mobile. Google ranks mobile-first.',
        `Add inside <head>:\n<meta name="viewport" content="width=device-width, initial-scale=1">`,
        'No viewport', 'Required for mobile');
    if (robots && robots.includes('noindex')) addIssue('technical', 'critical', 'Page is set to noindex',
        'This page is HIDDEN from Google! The robots meta tag is blocking indexing.',
        `Change:\n<meta name="robots" content="noindex"> \nTo:\n<meta name="robots" content="index, follow">`,
        robots, 'index, follow');
    if (!langAttr) addIssue('technical', 'important', 'No lang attribute on <html> tag',
        'The lang attribute tells Google what language your page is in.',
        `Change:\n<html>\nTo:\n<html lang="en">`,
        'No lang', 'Add lang="en"');
    if (!hasAuthor) addIssue('technical', 'good', 'No author meta tag (E-E-A-T signal)',
        'Google\'s quality guidelines reward explicit author signals (Experience, Expertise, Authoritativeness, Trust). Adding author metadata helps with YMYL content (health, finance, legal).',
        `Add inside <head>:\n<meta name="author" content="Author Name">\n<!-- OR link to author profile: -->\n<link rel="author" href="https://yoursite.com/about-author/">`,
        'No author metadata found', 'Add meta[name="author"] or link[rel="author"]');
    if (!ogTitle) addIssue('technical', 'important', 'No Open Graph title (og:title)',
        'OG tags control how your page looks when shared on WhatsApp, Facebook, LinkedIn.',
        `Add inside <head>:\n<meta property="og:title" content="${title || (keyword || 'Page Title')}">\n<meta property="og:description" content="${metaDesc || 'Your description here'}">\n<meta property="og:image" content="https://yoursite.com/share-image.jpg">`,
        'No OG tags', 'Add og:title, og:description, og:image');
    if (!twitterCard) addIssue('technical', 'good', 'No Twitter/X Card meta tags',
        'Twitter Card tags control how your page appears when shared on X (Twitter). Without them X auto-generates a plain link.',
        `Add inside <head>:\n<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="${title || (keyword || 'Page Title')}">\n<meta name="twitter:description" content="${metaDesc || 'Your description'}">\n<meta name="twitter:image" content="${ogImage || 'https://yoursite.com/share-image.jpg'}">`,
        'No twitter:card tag', 'Add twitter:card, twitter:title, twitter:image');
    if (headScripts.length > 0) addIssue('technical', 'good', `${headScripts.length} render-blocking script(s) in <head>`,
        'Scripts in <head> without async/defer slow your page load time.',
        `Add defer to scripts:\n${headScripts.slice(0, 2).map(s => `<script src="${s}" defer></script>`).join('\n')}`,
        `${headScripts.length} blocking scripts`, 'Add async or defer');
    // hreflang: only flag if page has a lang attribute but no hreflang alternatives set up
    if (langAttr && !hasHreflang) addIssue('technical', 'good', 'No hreflang tags for multi-region targeting',
        'If you serve multiple languages or regional versions, hreflang tells Google which URL to show to which audience. Missing it causes wrong-language pages to appear in search results.',
        `Add inside <head> for each language/region version:\n<link rel="alternate" hreflang="en" href="https://yoursite.com/">\n<link rel="alternate" hreflang="en-gb" href="https://yoursite.com/gb/">\n<link rel="alternate" hreflang="x-default" href="https://yoursite.com/">`,
        `lang="${langAttr}" set but no hreflang found`, 'Add hreflang for each locale if multi-region');
    if (!hasSitemapLink && !isHtml) addIssue('technical', 'good', 'No sitemap link in <head>',
        'A <link rel="sitemap"> tag in <head> lets crawlers discover your sitemap instantly, without parsing robots.txt.',
        `Add inside <head>:\n<link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml">`,
        'No link[rel="sitemap"] found in head', 'Add sitemap link to <head>');

    // ── Scores ────────────────────────────────────────────────────────────────
    const categoryOrder = ['title','meta','url','headings','content','images','schema','breadcrumb','links','technical'];
    const categories = {};
    categoryOrder.forEach(cat => {
        const catIssues = issues.filter(i => i.category === cat);
        const critical  = catIssues.filter(i => i.severity === 'critical').length;
        const important = catIssues.filter(i => i.severity === 'important').length;
        const good      = catIssues.filter(i => i.severity === 'good').length;
        const maxPoints = getMaxPoints(cat);
        const deducted  = critical * 20 + important * 8 + good * 3;
        const score     = Math.max(0, Math.min(100, maxPoints - deducted));
        categories[cat] = { score, issues: catIssues, critical, important, good };
    });

    // Weighted overall score. Schema raised to 12% (rich results); lower-impact cats reduced to compensate.
    // Verification: 15+12+5+13+18+9+12+3+5+8 = 100 ✓
    const weights = { title:15, meta:12, url:5, headings:13, content:18, images:9, schema:12, breadcrumb:3, links:5, technical:8 };
    let overall = 0;
    categoryOrder.forEach(cat => {
        overall += (categories[cat].score * weights[cat]) / 100;
    });
    overall = Math.round(overall);

    return {
        url, keyword, isHtml,
        overall,
        categories,
        issues,
        meta: {
            title, metaDesc, canonical, robots, viewport, langAttr,
            ogTitle, ogDesc, ogImage,
        },
        headings: { h1s, h2s, h3s, h4s },
        content:  { wordCount, kwDensity, kwMatches, flesch, hasFaq, kwInFirst100 },
        images:   { total: allImgs.length, noAlt: imgsNoAlt.length, noDimension: imgsNoDimension.length, noLazy: imgsNoLazy.length, allImgs: allImgs.slice(0, 50) },
        links:    { internal: internalLinks.length, external: externalLinks.length, weakAnchors: weakAnchors.length, internalList: internalLinks.slice(0, 50) },
        schema:   { types: schemaTypes, valid: schemaValid, count: schemaScripts.length, validation: schemaValidationResults },
        breadcrumb: { hasNav: hasBreadcrumbNav, hasSchema: hasBreadcrumbSchema },
        technical: { isHttps, hasCanonical: !!canonical, hasViewport: !!viewport, hasLang: !!langAttr, hasOg: !!ogTitle, hasTwitterCard: !!twitterCard, blockingScripts: headScripts.length, sitemapLink },
        analyzedAt: new Date().toISOString(),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function checkHeadingOrder($) {
    const found = [];
    $('h1,h2,h3,h4,h5,h6').each((_, el) => {
        found.push(parseInt(el.tagName.replace('h', '')));
    });
    let valid = true;
    let suggestion = '';
    for (let i = 1; i < found.length; i++) {
        if (found[i] > found[i - 1] + 1) {
            valid = false;
            suggestion = `H${found[i-1]} → H${found[i]} (skipped H${found[i-1]+1})`;
            break;
        }
    }
    return { valid, found: found.map(n => 'H'+n).join(' → '), suggestion };
}

function countSyllables(text) {
    const words = text.toLowerCase().split(/\s+/).slice(0, 200);
    let count = 0;
    words.forEach(w => {
        count += (w.match(/[aeiou]/gi) || []).length || 1;
    });
    return count;
}

function getMaxPoints(cat) {
    const map = { title:100, meta:100, url:100, headings:100, content:100, images:100, schema:100, breadcrumb:100, links:100, technical:100 };
    return map[cat] || 100;
}

function detectPageType($, h1, metaDesc) {
    const text = ($('body').text() || '').toLowerCase();
    if (text.includes('buy') && text.includes('cart')) return 'Product';
    if (text.includes('contact') && (text.includes('phone') || text.includes('email'))) return 'LocalBusiness';
    if ($('article').length || $('time[datetime]').length) return 'Article';
    if (text.includes('service') || text.includes('solution')) return 'Service';
    if (text.includes('about') || text.includes('team')) return 'Organization';
    return 'WebPage';
}

function generateSchemaSnippet(type, keyword, url) {
    const base = { '@context': 'https://schema.org', '@type': type };
    if (type === 'LocalBusiness') Object.assign(base, {
        name: 'Your Business Name',
        description: keyword || 'Professional services',
        url: url || 'https://yoursite.com',
        telephone: '+91-XXXXXXXXXX',
        address: { '@type': 'PostalAddress', addressLocality: 'Bangalore', addressCountry: 'IN' },
    });
    else if (type === 'Service') Object.assign(base, {
        name: keyword || 'Your Service',
        provider: { '@type': 'Organization', name: 'Your Business' },
        areaServed: 'Bangalore',
    });
    else Object.assign(base, { name: keyword || 'Page Name', url: url || 'https://yoursite.com' });
    return `<script type="application/ld+json">\n${JSON.stringify(base, null, 2)}\n</script>`;
}

// Required fields — missing these makes structured data invalid
const SCHEMA_REQUIRED_FIELDS = {
    'Product': ['name', 'image'],
    'Product[]': ['name', 'image'],
    'Article': ['headline', 'author', 'datePublished', 'image'],
    'NewsArticle': ['headline', 'author', 'datePublished', 'image'],
    'BlogPosting': ['headline', 'author', 'datePublished'],
    'LocalBusiness': ['name', 'address'],
    'LocalBusiness[]': ['name', 'address'],
    'Organization': ['name', 'url'],
    'FAQPage': ['mainEntity'],
    'FAQPage[]': ['mainEntity'],
    'HowTo': ['name', 'step'],
    'HowTo[]': ['name', 'step'],
    'BreadcrumbList': ['itemListElement'],
    'BreadcrumbList[]': ['itemListElement'],
    'Event': ['name', 'startDate', 'location'],
    'Recipe': ['name', 'image', 'author'],
    'VideoObject': ['name', 'description', 'thumbnailUrl', 'uploadDate'],
    'JobPosting': ['title', 'description', 'datePosted', 'hiringOrganization'],
    'Review': ['itemReviewed', 'reviewRating', 'author'],
    'AggregateRating': ['ratingValue', 'reviewCount'],
    'Service': ['name', 'provider'],
    'WebPage': ['name'],
    'WebSite': ['name', 'url'],
    'ImageObject': ['contentUrl'],
    'Course': ['name', 'provider'],
    'Book': ['name'],
    'Movie': ['name'],
    'MusicAlbum': ['name'],
    'SoftwareApplication': ['name', 'operatingSystem', 'applicationCategory'],
    'MobileApplication': ['name', 'operatingSystem', 'applicationCategory'],
    'Dataset': ['name', 'description'],
    'SpecialAnnouncement': ['name', 'datePosted', 'category'],
    'ItemList': ['itemListElement'],
    'ItemList[]': ['itemListElement'],
};

// Recommended fields — missing these won't break validation but reduces rich-result eligibility
const SCHEMA_RECOMMENDED_FIELDS = {
    'Article':       ['dateModified', 'description', 'publisher'],
    'NewsArticle':   ['dateModified', 'description'],
    'BlogPosting':   ['dateModified', 'description', 'image'],
    'Product':       ['aggregateRating', 'offers', 'description', 'brand'],
    'Product[]':     ['aggregateRating', 'offers'],
    'LocalBusiness': ['aggregateRating', 'telephone', 'openingHours', 'priceRange', 'image'],
    'LocalBusiness[]':['aggregateRating', 'telephone', 'priceRange'],
    'Organization':  ['sameAs', 'logo', 'contactPoint', 'description'],
    'Recipe':        ['totalTime', 'nutrition', 'recipeYield', 'aggregateRating'],
    'Event':         ['description', 'image', 'organizer', 'offers'],
    'VideoObject':   ['duration', 'embedUrl'],
    'JobPosting':    ['jobLocation', 'baseSalary', 'employmentType'],
    'Course':        ['description', 'hasCourseInstance'],
    'WebSite':       ['potentialAction'],
    'Service':       ['description', 'areaServed'],
    'SoftwareApplication': ['description', 'aggregateRating', 'screenshot'],
};

// ── Structured Data Validation ───────────────────────────────────────────────
function validateSchema(schemaObj) {
    if (!schemaObj || typeof schemaObj !== 'object') return null;

    const type = schemaObj['@type'];
    if (!type) return null;

    const types = Array.isArray(type) ? type : [type];
    const results = [];

    for (const t of types) {
        const required    = SCHEMA_REQUIRED_FIELDS[t] || SCHEMA_REQUIRED_FIELDS[t + '[]'] || [];
        const recommended = SCHEMA_RECOMMENDED_FIELDS[t] || SCHEMA_RECOMMENDED_FIELDS[t + '[]'] || [];

        const missing = required.filter(field => {
            const value = schemaObj[field];
            if (value === undefined || value === null || value === '') return true;
            if (Array.isArray(value) && value.length === 0) return true;
            return false;
        });

        // Recommended fields missing — these unlock richer search features
        const warnings = recommended.filter(field => {
            const value = schemaObj[field];
            if (value === undefined || value === null || value === '') return true;
            if (Array.isArray(value) && value.length === 0) return true;
            return false;
        });

        results.push({
            type: t,
            errors: missing,
            warnings,
            valid: missing.length === 0,
        });
    }

    // Also check @graph arrays
    if (schemaObj['@graph'] && Array.isArray(schemaObj['@graph'])) {
        for (const item of schemaObj['@graph']) {
            const sub = validateSchema(item);
            if (sub) results.push(sub);
        }
    }

    if (results.length === 0) return null;
    if (results.length === 1) return results[0];

    return {
        type: results.map(r => r.type).join(', '),
        errors: results.flatMap(r => r.errors),
        warnings: results.flatMap(r => r.warnings),
        valid: results.every(r => r.valid),
    };
}

module.exports = { analyzeOnPage };
