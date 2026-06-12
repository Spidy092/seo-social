/**
 * 🔍 On-Page SEO Analyzer — Frontend
 */

const CATEGORY_LABELS = {
    title:      { label: 'Title Tag',        icon: 'fa-tag',          weight: 15 },
    meta:       { label: 'Meta Description', icon: 'fa-align-left',   weight: 12 },
    url:        { label: 'URL Structure',    icon: 'fa-link',         weight: 8  },
    headings:   { label: 'Headings',         icon: 'fa-heading',      weight: 15 },
    content:    { label: 'Content',          icon: 'fa-file-alt',     weight: 18 },
    images:     { label: 'Images',           icon: 'fa-image',        weight: 10 },
    schema:     { label: 'Schema Markup',    icon: 'fa-code',         weight: 10 },
    breadcrumb: { label: 'Breadcrumbs',      icon: 'fa-sitemap',      weight: 5  },
    links:      { label: 'Internal Links',   icon: 'fa-network-wired',weight: 5  },
    technical:  { label: 'Technical',        icon: 'fa-cogs',         weight: 12 },
};

const SEV_ORDER = { critical: 0, important: 1, good: 2 };

let lastResult = null;

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('onpage-analyze-btn')?.addEventListener('click', runAnalysis);
    document.getElementById('onpage-url-input')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') runAnalysis();
    });
    document.getElementById('onpage-input-mode')?.addEventListener('change', toggleInputMode);

    if (document.getElementById('onpage-project-select')) {
        initOnPageProjects();
    }
});

function getScoreColor(score) {
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    if (score >= 40) return '#f97316';
    return '#ef4444';
}

window.onpageHistoryCache = {};

async function initOnPageProjects() {
    const select = document.getElementById('onpage-project-select');
    if (!select) return;

    try {
        const res = await fetch('/api/projects');
        const data = await res.json();
        const projects = data.projects || [];
        
        select.innerHTML = '<option value="">(Optional) Link to Project & Auto-Suggest URLs...</option>' + 
            projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.client_name)} · ${escapeHtml(p.name)}</option>`).join('');
            
        select.addEventListener('change', async () => {
            const projectId = select.value;
            if (!projectId) {
                document.getElementById('onpage-suggested-urls').innerHTML = '';
                document.getElementById('onpage-history-container').style.display = 'none';
                return;
            }
            
            // Fetch Suggested URLs
            fetch(`/api/projects/${projectId}/suggested-urls`)
                .then(r => r.json())
                .then(d => {
                    const datalist = document.getElementById('onpage-suggested-urls');
                    if (datalist && d.urls) {
                        datalist.innerHTML = d.urls.map(url => `<option value="${escapeHtml(url)}"></option>`).join('');
                    }
                })
                .catch(console.error);
                
            // Fetch Recent Audits
            fetch(`/api/projects/${projectId}/onpage-audits`)
                .then(r => r.json())
                .then(d => {
                    const container = document.getElementById('onpage-history-container');
                    const list = document.getElementById('onpage-history-list');
                    if (!container || !list) return;
                    
                    if (d.audits && d.audits.length > 0) {
                        d.audits.forEach(a => window.onpageHistoryCache[a.id] = a);
                        container.style.display = 'block';
                        list.innerHTML = d.audits.map(a => `
                            <div class="card" style="padding: 16px; display: flex; flex-direction: column; gap: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: start;">
                                    <div style="font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;" title="${escapeHtml(a.url)}">${escapeHtml(a.url.replace(/^https?:\/\//, ''))}</div>
                                    <div class="onpage-score-ring" style="width: 40px; height: 40px; zoom: 0.8; margin: -5px -5px 0 10px; flex-shrink: 0;">
                                        <svg width="120" height="120" viewBox="0 0 120 120">
                                            <circle class="track" cx="60" cy="60" r="45"/>
                                            <circle class="fill" cx="60" cy="60" r="45" stroke="${getScoreColor(a.overall_score)}" stroke-dasharray="283" stroke-dashoffset="${283 - (Math.max(0, Math.min(100, a.overall_score)) / 100) * 283}"/>
                                        </svg>
                                        <div class="onpage-score-num">
                                            <div class="onpage-score-big" style="color: ${getScoreColor(a.overall_score)}">${a.overall_score}</div>
                                        </div>
                                    </div>
                                </div>
                                <div style="font-size: 0.85rem; color: var(--gray);">
                                    <i class="fas fa-key"></i> ${a.keyword ? escapeHtml(a.keyword) : 'No keyword target'}
                                </div>
                                <div style="font-size: 0.85rem; color: var(--gray);">
                                    <i class="fas fa-clock"></i> ${new Date(a.created_at).toLocaleDateString()}
                                </div>
                                <div style="margin-top: auto; padding-top: 12px;">
                                    <button class="btn btn-sm" style="width: 100%; justify-content: center; background: var(--bg); border: 1px solid var(--border); color: var(--text);" onclick="loadHistoricalAudit('${escapeHtml(a.id)}')">View Results</button>
                                </div>
                            </div>
                        `).join('');
                    } else {
                        container.style.display = 'none';
                    }
                })
                .catch(console.error);
        });
    } catch (err) {
        console.error('Failed to init onpage projects', err);
    }
}

window.loadHistoricalAudit = function(id) {
    const audit = window.onpageHistoryCache[id];
    if (!audit) return;
    
    const result = {
        url: audit.url,
        keyword: audit.keyword,
        score: audit.overall_score,
        summary: audit.summary || {},
        issues: audit.issues || []
    };
    
    lastResult = result;
    resetAiFixStates();
    renderResults(result);
    document.getElementById('onpage-results').style.display = 'block';
    document.getElementById('onpage-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
};

function toggleInputMode() {
    const mode  = document.getElementById('onpage-input-mode').value;
    document.getElementById('onpage-url-row').style.display   = mode === 'url'  ? '' : 'none';
    document.getElementById('onpage-html-row').style.display  = mode === 'html' ? '' : 'none';
}

// ── Run Analysis ──────────────────────────────────────────────────────────────
async function runAnalysis() {
    const mode    = document.getElementById('onpage-input-mode')?.value || 'url';
    const keyword = document.getElementById('onpage-keyword-input')?.value.trim() || '';
    const url     = document.getElementById('onpage-url-input')?.value.trim() || '';
    const html    = document.getElementById('onpage-html-input')?.value.trim() || '';

    if (mode === 'url' && !url)  { showToast('Enter a URL to analyze', 'error'); return; }
    if (mode === 'html' && !html){ showToast('Paste your HTML code', 'error'); return; }

    setAnalyzeLoading(true);
    document.getElementById('onpage-results').style.display = 'none';

    try {
        const projectId = document.getElementById('onpage-project-select')?.value || '';
        const body = mode === 'url' ? { url, keyword, projectId } : { html, keyword, projectId };
        const res  = await fetch('/api/onpage/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Analysis failed');

        lastResult = data.result;
        resetAiFixStates();        // clear stale AI fix panels from previous analysis
        renderResults(data.result);
        document.getElementById('onpage-results').style.display = 'block';
        document.getElementById('onpage-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        showToast('Analysis failed: ' + err.message, 'error');
    } finally {
        setAnalyzeLoading(false);
    }
}

function resetAiFixStates() {
    // Hide all open fix areas
    document.querySelectorAll('.onpage-fix-area').forEach(el => {
        el.style.display = 'none';
        el.innerHTML = '';
    });
    // Reset AI Fix buttons back to default (removes green "Fixed" styling)
    document.querySelectorAll('.onpage-ai-btn').forEach(btn => {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-magic"></i> AI Fix';
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
    });
}

let _progressTimer = null;
const ONPAGE_PROGRESS_STEPS = [
    '🌐 Fetching page...',
    '📄 Extracting content...',
    '🔍 Running 47 checks...',
    '📊 Scoring results...',
    '⚡ Almost there...',
];

function setAnalyzeLoading(on) {
    const btn = document.getElementById('onpage-analyze-btn');
    if (!btn) return;
    btn.disabled = on;

    if (on) {
        let step = 0;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${ONPAGE_PROGRESS_STEPS[0]}`;
        _progressTimer = setInterval(() => {
            step = (step + 1) % ONPAGE_PROGRESS_STEPS.length;
            btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${ONPAGE_PROGRESS_STEPS[step]}`;
        }, 2500);
    } else {
        clearInterval(_progressTimer);
        _progressTimer = null;
        btn.innerHTML = '<i class="fas fa-search"></i> Analyze Page';
    }
}

// ── Render Results ────────────────────────────────────────────────────────────
function renderResults(r) {
    const criticals  = r.issues.filter(i => i.severity === 'critical').length;
    const importants = r.issues.filter(i => i.severity === 'important').length;
    const goods      = r.issues.filter(i => i.severity === 'good').length;
    renderOverallScore(r.overall, r.issues.length, criticals, importants, goods);
    renderCategoryScores(r.categories);
    renderIssuesList(r.issues, r);
    renderPageSnapshot(r);
    renderRawData(r);
}

function renderOverallScore(score, total, criticals, importants, goods) {
    const el    = document.getElementById('onpage-overall-score');
    const label = document.getElementById('onpage-overall-label');
    const info  = document.getElementById('onpage-overall-info');
    if (!el) return;

    const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
    const text  = score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';

    el.textContent    = score;
    el.style.color    = color;
    if (label) label.textContent = text;
    if (info)  info.textContent  = `${total} total issue${total !== 1 ? 's' : ''} found`;

    // Animate circle
    const circle = document.getElementById('onpage-score-circle');
    if (circle) {
        const offset = 283 - (283 * score) / 100;
        circle.style.strokeDashoffset = offset;
        circle.style.stroke = color;
    }

    // Severity summary pills — clickable to filter issues list
    let pillsContainer = document.getElementById('onpage-sev-pills');
    if (!pillsContainer) {
        pillsContainer = document.createElement('div');
        pillsContainer.id = 'onpage-sev-pills';
        pillsContainer.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;';
        const scoreInfo = document.getElementById('onpage-overall-info');
        if (scoreInfo) scoreInfo.parentNode.insertBefore(pillsContainer, scoreInfo.nextSibling);
    }
    pillsContainer.innerHTML = [
        criticals  > 0 ? `<button class="onpage-sev-pill sev-critical" onclick="filterBySeverity('critical')">🔴 ${criticals} Critical</button>` : '',
        importants > 0 ? `<button class="onpage-sev-pill sev-important" onclick="filterBySeverity('important')">🟡 ${importants} Important</button>` : '',
        goods      > 0 ? `<button class="onpage-sev-pill sev-good" onclick="filterBySeverity('good')">✅ ${goods} Good to have</button>` : '',
    ].join('');
}

function renderRawData(r) {
    const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.innerHTML = val; };
    const setCnt = (id, count) => { const el = document.getElementById(id); if(el) el.textContent = count; };

    // 1. Images
    const imgs = r.images.allImgs || [];
    setCnt('data-img-count', imgs.length);
    let imgHtml = '';
    if (imgs.length === 0) {
        imgHtml = '<div class="data-item-row" style="color:var(--text-muted)">No images found.</div>';
    } else {
        imgHtml = imgs.map((i, idx) => `
            <div class="data-item-row">
                <div class="data-item-label">Image ${idx + 1}</div>
                <div style="display:flex;gap:12px;align-items:flex-start">
                    <img src="${escHtml(i.src || '')}" style="width:40px;height:40px;object-fit:cover;border-radius:4px;background:#eee" onerror="this.style.display='none'">
                    <div>
                        <div style="margin-bottom:4px"><span class="onpage-label">Src:</span> <span class="data-item-val">${escHtml(i.src || '—')}</span></div>
                        <div><span class="onpage-label">Alt:</span> <span class="data-item-val">${escHtml(i.alt !== undefined ? i.alt : '(missing alt attribute)')}</span></div>
                    </div>
                </div>
            </div>
        `).join('');
    }
    setEl('data-images-list', imgHtml);

    // 2. Links
    const links = r.links.internalList || [];
    setCnt('data-link-count', r.links.internal);
    let linkHtml = '';
    if (links.length === 0) {
        linkHtml = '<div class="data-item-row" style="color:var(--text-muted)">No internal links found.</div>';
    } else {
        linkHtml = links.map((l, idx) => `
            <div class="data-item-row">
                <div class="data-item-label">Link ${idx + 1}</div>
                <div style="margin-bottom:4px"><span class="onpage-label">Href:</span> <span class="data-item-val">${escHtml(l.href || '—')}</span></div>
                <div><span class="onpage-label">Text:</span> <span class="data-item-val">${escHtml(l.text || '(no anchor text)')}</span></div>
            </div>
        `).join('');
        if (r.links.internal > 50) {
            linkHtml += `<div class="data-item-row" style="color:var(--text-muted);font-style:italic">Showing first 50 internal links out of ${r.links.internal}.</div>`;
        }
    }
    setEl('data-links-list', linkHtml);

    // 3. Headings
    const h1s = r.headings.h1s || [];
    const h2s = r.headings.h2s || [];
    let headHtml = '';
    if (h1s.length === 0 && h2s.length === 0) {
        headHtml = '<div class="data-item-row" style="color:var(--text-muted)">No H1 or H2 headings found.</div>';
    } else {
        if (h1s.length > 0) {
            headHtml += h1s.map(h => `<div class="data-item-row"><div class="data-item-label">H1</div><div class="data-item-val">${escHtml(h)}</div></div>`).join('');
        }
        if (h2s.length > 0) {
            headHtml += h2s.map(h => `<div class="data-item-row"><div class="data-item-label">H2</div><div class="data-item-val">${escHtml(h)}</div></div>`).join('');
        }
    }
    setEl('data-headings-list', headHtml);

    // 4. Meta & Technical
    const metaHtml = `
        <div class="data-item-row"><div class="data-item-label">Robots Meta</div><div class="data-item-val">${escHtml(r.meta.robots || '(Not set - defaults to index, follow)')}</div></div>
        <div class="data-item-row"><div class="data-item-label">Canonical URL</div><div class="data-item-val">${escHtml(r.meta.canonical || '(Not set)')}</div></div>
        <div class="data-item-row"><div class="data-item-label">Sitemap Link</div><div class="data-item-val">${escHtml(r.technical.sitemapLink || '(Not set)')}</div></div>
        <div class="data-item-row"><div class="data-item-label">Language (lang)</div><div class="data-item-val">${escHtml(r.meta.langAttr || '(Not set)')}</div></div>
        <div class="data-item-row"><div class="data-item-label">Viewport</div><div class="data-item-val">${escHtml(r.meta.viewport || '(Not set)')}</div></div>
        <div class="data-item-row"><div class="data-item-label">Open Graph Title</div><div class="data-item-val">${escHtml(r.meta.ogTitle || '(Not set)')}</div></div>
    `;
    setEl('data-technical-list', metaHtml);
}

function renderCategoryScores(categories) {
    const container = document.getElementById('onpage-category-scores');
    if (!container) return;

    container.innerHTML = Object.entries(categories).map(([key, cat]) => {
        const info  = CATEGORY_LABELS[key] || { label: key, icon: 'fa-check' };
        const color = cat.score >= 80 ? '#10b981' : cat.score >= 50 ? '#f59e0b' : '#ef4444';
        const problems = cat.critical + cat.important;
        return `
        <div class="onpage-cat-card" onclick="filterByCategory('${key}')">
            <div class="onpage-cat-icon"><i class="fas ${info.icon}"></i></div>
            <div class="onpage-cat-body">
                <div class="onpage-cat-name">${info.label}</div>
                <div class="onpage-cat-bar">
                    <div class="onpage-cat-fill" style="width:${cat.score}%;background:${color}"></div>
                </div>
                <div class="onpage-cat-meta">
                    <span style="color:${color};font-weight:600">${cat.score}/100</span>
                    ${problems > 0 ? `<span class="onpage-cat-issues">${problems} issue${problems > 1 ? 's' : ''}</span>` : '<span style="color:#10b981">&#10003; OK</span>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderIssuesList(issues, r) {
    const container = document.getElementById('onpage-issues-list');
    if (!container) return;

    const sorted = [...issues].sort((a, b) =>
        (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
    );

    if (!sorted.length) {
        container.innerHTML = '<div class="onpage-no-issues"><i class="fas fa-check-circle"></i> No issues found! This page is well optimized.</div>';
        return;
    }

    container.innerHTML = sorted.map((issue, idx) => {
        const cat   = CATEGORY_LABELS[issue.category] || { label: issue.category };
        const sev   = issue.severity;
        const sevClass = sev === 'critical' ? 'sev-critical' : sev === 'important' ? 'sev-important' : 'sev-good';
        const sevLabel = sev === 'critical' ? 'Critical' : sev === 'important' ? 'Important' : 'Good to have';

        return `
        <div class="onpage-issue" id="issue-${idx}" data-category="${issue.category}" data-severity="${sev}">
            <div class="onpage-issue-header">
                <span class="onpage-sev ${sevClass}">${sevLabel}</span>
                <span class="onpage-issue-cat">${cat.label}</span>
                <div class="onpage-issue-title">${issue.name}</div>
                <button class="onpage-ai-btn" onclick="getAiFix(${idx})" title="Get AI fix">
                    <i class="fas fa-magic"></i> AI Fix
                </button>
            </div>
            <div class="onpage-issue-desc">${issue.desc}</div>
            ${issue.current ? `<div class="onpage-issue-current"><span class="onpage-label">Current:</span> <code>${escHtml(String(issue.current).slice(0, 200))}</code></div>` : ''}
            ${issue.expected ? `<div class="onpage-issue-expected"><span class="onpage-label">Expected:</span> <span>${escHtml(issue.expected)}</span></div>` : ''}
            <div class="onpage-fix-area" id="fix-area-${idx}" style="display:none"></div>
        </div>`;
    }).join('');
}

function renderPageSnapshot(r) {
    const el = document.getElementById('onpage-snapshot');
    if (!el) return;

    // ── Populate SERP preview ─────────────────────────────────────────────────
    const titleLen = (r.meta.title || '').length;
    const descLen  = (r.meta.metaDesc || '').length;
    let domain = '', urlPath = '';
    try {
        if (r.url) {
            const u = new URL(r.url);
            domain  = u.hostname;
            urlPath = u.pathname.replace(/\/$/, '') || '';
        }
    } catch {}

    const setEl = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    const setHtml = (id, val) => { const e = document.getElementById(id); if (e) e.innerHTML = val; };

    setEl('serp-site-name', domain || 'yoursite.com');
    setEl('serp-breadcrumb', domain ? `${domain}${urlPath}` : 'yoursite.com › page');
    setEl('serp-title', r.meta.title || '(No title tag found)');
    setEl('serp-desc',  r.meta.metaDesc || '(No meta description found)');

    // Title character counter
    const titleOk = titleLen >= 30 && titleLen <= 60;
    setHtml('serp-title-chars',
        `<span style="color:${titleOk ? '#10b981' : '#ef4444'};font-size:0.72rem;font-weight:600">${titleLen}/60 chars${titleLen > 60 ? ' — too long' : titleLen < 30 ? ' — too short' : ' ✓'}</span>`
    );
    // Description character counter
    const descOk = descLen >= 70 && descLen <= 160;
    setHtml('serp-desc-chars',
        descLen > 0
            ? `<span style="color:${descOk ? '#10b981' : '#ef4444'};font-size:0.72rem;font-weight:600">${descLen}/160 chars${descLen > 160 ? ' — will be cut off' : descLen < 70 ? ' — too short' : ' ✓'}</span>`
            : ''
    );

    // Colour-code title if too long (simulate truncation)
    const titleEl = document.getElementById('serp-title');
    if (titleEl) {
        titleEl.style.color = titleLen > 60 ? '#ef4444' : '';
        if (titleLen > 60) {
            const safe = r.meta.title.slice(0, 57);
            titleEl.innerHTML = `${escHtml(safe)}<span style="color:#9ca3af">…</span>`;
        }
    }

    // ── Snapshot metric rows ──────────────────────────────────────────────────
    const rows = [
        ['Title',         r.meta.title          || '—', !r.meta.title],
        ['Meta Desc',     r.meta.metaDesc        ? r.meta.metaDesc.slice(0, 80) + '…' : '—', !r.meta.metaDesc],
        ['H1',           (r.headings.h1s[0]     || '—').slice(0, 60), r.headings.h1s.length !== 1],
        ['H2 count',      String(r.headings.h2s.length), r.headings.h2s.length < 2],
        ['Word count',    String(r.content.wordCount), r.content.wordCount < 500],
        ['KW density',    r.content.kwDensity + '%', r.content.kwDensity < 0.5 || r.content.kwDensity > 3],
        ['Flesch score',  String(r.content.flesch), r.content.flesch < 60 && r.content.flesch > 0],
        ['Schema',        r.schema.types.length ? r.schema.types.join(', ') : 'None', r.schema.count === 0],
        ['Images',        `${r.images.total} total, ${r.images.noAlt} missing alt`, r.images.noAlt > 0],
        ['Internal links',String(r.links.internal), r.links.internal < 3],
        ['HTTPS',         r.technical.isHttps ? 'Yes' : 'No', !r.technical.isHttps],
        ['Canonical',     r.technical.hasCanonical ? 'Present' : 'Missing', !r.technical.hasCanonical],
        ['Viewport',      r.technical.hasViewport ? 'Present' : 'Missing', !r.technical.hasViewport],
        ['OG Tags',       r.technical.hasOg ? 'Present' : 'Missing', !r.technical.hasOg],
        ['Twitter Card',  r.technical.hasTwitterCard ? 'Present' : 'Missing', !r.technical.hasTwitterCard],
    ];

    el.innerHTML = rows.map(([label, val, warn]) => `
        <div class="onpage-snap-row">
            <span class="onpage-snap-label">${label}</span>
            <span class="onpage-snap-val ${warn ? 'snap-warn' : 'snap-ok'}">${escHtml(val)}</span>
            <span class="snap-dot ${warn ? 'dot-warn' : 'dot-ok'}"></span>
        </div>`).join('');
}

// ── Category Filter ───────────────────────────────────────────────────────────
function filterByCategory(cat) {
    let visibleCount = 0;
    // Filter issue rows
    document.querySelectorAll('.onpage-issue').forEach(el => {
        const isVisible = (cat === 'all' || el.dataset.category === cat);
        el.style.display = isVisible ? '' : 'none';
        if (isVisible) visibleCount++;
    });

    const container = document.getElementById('onpage-issues-list');
    if (container) {
        const existingEmpty = container.querySelector('.onpage-cat-success');
        if (existingEmpty) existingEmpty.remove();

        if (visibleCount === 0 && cat !== 'all' && window.lastResult) {
            const r = window.lastResult;
            let successHtml = '';
            
            if (cat === 'title') {
                successHtml = `<strong>Extracted Title:</strong><br><code>${escHtml(r.meta.title || 'None')}</code>`;
            } else if (cat === 'meta') {
                successHtml = `<strong>Extracted Meta Description:</strong><br><code>${escHtml(r.meta.metaDesc || 'None')}</code>`;
            } else if (cat === 'headings') {
                successHtml = `<strong>H1 Tag:</strong><br><code>${escHtml((r.headings.h1s || [])[0] || 'None')}</code><br><br>
                               <strong>H2 Tags (${(r.headings.h2s || []).length}):</strong><br>` + 
                               (r.headings.h2s || []).slice(0,10).map(h => `<code>${escHtml(h)}</code>`).join('<br>');
            } else if (cat === 'images') {
                const imgs = r.images.allImgs || [];
                successHtml = `<strong>Images Found (${r.images.total}):</strong><br>` + 
                              imgs.slice(0, 10).map(img => `<code>&lt;img alt="${escHtml(img.alt || '')}" src="${escHtml((img.src || '').split('/').pop())}"&gt;</code>`).join('<br>');
            } else if (cat === 'links') {
                const links = r.links.internalList || [];
                successHtml = `<strong>Internal Links (${r.links.internal}):</strong><br>` + 
                              links.slice(0, 10).map(l => `<code>&lt;a href="${escHtml(l.href || '')}"&gt;${escHtml(l.text || '')}&lt;/a&gt;</code>`).join('<br>');
            } else if (cat === 'schema') {
                successHtml = `<strong>Schema Types Found:</strong><br><code>${escHtml((r.schema.types || []).join(', ') || 'None')}</code>`;
            } else if (cat === 'url') {
                successHtml = `<strong>Analyzed URL:</strong><br><code>${escHtml(r.url || 'None')}</code>`;
            } else if (cat === 'breadcrumb') {
                successHtml = `<strong>Breadcrumb Navigation:</strong> ${r.breadcrumb.hasNav ? '✅ Found' : '❌ Not Found'}<br>
                               <strong>Breadcrumb Schema:</strong> ${r.breadcrumb.hasSchema ? '✅ Found' : '❌ Not Found'}`;
            } else if (cat === 'content') {
                successHtml = `<strong>Word Count:</strong> ${r.content.wordCount}<br>
                               <strong>Keyword Matches:</strong> ${r.content.kwMatches}<br>
                               <strong>Keyword Density:</strong> ${r.content.kwDensity}%<br>
                               <strong>Readability:</strong> ${r.content.flesch}`;
            } else if (cat === 'technical') {
                successHtml = `<strong>HTTPS:</strong> ${r.technical.isHttps ? 'Yes' : 'No'}<br>
                               <strong>Canonical:</strong> ${r.technical.hasCanonical ? 'Present' : 'Missing'}<br>
                               <strong>Viewport:</strong> ${r.technical.hasViewport ? 'Present' : 'Missing'}<br>
                               <strong>Language:</strong> ${r.technical.hasLang ? 'Present' : 'Missing'}`;
            }

            const emptyState = document.createElement('div');
            emptyState.className = 'onpage-cat-success';
            emptyState.innerHTML = `<div style="text-align:center; padding: 20px 0;">
                                        <i class="fas fa-check-circle" style="color:#10b981;font-size:2.5rem;margin-bottom:10px;"></i>
                                        <div style="font-size:1.1rem; color:#374151; font-weight:600;">Perfect! No issues found for ${CATEGORY_LABELS[cat]?.label || cat}.</div>
                                    </div>
                                    ${successHtml ? `<div style="background:#f9fafb; padding:15px; border-radius:8px; font-size:0.9rem; color:#4b5563; max-height: 300px; overflow-y: auto; border: 1px solid #e5e7eb; word-break: break-all;">${successHtml}</div>` : ''}`;
            
            emptyState.style.padding = '20px 30px 30px';
            emptyState.style.background = '#ffffff';
            emptyState.style.borderRadius = '12px';
            emptyState.style.border = '1px solid #e5e7eb';
            emptyState.style.marginTop = '20px';
            
            container.appendChild(emptyState);
        }
    }

    // Sync category score cards
    document.querySelectorAll('.onpage-cat-card').forEach(el => {
        el.classList.toggle('active', el.onclick?.toString().includes(`'${cat}'`));
    });

    // Sync filter pill buttons — match button text against category key or label
    const catLabel = (CATEGORY_LABELS[cat]?.label || cat).toLowerCase();
    document.querySelectorAll('.onpage-filter-btn').forEach(btn => {
        const btnText = btn.textContent.trim().toLowerCase();
        const isActive = cat === 'all'
            ? btnText === 'all'
            : btnText === cat || btnText === catLabel;
        btn.classList.toggle('active', isActive);
    });

    document.getElementById('onpage-issues-list')?.scrollIntoView({ behavior: 'smooth' });
}

// Filter issues by severity level (used by severity summary pills)
function filterBySeverity(sev) {
    document.querySelectorAll('.onpage-issue').forEach(el => {
        el.style.display = el.dataset.severity === sev ? '' : 'none';
    });
    // Reset category filter pill to "All"
    document.querySelectorAll('.onpage-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === 'all');
    });
    document.querySelectorAll('.onpage-cat-card').forEach(el => el.classList.remove('active'));
    document.getElementById('onpage-issues-list')?.scrollIntoView({ behavior: 'smooth' });
}

// ── AI Fix ────────────────────────────────────────────────────────────────────
async function getAiFix(idx) {
    if (!lastResult) return;

    const sorted = [...lastResult.issues].sort((a, b) =>
        (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9)
    );
    const issue  = sorted[idx];
    const fixArea = document.getElementById(`fix-area-${idx}`);
    const btn    = document.querySelector(`#issue-${idx} .onpage-ai-btn`);
    if (!fixArea || !issue) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating...';
    fixArea.style.display = 'block';
    fixArea.innerHTML = '<div class="onpage-fix-loading"><i class="fas fa-magic"></i> AI is writing your fix...</div>';

    try {
        const res  = await fetch('/api/onpage/ai-fix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                issue,
                context: {
                    keyword: lastResult.keyword,
                    url:     lastResult.url,
                    title:   lastResult.meta?.title,
                },
            }),
        });
        const data = await res.json();
        const fix  = data.fix || {};

        fixArea.innerHTML = `
            <div class="onpage-fix-box">
                <div class="onpage-fix-label"><i class="fas fa-lightbulb"></i> Why this matters</div>
                <div class="onpage-fix-explanation">${escHtml(fix.explanation || issue.desc)}</div>
                ${fix.before ? `
                <div class="onpage-fix-diff">
                    <div class="diff-col diff-before">
                        <div class="diff-head">Before</div>
                        <pre class="diff-code">${escHtml(fix.before)}</pre>
                    </div>
                    <div class="diff-col diff-after">
                        <div class="diff-head">After</div>
                        <pre class="diff-code">${escHtml(fix.after || fix.fixCode || '')}</pre>
                    </div>
                </div>` : ''}
                <div class="onpage-fix-label" style="margin-top:12px"><i class="fas fa-code"></i> Copy this code</div>
                <div class="onpage-fix-code-wrap">
                    <pre class="onpage-fix-code">${escHtml(fix.fixCode || issue.fix || '')}</pre>
                    <button class="onpage-copy-btn" onclick="copyFix(this)">
                        <i class="fas fa-copy"></i> Copy
                    </button>
                </div>
            </div>`;
    } catch (err) {
        fixArea.innerHTML = `
            <div class="onpage-fix-box">
                <div class="onpage-fix-label"><i class="fas fa-code"></i> Suggested fix</div>
                <div class="onpage-fix-code-wrap">
                    <pre class="onpage-fix-code">${escHtml(issue.fix || '')}</pre>
                    <button class="onpage-copy-btn" onclick="copyFix(this)"><i class="fas fa-copy"></i> Copy</button>
                </div>
            </div>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check"></i> Fixed';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        btn.style.color = 'white';
    }
}

function copyFix(btn) {
    const code = btn.previousElementSibling?.textContent || '';
    navigator.clipboard.writeText(code).then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = '<i class="fas fa-copy"></i> Copy'; }, 2000);
    });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Export Report ─────────────────────────────────────────────────────────────
function downloadReport() {
    if (!lastResult) { showToast('Run an analysis first', 'error'); return; }
    const r = lastResult;
    const date = new Date().toISOString().slice(0, 10);
    const sevIcon = { critical: '🔴', important: '🟡', good: '✅' };

    const lines = [
        '═══════════════════════════════════════════════════',
        '  ON-PAGE SEO AUDIT REPORT',
        `  Generated: ${new Date().toLocaleString()}`,
        '═══════════════════════════════════════════════════',
        '',
        `URL:      ${r.url || '(HTML paste)'}`,
        `Keyword:  ${r.keyword || '(none)'}`,
        `Score:    ${r.overall}/100`,
        '',
        '─── CATEGORY SCORES ───────────────────────────────',
        ...Object.entries(r.categories).map(([cat, data]) =>
            `  ${cat.padEnd(12)} ${String(data.score).padStart(3)}/100   ` +
            `🔴${data.critical} 🟡${data.important} ✅${data.good}`
        ),
        '',
        `─── ISSUES (${r.issues.length} total) ──────────────────────────────`,
        ...r.issues.map((issue, i) => [
            '',
            `${i + 1}. ${sevIcon[issue.severity] || '•'} [${issue.severity.toUpperCase()}] ${issue.name}`,
            `   Category : ${issue.category}`,
            `   Why it matters: ${issue.desc}`,
            issue.current  ? `   Current  : ${issue.current}` : null,
            issue.expected ? `   Expected : ${issue.expected}` : null,
            issue.fix      ? `   Fix:\n${issue.fix.split('\n').map(l => '      ' + l).join('\n')}` : null,
        ].filter(Boolean).join('\n')),
        '',
        '═══════════════════════════════════════════════════',
        '  Generated by On-Page SEO Analyzer',
        '═══════════════════════════════════════════════════',
    ];

    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `seo-audit-${date}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('Report downloaded!', 'success');
}
