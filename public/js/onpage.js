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
});

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
        const body = mode === 'url' ? { url, keyword } : { html, keyword };
        const res  = await fetch('/api/onpage/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Analysis failed');

        lastResult = data.result;
        renderResults(data.result);
        document.getElementById('onpage-results').style.display = 'block';
        document.getElementById('onpage-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        showToast('Analysis failed: ' + err.message, 'error');
    } finally {
        setAnalyzeLoading(false);
    }
}

function setAnalyzeLoading(on) {
    const btn = document.getElementById('onpage-analyze-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on
        ? '<i class="fas fa-spinner fa-spin"></i> Analyzing...'
        : '<i class="fas fa-search"></i> Analyze Page';
}

// ── Render Results ────────────────────────────────────────────────────────────
function renderResults(r) {
    renderOverallScore(r.overall, r.issues.length, r.issues.filter(i => i.severity === 'critical').length);
    renderCategoryScores(r.categories);
    renderIssuesList(r.issues, r);
    renderPageSnapshot(r);
}

function renderOverallScore(score, total, criticals) {
    const el    = document.getElementById('onpage-overall-score');
    const label = document.getElementById('onpage-overall-label');
    const info  = document.getElementById('onpage-overall-info');
    if (!el) return;

    const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
    const text  = score >= 80 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';

    el.textContent    = score;
    el.style.color    = color;
    if (label) label.textContent = text;
    if (info)  info.textContent  = `${total} issues found · ${criticals} critical`;

    // Animate circle
    const circle = document.getElementById('onpage-score-circle');
    if (circle) {
        const circumference = 2 * Math.PI * 45;
        const offset = circumference - (score / 100) * circumference;
        circle.style.strokeDasharray  = circumference;
        circle.style.strokeDashoffset = offset;
        circle.style.stroke = color;
    }
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
        <div class="onpage-issue" id="issue-${idx}" data-category="${issue.category}">
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

    const rows = [
        ['Title',        r.meta.title          || '—', !r.meta.title],
        ['Meta Desc',    r.meta.metaDesc        ? r.meta.metaDesc.slice(0, 80) + '…' : '—', !r.meta.metaDesc],
        ['H1',          (r.headings.h1s[0]     || '—').slice(0, 60), r.headings.h1s.length !== 1],
        ['H2 count',     String(r.headings.h2s.length), r.headings.h2s.length < 2],
        ['Word count',   String(r.content.wordCount), r.content.wordCount < 500],
        ['KW density',   r.content.kwDensity + '%', r.content.kwDensity < 0.5 || r.content.kwDensity > 3],
        ['Flesch score', String(r.content.flesch), r.content.flesch < 60],
        ['Schema',       r.schema.types.length ? r.schema.types.join(', ') : 'None', r.schema.count === 0],
        ['Images',       `${r.images.total} total, ${r.images.noAlt} missing alt`, r.images.noAlt > 0],
        ['Internal links', String(r.links.internal), r.links.internal < 3],
        ['HTTPS',        r.technical.isHttps ? 'Yes' : 'No', !r.technical.isHttps],
        ['Canonical',    r.technical.hasCanonical ? 'Present' : 'Missing', !r.technical.hasCanonical],
        ['Viewport',     r.technical.hasViewport ? 'Present' : 'Missing', !r.technical.hasViewport],
        ['OG Tags',      r.technical.hasOg ? 'Present' : 'Missing', !r.technical.hasOg],
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
    document.querySelectorAll('.onpage-issue').forEach(el => {
        el.style.display = (cat === 'all' || el.dataset.category === cat) ? '' : 'none';
    });
    document.querySelectorAll('.onpage-cat-card').forEach(el => {
        el.classList.toggle('active', el.onclick?.toString().includes(`'${cat}'`));
    });
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
