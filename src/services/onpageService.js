/**
 * 🔍 On-Page SEO Service
 * Runs all 47 checks across 10 categories
 */

const axios = require('axios');
const cheerio = require('cheerio');

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
    const ogTitle      = $('meta[property="og:title"]').attr('content') || '';
    const ogDesc       = $('meta[property="og:description"]').attr('content') || '';
    const ogImage      = $('meta[property="og:image"]').attr('content') || '';

    // Headings
    const h1s   = $('h1').map((_, el) => $(el).text().trim()).get();
    const h2s   = $('h2').map((_, el) => $(el).text().trim()).get();
    const h3s   = $('h3').map((_, el) => $(el).text().trim()).get();
    const h4s   = $('h4').map((_, el) => $(el).text().trim()).get();

    // Body text
    $('script,style,nav,footer,header').remove();
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
    const kwDensity    = wordCount > 0 ? parseFloat(((kwMatches * kwWords.length) / wordCount * 100).toFixed(2)) : 0;

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
    if (flesch < 60 && flesch > 0) addIssue('content', 'important', `Content hard to read (Flesch score: ${flesch})`,
        'Complex writing loses visitors. Short sentences and simple words rank better.',
        'Break long sentences. Use bullet points. Aim for Flesch score above 60.',
        `Score: ${flesch}/100`, 'Target: 60+ (easy to read)');
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
        `Replace weak anchors:\n${weakAnchors.slice(0, 2).map(l => `"${l.text}" → "View our ${keyword || 'services'} portfolio"`).join('\n')}`,
        weakAnchors.map(l => l.text).join(', '), 'Descriptive anchor text');
    const extNoRel = externalLinks.filter(l => !l.href.includes('rel='));
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
    if (!ogTitle) addIssue('technical', 'important', 'No Open Graph title (og:title)',
        'OG tags control how your page looks when shared on WhatsApp, Facebook, LinkedIn.',
        `Add inside <head>:\n<meta property="og:title" content="${title || (keyword || 'Page Title')}">\n<meta property="og:description" content="${metaDesc || 'Your description here'}">\n<meta property="og:image" content="https://yoursite.com/share-image.jpg">`,
        'No OG tags', 'Add og:title, og:description, og:image');
    if (headScripts.length > 0) addIssue('technical', 'good', `${headScripts.length} render-blocking script(s) in <head>`,
        'Scripts in <head> without async/defer slow your page load time.',
        `Add defer to scripts:\n${headScripts.slice(0, 2).map(s => `<script src="${s}" defer></script>`).join('\n')}`,
        `${headScripts.length} blocking scripts`, 'Add async or defer');

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

    // Weighted overall score
    const weights = { title:15, meta:12, url:8, headings:15, content:18, images:10, schema:10, breadcrumb:5, links:5, technical:12 };
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
        images:   { total: allImgs.length, noAlt: imgsNoAlt.length, noDimension: imgsNoDimension.length, noLazy: imgsNoLazy.length },
        links:    { internal: internalLinks.length, external: externalLinks.length, weakAnchors: weakAnchors.length },
        schema:   { types: schemaTypes, valid: schemaValid, count: schemaScripts.length },
        breadcrumb: { hasNav: hasBreadcrumbNav, hasSchema: hasBreadcrumbSchema },
        technical: { isHttps, hasCanonical: !!canonical, hasViewport: !!viewport, hasLang: !!langAttr, hasOg: !!ogTitle, blockingScripts: headScripts.length },
        analyzedAt: new Date().toISOString(),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function extractDomain(url) {
    try { return new URL(url).hostname.replace('www.', ''); } catch { return ''; }
}

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

module.exports = { analyzeOnPage };
