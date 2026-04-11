const TECHNICAL_CATEGORY_LABELS = {
    crawlability: { label: 'Crawlability', icon: 'fa-spider', weight: 30 },
    indexability: { label: 'Indexability', icon: 'fa-binoculars', weight: 35 },
    sitemaps: { label: 'Sitemaps', icon: 'fa-sitemap', weight: 15 },
    architecture: { label: 'Site Architecture', icon: 'fa-diagram-project', weight: 20 },
};

const TECHNICAL_SEV_ORDER = { critical: 0, important: 1, good: 2 };
let lastTechnicalResult = null;

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('technical-audit-btn')?.addEventListener('click', runTechnicalAudit);
    document.getElementById('technical-site-input')?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            runTechnicalAudit();
        }
    });
});

async function runTechnicalAudit() {
    const url = document.getElementById('technical-site-input')?.value.trim() || '';
    const maxPages = Number(document.getElementById('technical-max-pages')?.value || 20);

    if (!url) {
        showToast('Enter a site URL to audit', 'error');
        return;
    }

    setTechnicalLoading(true);
    document.getElementById('technical-results').style.display = 'none';

    try {
        const res = await fetch('/api/technical/audit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, maxPages }),
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Technical audit failed');
        }

        lastTechnicalResult = data.result;
        renderTechnicalResults(data.result);
        document.getElementById('technical-results').style.display = 'block';
        document.getElementById('technical-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        showToast('Technical audit failed: ' + err.message, 'error');
    } finally {
        setTechnicalLoading(false);
    }
}

function setTechnicalLoading(on) {
    const btn = document.getElementById('technical-audit-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on
        ? '<i class="fas fa-spinner fa-spin"></i> Crawling site...'
        : '<i class="fas fa-spider"></i> Run Technical Audit';
}

function renderTechnicalResults(result) {
    renderTechnicalScore(result.overall, result.summary.pagesCrawled, result.issues.length);
    renderTechnicalSummary(result.summary, result.robotsTxt, result.sitemaps);
    renderTechnicalCategories(result.categories || {});
    renderTechnicalIssues(result.issues || []);
    renderTechnicalPages(result.pages || []);
}

function renderTechnicalScore(score, pagesCrawled, issuesFound) {
    const scoreEl = document.getElementById('technical-overall-score');
    const labelEl = document.getElementById('technical-overall-label');
    const infoEl = document.getElementById('technical-overall-info');
    const ring = document.getElementById('technical-score-circle');
    if (!scoreEl) return;

    const color = score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';
    const label = score >= 80 ? 'Healthy' : score >= 50 ? 'Needs Fixes' : 'High Risk';
    const circumference = 2 * Math.PI * 45;
    const offset = circumference - (score / 100) * circumference;

    scoreEl.textContent = score;
    scoreEl.style.color = color;
    if (labelEl) labelEl.textContent = label;
    if (infoEl) infoEl.textContent = `${pagesCrawled} pages crawled · ${issuesFound} issues found`;
    if (ring) {
        ring.style.strokeDasharray = circumference;
        ring.style.strokeDashoffset = offset;
        ring.style.stroke = color;
    }
}

function renderTechnicalSummary(summary = {}, robotsTxt = {}, sitemaps = []) {
    const container = document.getElementById('technical-summary-grid');
    if (!container) return;

    const cards = [
        { label: 'Pages Crawled', value: summary.pagesCrawled || 0, tone: 'blue' },
        { label: 'Broken Pages', value: summary.brokenPages || 0, tone: (summary.brokenPages || 0) ? 'red' : 'green' },
        { label: 'Redirects', value: summary.redirects || 0, tone: (summary.redirects || 0) ? 'orange' : 'green' },
        { label: 'Noindex Pages', value: summary.noindexPages || 0, tone: (summary.noindexPages || 0) ? 'orange' : 'green' },
        { label: 'Missing Canonicals', value: summary.missingCanonicals || 0, tone: (summary.missingCanonicals || 0) ? 'red' : 'green' },
        { label: 'Sitemaps Found', value: sitemaps.length || 0, tone: sitemaps.length ? 'green' : 'orange' },
        { label: 'Orphan Sitemap URLs', value: summary.orphanSitemapUrls || 0, tone: (summary.orphanSitemapUrls || 0) ? 'orange' : 'green' },
        { label: 'robots.txt', value: robotsTxt.found ? 'Present' : 'Missing', tone: robotsTxt.found ? 'green' : 'red' },
    ];

    container.innerHTML = cards.map((card) => `
        <div class="technical-metric-card ${card.tone}">
            <div class="technical-metric-label">${card.label}</div>
            <div class="technical-metric-value">${technicalEscHtml(String(card.value))}</div>
        </div>
    `).join('');

    const infra = document.getElementById('technical-infra-summary');
    if (infra) {
        infra.innerHTML = `
            <div class="technical-infra-item"><strong>robots.txt:</strong> ${robotsTxt.found ? 'Found' : 'Not found'}${robotsTxt.status ? ` (${robotsTxt.status})` : ''}</div>
            <div class="technical-infra-item"><strong>Sitemaps:</strong> ${sitemaps.length ? sitemaps.map((item) => technicalEscHtml(item.url)).join('<br>') : 'None discovered'}</div>
        `;
    }
}

function renderTechnicalCategories(categories) {
    const container = document.getElementById('technical-category-scores');
    if (!container) return;

    container.innerHTML = Object.entries(categories).map(([key, category]) => {
        const info = TECHNICAL_CATEGORY_LABELS[key] || { label: key, icon: 'fa-chart-simple' };
        const color = category.score >= 80 ? '#10b981' : category.score >= 50 ? '#f59e0b' : '#ef4444';
        const problemCount = (category.critical || 0) + (category.important || 0);
        return `
            <div class="technical-cat-card" data-category="${key}" onclick="technicalFilterByCategory('${key}')">
                <div class="technical-cat-icon"><i class="fas ${info.icon}"></i></div>
                <div class="technical-cat-body">
                    <div class="technical-cat-name">${info.label}</div>
                    <div class="technical-cat-bar"><div class="technical-cat-fill" style="width:${category.score}%;background:${color}"></div></div>
                    <div class="technical-cat-meta">
                        <span style="color:${color};font-weight:600">${category.score}/100</span>
                        <span>${problemCount ? `${problemCount} issues` : 'OK'}</span>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderTechnicalIssues(issues) {
    const container = document.getElementById('technical-issues-list');
    if (!container) return;

    const sorted = [...issues].sort((a, b) => (TECHNICAL_SEV_ORDER[a.severity] ?? 9) - (TECHNICAL_SEV_ORDER[b.severity] ?? 9));
    if (!sorted.length) {
        container.innerHTML = '<div class="technical-empty-state"><i class="fas fa-check-circle"></i> No technical issues found in this crawl.</div>';
        return;
    }

    container.innerHTML = sorted.map((issue) => {
        const severityClass = issue.severity === 'critical' ? 'sev-critical' : issue.severity === 'important' ? 'sev-important' : 'sev-good';
        const severityLabel = issue.severity === 'critical' ? 'Critical' : issue.severity === 'important' ? 'Important' : 'Good to fix';
        const category = TECHNICAL_CATEGORY_LABELS[issue.category]?.label || issue.category;
        const affected = (issue.affectedUrls || []).slice(0, 5);

        return `
            <div class="technical-issue" data-category="${issue.category}">
                <div class="technical-issue-header">
                    <span class="onpage-sev ${severityClass}">${severityLabel}</span>
                    <span class="technical-issue-cat">${technicalEscHtml(category)}</span>
                    <div class="technical-issue-title">${technicalEscHtml(issue.name)}</div>
                </div>
                <div class="technical-issue-desc">${technicalEscHtml(issue.desc || '')}</div>
                ${issue.current ? `<div class="technical-issue-meta"><strong>Current:</strong> ${technicalEscHtml(issue.current)}</div>` : ''}
                ${issue.expected ? `<div class="technical-issue-meta"><strong>Expected:</strong> ${technicalEscHtml(issue.expected)}</div>` : ''}
                ${issue.fix ? `<div class="technical-issue-fix"><strong>Fix:</strong> ${technicalEscHtml(issue.fix)}</div>` : ''}
                ${affected.length ? `<div class="technical-affected-list">${affected.map((url) => `<span class="technical-url-pill">${technicalEscHtml(url)}</span>`).join('')}</div>` : ''}
            </div>
        `;
    }).join('');
}

function renderTechnicalPages(pages) {
    const tbody = document.getElementById('technical-pages-body');
    if (!tbody) return;

    if (!pages.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="technical-table-empty">No crawled pages to show yet.</td></tr>';
        return;
    }

    tbody.innerHTML = pages.map((page) => `
        <tr>
            <td><span class="technical-status-badge status-${technicalStatusClass(page.status)}">${technicalEscHtml(String(page.status || '—'))}</span></td>
            <td><div class="technical-url-cell" title="${technicalEscHtml(page.url || '')}">${technicalEscHtml(page.url || '')}</div></td>
            <td>${technicalEscHtml(page.title || '—')}</td>
            <td>${technicalEscHtml(String(page.depth ?? '—'))}</td>
            <td>${technicalEscHtml(page.canonicalStatus || '—')}</td>
            <td>${technicalEscHtml((page.issues || []).join(', ') || 'OK')}</td>
        </tr>
    `).join('');
}

function technicalFilterByCategory(category) {
    document.querySelectorAll('.technical-issue').forEach((element) => {
        element.style.display = category === 'all' || element.dataset.category === category ? '' : 'none';
    });

    document.querySelectorAll('.technical-issues-controls .onpage-filter-btn').forEach((button) => {
        button.classList.toggle('active', button.dataset.category === category);
    });

    document.querySelectorAll('.technical-cat-card').forEach((card) => {
        card.classList.toggle('active', category !== 'all' && card.dataset.category === category);
    });
}

function technicalStatusClass(status) {
    const code = Number(status || 0);
    if (code >= 200 && code < 300) return 'ok';
    if (code >= 300 && code < 400) return 'redirect';
    if (code >= 400) return 'error';
    return 'unknown';
}

function technicalEscHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
