/**
 * Page Optimization — frontend controller
 * Wires the form, drives the progress UI, and renders the 8-category report.
 */

const PO = {
    currentResult: null,
    categoryIds: ['headings', 'title-meta', 'content-depth', 'faqs', 'schema', 'images', 'internal-links', 'keyword-coverage'],
};

function poEscape(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function poFormatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    if (typeof window.formatNumber === 'function') return window.formatNumber(num);
    return Number(num).toLocaleString();
}

function poFormatTimeAgo(dateStr) {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    const diff = Date.now() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return date.toLocaleDateString();
}

function poSetProgress(percent, stepText, detailText) {
    const fill = document.getElementById('poProgressFill');
    const step = document.getElementById('poProgressStep');
    const detail = document.getElementById('poProgressDetail');
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (step) step.textContent = stepText;
    if (detail) detail.textContent = detailText || '';
}

function poShowProgress(show) {
    const el = document.getElementById('poProgress');
    if (el) el.style.display = show ? '' : 'none';
}

function poShowError(message) {
    const banner = document.getElementById('poErrorBanner');
    const body = document.getElementById('poErrorBody');
    if (banner && body) {
        body.innerHTML = `<i class="fas fa-triangle-exclamation"></i><strong>${poEscape(message)}</strong>`;
        banner.style.display = '';
    }
}

function poClearError() {
    const banner = document.getElementById('poErrorBanner');
    if (banner) banner.style.display = 'none';
}

function poPriorityBadge(priority) {
    const cls = (priority || 'low').toLowerCase();
    return `<span class="po-section-priority ${cls}">${poEscape(priority || 'low')}</span>`;
}

function poActionCard(actionText) {
    if (!actionText) return '';
    return `
        <div class="po-action-card">
            <div class="po-action-icon"><i class="fas fa-lightbulb"></i></div>
            <div class="po-action-body">
                <div class="po-action-title">Recommended action</div>
                <div class="po-action-detail">${poEscape(actionText)}</div>
            </div>
        </div>
    `;
}

function poCategoryPriorityMap(report) {
    const map = {};
    (report.gaps || []).forEach(g => { map[g.id] = g.priority; });
    return map;
}

function poRenderHeaderStats(report) {
    const wrap = document.getElementById('poHeaderStats');
    if (!wrap) return;
    document.getElementById('poStatMyScore').textContent = report.myScore ?? '—';
    document.getElementById('poStatCompScore').textContent = report.averageCompetitorScore ?? '—';
    document.getElementById('poStatHigh').textContent = report.highPriorityGaps ?? 0;
    wrap.style.display = 'flex';
}

function poRenderReportHeader(result) {
    document.getElementById('poReportKeyword').textContent = result.keyword;
    const urlEl = document.getElementById('poReportUrl');
    urlEl.textContent = result.url;
    urlEl.href = result.url;

    const badges = document.getElementById('poReportBadges');
    if (badges) {
        const r = result.report;
        const items = [
            { cls: 'info', text: `${r.competitorCount} competitors analyzed` },
            { cls: r.myScore >= r.averageCompetitorScore ? 'low' : 'high',
              text: `Score ${r.myScore} vs ${r.averageCompetitorScore}` },
            { cls: r.highPriorityGaps > 0 ? 'high' : 'low',
              text: `${r.highPriorityGaps} high-priority` },
            { cls: r.mediumPriorityGaps > 0 ? 'medium' : 'low',
              text: `${r.mediumPriorityGaps} medium` },
        ];
        badges.innerHTML = items.map(b => `<span class="po-badge ${b.cls}">${poEscape(b.text)}</span>`).join('');
    }
}

function poRenderCategoryCards(report) {
    const priorityMap = poCategoryPriorityMap(report);
    const summaries = {
        'headings': g => g ? g.summary : '',
        'title-meta': g => g ? g.summary : '',
        'content-depth': g => g ? g.summary : '',
        'faqs': g => g ? g.summary : '',
        'schema': g => g ? g.summary : '',
        'images': g => g ? g.summary : '',
        'internal-links': g => g ? g.summary : '',
        'keyword-coverage': g => g ? g.summary : '',
    };
    const summaryEls = {
        'headings': 'poCatHeadingsSummary',
        'title-meta': 'poCatTitleSummary',
        'content-depth': 'poCatContentSummary',
        'faqs': 'poCatFaqSummary',
        'schema': 'poCatSchemaSummary',
        'images': 'poCatImagesSummary',
        'internal-links': 'poCatLinksSummary',
        'keyword-coverage': 'poCatEntitySummary',
    };
    const priorityEls = {
        'headings': 'poCatHeadingsPriority',
        'title-meta': 'poCatTitlePriority',
        'content-depth': 'poCatContentPriority',
        'faqs': 'poCatFaqPriority',
        'schema': 'poCatSchemaPriority',
        'images': 'poCatImagesPriority',
        'internal-links': 'poCatLinksPriority',
        'keyword-coverage': 'poCatEntityPriority',
    };

    const gapById = {};
    (report.gaps || []).forEach(g => { gapById[g.id] = g; });

    PO.categoryIds.forEach(id => {
        const gap = gapById[id];
        const summaryEl = document.getElementById(summaryEls[id]);
        const priorityEl = document.getElementById(priorityEls[id]);
        if (summaryEl) summaryEl.textContent = (gap && gap.summary) ? gap.summary : 'Looks good.';
        if (priorityEl) {
            const p = (gap && gap.priority) || 'low';
            priorityEl.className = 'po-category-priority ' + p;
            priorityEl.textContent = p;
        }
    });

    // Click to scroll to section
    document.querySelectorAll('.po-category').forEach(card => {
        card.addEventListener('click', () => {
            const id = card.dataset.category;
            const section = document.getElementById('poSection-' + id);
            if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// ─── Per-section renderers ────────────────────────────────────────────────────
function poRenderHeadings(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'headings');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const mineH2 = m.h2 || [];
    const mineH3 = m.h3 || [];
    const sampleH2 = mineH2.length ? mineH2.slice(0, 4).map(h => `<li>${poEscape(h)}</li>`).join('') : '<li class="text-muted">No H2 tags detected</li>';

    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your H2s</div>
                <div class="po-metric-value ${m.h2Count < (c.avgH2 || 0) ? 'bad' : 'good'}">${m.h2Count || 0}</div>
                <div class="po-metric-sub">Competitor avg: ${c.avgH2 || 0}</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Your H3s</div>
                <div class="po-metric-value ${m.h3Count < (c.avgH3 || 0) ? 'bad' : 'good'}">${m.h3Count || 0}</div>
                <div class="po-metric-sub">Competitor avg: ${c.avgH3 || 0}</div>
            </div>
        </div>
        <div class="po-compare-row">
            <div class="po-compare">
                <div class="po-compare-label">Your H2 headings</div>
                <ul class="po-list">${sampleH2}</ul>
            </div>
            <div class="po-compare">
                <div class="po-compare-label">Best competitor H2 count</div>
                <div class="po-compare-text">${c.bestH2 || 0} H2s, ${c.bestH3 || 0} H3s</div>
                <div class="po-compare-text" style="margin-top:6px;color:var(--gray);font-size:0.78rem">Common patterns competitors use:</div>
                <ul class="po-list">${(gap.exampleHeadings || []).slice(0, 4).map(h => `<li>${poEscape(h)}</li>`).join('')}</ul>
            </div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderTitleMeta(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'title-meta');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const titleClass = (!m.title || m.titleLength < 30 || m.titleLength > 60) ? 'bad' : 'good';
    const descClass = (!m.description || m.descriptionLength < 70 || m.descriptionLength > 160) ? 'bad' : 'good';

    const compTitles = (c.sampleTitles || []).map(t => `<li>${poEscape(t)}</li>`).join('')
        || '<li class="text-muted">No competitor data</li>';
    const compDescs = (c.sampleDescriptions || []).map(t => `<li>${poEscape((t || '').slice(0, 160))}…</li>`).join('')
        || '<li class="text-muted">No competitor data</li>';

    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your title length</div>
                <div class="po-metric-value ${titleClass}">${m.titleLength || 0} <span style="font-size:0.7rem;color:var(--gray)">chars</span></div>
                <div class="po-metric-sub">Target 50–60 · Competitor avg ${c.avgTitleLength || 0}</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Your meta description</div>
                <div class="po-metric-value ${descClass}">${m.descriptionLength || 0} <span style="font-size:0.7rem;color:var(--gray)">chars</span></div>
                <div class="po-metric-sub">Target 150–160 · Competitor avg ${c.avgDescriptionLength || 0}</div>
            </div>
        </div>
        <div class="po-compare-row">
            <div class="po-compare">
                <div class="po-compare-label">Your title</div>
                <div class="po-compare-text ${m.title ? '' : 'dim'}">${poEscape(m.title || 'Missing — Google will pick text for you.')}</div>
                <div class="po-compare-label" style="margin-top:10px">Your meta description</div>
                <div class="po-compare-text ${m.description ? '' : 'dim'}">${poEscape(m.description || 'Missing — add 150–160 chars including your keyword.')}</div>
            </div>
            <div class="po-compare">
                <div class="po-compare-label">Competitor titles</div>
                <ul class="po-list">${compTitles}</ul>
                <div class="po-compare-label" style="margin-top:10px">Competitor descriptions</div>
                <ul class="po-list">${compDescs}</ul>
            </div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderContentDepth(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'content-depth');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const dist = (c.wordDistribution || []).filter(n => n > 0);
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your word count</div>
                <div class="po-metric-value">${poFormatNumber(m.wordCount)}</div>
                <div class="po-metric-sub">vs competitor avg ${poFormatNumber(c.averageWordCount)}</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Flesch readability</div>
                <div class="po-metric-value ${m.fleschScore < 60 ? 'bad' : 'good'}">${m.fleschScore || '—'}</div>
                <div class="po-metric-sub">Target 60+ for easy reading</div>
            </div>
        </div>
        <div class="po-compare-row">
            <div class="po-compare">
                <div class="po-compare-label">Competitor word counts (sorted)</div>
                <div class="po-compare-text">${dist.length ? dist.map(n => poFormatNumber(n)).join(' · ') : 'No competitor data'}</div>
                <div class="po-metric-sub" style="margin-top:6px">Min: ${poFormatNumber(c.minWordCount)} · Max: ${poFormatNumber(c.maxWordCount)}</div>
            </div>
            <div class="po-compare">
                <div class="po-compare-label">Your keyword density</div>
                <div class="po-compare-text">${(m.keywordDensity || 0).toFixed(2)}%</div>
                <div class="po-metric-sub">Target 1–2%</div>
            </div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderFaqs(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'faqs');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const samples = (c.sampleSchemas || []).map(d => `<span class="po-tag">${poEscape(d)}</span>`).join('');
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your FAQ section</div>
                <div class="po-metric-value ${m.hasFaqSection ? 'good' : 'bad'}">${m.hasFaqSection ? 'Present' : 'Missing'}</div>
                <div class="po-metric-sub">Google favours FAQ rich snippets</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Competitors with FAQPage schema</div>
                <div class="po-metric-value">${c.withFaqSchema || 0} / ${(c.withFaqSchema || 0) + (c.withoutFaqSchema || 0)}</div>
                <div class="po-metric-sub">The rest have no FAQ schema either</div>
            </div>
        </div>
        ${samples ? `<div><strong style="font-size:0.85rem">Competitors with FAQPage schema:</strong><div class="po-tag-list">${samples}</div></div>` : ''}
        ${gap.action ? poActionCard(gap.action) : ''}
        ${gap.schemaSnippet ? `<div class="po-code">${poEscape(gap.schemaSnippet)}</div>` : ''}
    `;
}

function poRenderSchema(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'schema');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const mineTypes = (m.types || []).map(t => `<span class="po-tag present">${poEscape(t)}</span>`).join('')
        || '<span class="po-tag missing">No schema</span>';
    const missingTypes = (c.missingTypes || []).map(t => `<span class="po-tag missing">${poEscape(t)}</span>`).join('')
        || '<span class="po-tag present">All covered</span>';
    const commonTypes = (c.commonTypes || []).map(t => `<span class="po-tag">${poEscape(t)}</span>`).join('')
        || '<span class="po-tag">None detected</span>';
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your schema types</div>
                <div class="po-tag-list">${mineTypes}</div>
                <div class="po-metric-sub">${m.valid ? 'JSON-LD parses cleanly' : 'JSON-LD has parse errors'}</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Common competitor types</div>
                <div class="po-tag-list">${commonTypes}</div>
                <div class="po-metric-sub">${c.withSchema || 0}/${(c.withSchema || 0) + (c.withoutSchema || 0)} competitors use schema</div>
            </div>
        </div>
        <div>
            <strong style="font-size:0.85rem">Schema types competitors have that you don't:</strong>
            <div class="po-tag-list">${missingTypes}</div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderImages(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'images');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your images</div>
                <div class="po-metric-value">${m.total || 0}</div>
                <div class="po-metric-sub">${m.missingAlt || 0} missing alt text</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Your alt coverage</div>
                <div class="po-metric-value ${m.altCoverage < 80 ? 'bad' : 'good'}">${m.altCoverage || 0}%</div>
                <div class="po-metric-sub">Competitor avg ${c.averageAltCoverage || 0}%</div>
            </div>
        </div>
        <div class="po-compare-row">
            <div class="po-compare">
                <div class="po-compare-label">Competitor average image count</div>
                <div class="po-compare-text">${c.averageImageCount || 0} images per page</div>
            </div>
            <div class="po-compare">
                <div class="po-compare-label">Your image count vs competitor avg</div>
                <div class="po-compare-text">${(m.total || 0)} vs ${c.averageImageCount || 0}</div>
            </div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderInternalLinks(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'internal-links');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Your internal links</div>
                <div class="po-metric-value ${m.internal < (c.averageInternal || 0) ? 'bad' : 'good'}">${m.internal || 0}</div>
                <div class="po-metric-sub">Competitor avg ${c.averageInternal || 0}</div>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Best competitor count</div>
                <div class="po-metric-value">${c.bestInternal || 0}</div>
                <div class="po-metric-sub">External links: you ${m.external || 0} · comp avg ${c.averageExternal || 0}</div>
            </div>
        </div>
        ${(m.weakAnchors || 0) > 0
            ? `<div class="po-action-card"><div class="po-action-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="po-action-body"><div class="po-action-title">${m.weakAnchors} weak anchor text(s) found</div><div class="po-action-detail">You have "click here", "read more" or "link" anchors. Replace them with keyword-rich anchor text.</div></div></div>`
            : ''}
        ${poActionCard(gap.action)}
    `;
}

function poRenderEntity(result) {
    const gap = (result.report.gaps || []).find(g => g.id === 'keyword-coverage');
    if (!gap) return '';
    const m = gap.mine || {};
    const c = gap.competitors || {};
    const checks = [
        { label: 'In title tag', ok: m.keywordInTitle },
        { label: 'In H1', ok: m.keywordInH1 },
        { label: 'In first 100 words', ok: m.keywordInFirst100 },
    ];
    return `
        <div class="po-metric-grid">
            <div class="po-metric">
                <div class="po-metric-label">Keyword coverage</div>
                <ul class="po-list" style="margin-top:6px">
                    ${checks.map(c => `<li>${c.ok ? '<span style="color:var(--secondary);font-weight:700">✓</span>' : '<span style="color:var(--danger);font-weight:700">✗</span>'} ${poEscape(c.label)}</li>`).join('')}
                </ul>
            </div>
            <div class="po-metric">
                <div class="po-metric-label">Keyword density</div>
                <div class="po-metric-value">${(m.keywordDensity || 0).toFixed(2)}%</div>
                <div class="po-metric-sub">Your ${m.keywordOccurrences || 0} mentions · Competitor avg ${(c.averageDensity || 0).toFixed(2)}%</div>
            </div>
        </div>
        <div>
            <strong style="font-size:0.85rem">Entities competitors cover that you don't:</strong>
            <div class="po-entity-grid">
                ${(gap.missingEntities || []).map(w => `<span class="po-entity">${poEscape(w)} <span class="po-entity-x">×</span></span>`).join('') || '<span class="po-tag">No missing entities detected</span>'}
            </div>
        </div>
        <div style="margin-top:14px">
            <strong style="font-size:0.85rem">Common competitor entities (already on the SERP):</strong>
            <div class="po-entity-grid">
                ${(c.commonEntities || []).map(w => `<span class="po-entity">${poEscape(w)}</span>`).join('') || '<span class="po-tag">No data</span>'}
            </div>
        </div>
        ${poActionCard(gap.action)}
    `;
}

function poRenderSections(result) {
    const renderers = {
        'headings': { body: 'poSecHeadingsBody', priority: 'poSecHeadingsPriority', render: poRenderHeadings },
        'title-meta': { body: 'poSecTitleBody', priority: 'poSecTitlePriority', render: poRenderTitleMeta },
        'content-depth': { body: 'poSecContentBody', priority: 'poSecContentPriority', render: poRenderContentDepth },
        'faqs': { body: 'poSecFaqBody', priority: 'poSecFaqPriority', render: poRenderFaqs },
        'schema': { body: 'poSecSchemaBody', priority: 'poSecSchemaPriority', render: poRenderSchema },
        'images': { body: 'poSecImagesBody', priority: 'poSecImagesPriority', render: poRenderImages },
        'internal-links': { body: 'poSecLinksBody', priority: 'poSecLinksPriority', render: poRenderInternalLinks },
        'keyword-coverage': { body: 'poSecEntityBody', priority: 'poSecEntityPriority', render: poRenderEntity },
    };
    PO.categoryIds.forEach(id => {
        const conf = renderers[id];
        if (!conf) return;
        const body = document.getElementById(conf.body);
        const prio = document.getElementById(conf.priority);
        const gap = (result.report.gaps || []).find(g => g.id === id);
        if (body) body.innerHTML = conf.render(result) || '<p class="text-muted">No data available.</p>';
        if (prio) {
            const p = (gap && gap.priority) || 'low';
            prio.className = 'po-section-priority ' + p;
            prio.textContent = p + ' priority';
        }
    });
}

function poRenderResult(result) {
    PO.currentResult = result;
    document.getElementById('poResults').style.display = '';
    poRenderHeaderStats(result.report);
    poRenderReportHeader(result);
    poRenderCategoryCards(result.report);
    poRenderSections(result);
    document.getElementById('poResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function poAnalyze(url, keyword, location) {
    if (!url || !keyword) {
        poShowError('Both URL and target keyword are required.');
        return;
    }
    poClearError();
    document.getElementById('poResults').style.display = 'none';
    poShowProgress(true);
    poSetProgress(5, 'Crawling your page…', `Fetching ${url}`);

    // Animate progress smoothly while the request runs
    let percent = 5;
    const ticker = setInterval(() => {
        percent = Math.min(85, percent + Math.random() * 4);
        if (percent < 35) poSetProgress(percent, 'Crawling your page…', `Running 47 on-page checks on ${url}`);
        else if (percent < 55) poSetProgress(percent, 'Fetching top 10 SERP competitors…', 'Looking up live search results for ' + keyword);
        else if (percent < 80) poSetProgress(percent, 'Analyzing competitor pages…', 'Crawling each competitor and measuring headings, content, schema, links, images');
        else poSetProgress(percent, 'Building gap report…', 'Comparing your page against the competitor average');
    }, 900);

    try {
        const data = await api('/api/page-optimization/analyze', {
            method: 'POST',
            body: JSON.stringify({ url, keyword, location }),
        });
        clearInterval(ticker);
        if (!data.success) {
            poShowError(data.error || 'Analysis failed.');
            return;
        }
        poSetProgress(100, 'Done!', 'Rendering the 8-category gap report…');
        setTimeout(() => {
            poShowProgress(false);
            poRenderResult(data.result);
            poLoadHistory();
        }, 350);
    } catch (err) {
        clearInterval(ticker);
        poShowProgress(false);
        poShowError(err.message || 'Analysis failed.');
    }
}

async function poLoadHistory() {
    const list = document.getElementById('poHistoryList');
    if (!list) return;
    try {
        const data = await api('/api/page-optimization/history');
        const history = data.history || [];
        if (!history.length) {
            list.innerHTML = '<p class="text-muted">No reports yet. Run your first analysis.</p>';
            return;
        }
        list.innerHTML = history.map(h => {
            const score = h.my_score || 0;
            const cls = score < 50 ? 'low' : score < 75 ? 'mid' : 'high';
            return `
                <div class="po-history-item" data-id="${h.id}">
                    <div style="min-width:0;flex:1">
                        <div class="po-history-keyword">${poEscape(h.keyword)}</div>
                        <div class="po-history-url">${poEscape(h.url)}</div>
                        <div class="po-history-meta">
                            <span><i class="fas fa-globe"></i> ${poEscape(h.location || 'India')}</span>
                            <span><i class="fas fa-clock"></i> ${poFormatTimeAgo(h.created_at)}</span>
                            ${h.summary && h.summary.competitor_count ? `<span><i class="fas fa-users"></i> ${h.summary.competitor_count} comps</span>` : ''}
                        </div>
                    </div>
                    <div class="po-history-score ${cls}">${score}</div>
                </div>
            `;
        }).join('');
        list.querySelectorAll('.po-history-item').forEach(item => {
            item.addEventListener('click', () => poLoadReport(item.dataset.id));
        });
    } catch (err) {
        list.innerHTML = `<p class="text-muted">Could not load history: ${poEscape(err.message)}</p>`;
    }
}

async function poLoadReport(id) {
    try {
        poShowProgress(true);
        poSetProgress(20, 'Loading saved report…', '');
        const data = await api(`/api/page-optimization/${id}`);
        if (!data.optimization) {
            poShowError('Report not found.');
            poShowProgress(false);
            return;
        }
        const opt = data.optimization;
        // Reconstruct a minimal result shape for rendering
        const result = {
            url: opt.url,
            keyword: opt.keyword,
            location: opt.location,
            myDomain: (() => { try { return new URL(opt.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
            analyzedAt: opt.created_at,
            serp: { total: 0, error: null, results: [] },
            myAnalysis: Object.assign({ overall: opt.my_score }, opt.my_data || {}),
            competitors: (opt.competitors || []).map(c => ({
                domain: c.domain,
                url: c.url,
                position: null,
                title: null,
                snippet: null,
                analysis: {
                    wordCount: c.wordCount,
                    hasSchema: c.hasSchema,
                    internalLinks: c.internalLinks,
                    hasFaqSchema: c.hasFaqSchema,
                    schemaTypes: [],
                    h1: '',
                    metaDescription: '',
                    h2Count: 0,
                    h3Count: 0,
                    density: 0,
                    exactMatches: 0,
                    hasMetaDescription: false,
                    h1Present: false,
                    externalLinks: 0,
                    images: 0,
                    imagesWithAlt: 0,
                    altRatio: 0,
                },
                error: c.error,
            })),
            report: {
                myScore: opt.my_score,
                averageCompetitorScore: opt.avg_competitor_score,
                highPriorityGaps: opt.summary?.high || 0,
                mediumPriorityGaps: opt.summary?.medium || 0,
                lowPriorityGaps: opt.summary?.low || 0,
                competitorCount: opt.summary?.competitorCount || 0,
                gaps: opt.gaps || [],
            },
        };
        poSetProgress(100, 'Loaded.', '');
        setTimeout(() => {
            poShowProgress(false);
            poRenderResult(result);
        }, 200);
    } catch (err) {
        poShowProgress(false);
        poShowError(err.message || 'Could not load report.');
    }
}

function initPageOptimization() {
    const btn = document.getElementById('poAnalyzeBtn');
    if (btn && !btn.dataset.bound) {
        btn.dataset.bound = '1';
        btn.addEventListener('click', () => {
            const url = document.getElementById('poUrl')?.value.trim();
            const keyword = document.getElementById('poKeyword')?.value.trim();
            const location = document.getElementById('poLocation')?.value || 'India';
            poAnalyze(url, keyword, location);
        });
    }
    const refresh = document.getElementById('poRefreshHistoryBtn');
    if (refresh && !refresh.dataset.bound) {
        refresh.dataset.bound = '1';
        refresh.addEventListener('click', poLoadHistory);
    }
    poLoadHistory();
}

window.initPageOptimization = initPageOptimization;
window.poAnalyze = poAnalyze;
window.poLoadHistory = poLoadHistory;
