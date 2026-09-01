const TECHNICAL_CATEGORY_LABELS = {
    crawlability: { label: 'Crawlability', icon: 'fa-spider', weight: 30 },
    indexability: { label: 'Indexability', icon: 'fa-binoculars', weight: 35 },
    sitemaps: { label: 'Sitemaps', icon: 'fa-sitemap', weight: 15 },
    architecture: { label: 'Site Architecture', icon: 'fa-diagram-project', weight: 20 },
    content: { label: 'Content Quality', icon: 'fa-pen-nib', weight: 20 },
    performance: { label: 'Performance', icon: 'fa-gauge-high', weight: 15 },
    security: { label: 'Security', icon: 'fa-shield-halved', weight: 15 },
};

const TECHNICAL_SEV_ORDER = { critical: 0, important: 1, good: 2 };
let lastTechnicalResult = null;
let pageSpeedClientsCache = [];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('technical-audit-btn')?.addEventListener('click', runTechnicalAudit);
    document.getElementById('pagespeed-check-btn')?.addEventListener('click', runPageSpeedCheck);
    document.getElementById('pagespeed-refresh-history-btn')?.addEventListener('click', loadPageSpeedHistory);
    document.getElementById('pagespeed-client-select')?.addEventListener('change', handlePageSpeedClientChange);
    loadPageSpeedClients();
    document.getElementById('technical-site-input')?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            runTechnicalAudit();
        }
    });
    document.getElementById('pagespeed-url-input')?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            runPageSpeedCheck();
        }
    });

    // Technical SEO additions
    document.getElementById('technical-load-btn')?.addEventListener('click', loadPastAudit);
    document.getElementById('technical-export-csv-btn')?.addEventListener('click', exportTechnicalCSV);
    loadTechnicalHistory();
});


async function loadPageSpeedClients() {
    const select = document.getElementById('pagespeed-client-select');
    if (!select) return;
    try {
        const res = await fetch('/api/clients');
        const data = await res.json();
        pageSpeedClientsCache = data.clients || [];
        select.innerHTML = '<option value="">No client selected</option>' + pageSpeedClientsCache.map(client => `
            <option value="${technicalEscHtml(client.id)}" data-url="${technicalEscHtml(client.website_url || '')}">${technicalEscHtml(client.name)}${client.website_url ? ' - ' + technicalEscHtml(client.website_url) : ''}</option>
        `).join('');
        loadPageSpeedHistory();
    } catch (err) {
        console.warn('Could not load clients for PageSpeed:', err.message);
    }
}

function handlePageSpeedClientChange() {
    const select = document.getElementById('pagespeed-client-select');
    const urlInput = document.getElementById('pagespeed-url-input');
    const selected = select?.options[select.selectedIndex];
    const website = selected?.dataset?.url || '';
    if (website && urlInput) {
        urlInput.value = website;
    }
    loadPageSpeedHistory();
}

async function loadPageSpeedHistory() {
    const container = document.getElementById('pagespeed-history-list');
    if (!container) return;
    const clientId = document.getElementById('pagespeed-client-select')?.value || '';
    try {
        const url = clientId ? `/api/technical/pagespeed/checks?clientId=${encodeURIComponent(clientId)}` : '/api/technical/pagespeed/checks';
        const res = await fetch(url);
        const data = await res.json();
        const checks = data.checks || [];
        if (!checks.length) {
            container.innerHTML = '<p class="text-muted">No PageSpeed checks saved yet.</p>';
            return;
        }
        container.innerHTML = checks.map(check => `
            <div class="pagespeed-history-row">
                <div>
                    <strong>${technicalEscHtml(check.client_name || 'Unassigned')}</strong>
                    <span>${technicalEscHtml((check.final_url || check.url || '').replace(/^https?:\/\//, ''))}</span>
                </div>
                <div class="pagespeed-history-scores">
                    <span title="Performance">P ${technicalEscHtml(String(check.performance_score ?? '—'))}</span>
                    <span title="SEO">SEO ${technicalEscHtml(String(check.seo_score ?? '—'))}</span>
                    <small>${technicalEscHtml(check.strategy || 'mobile')} · ${formatPageSpeedDate(check.created_at)}</small>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = '<p class="text-muted">Could not load PageSpeed history.</p>';
    }
}

function formatPageSpeedDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function runTechnicalAudit() {
    const url = document.getElementById('technical-site-input')?.value.trim() || '';
    const maxPages = Number(document.getElementById('technical-max-pages')?.value || 20);
    const checkSecurityHeaders = document.getElementById('technical-check-security-headers')?.checked || false;

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
            body: JSON.stringify({ url, maxPages, checkSecurityHeaders }),
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
    renderTechnicalSummary(result.summary, result.robotsTxt, result.sitemaps, result.crawlConfig || {});
    renderTechnicalCategories(result.categories || {});
    renderTechnicalIssues(result.issues || []);
    renderTechnicalPages(result.pages || []);
}

async function loadTechnicalHistory() {
    const dropdown = document.getElementById('technical-history-dropdown');
    if (!dropdown) return;

    try {
        const res = await fetch('/api/technical/audits');
        const data = await res.json();
        
        if (data.success && data.audits && data.audits.length > 0) {
            dropdown.innerHTML = '<option value="">-- Load Recent Audit --</option>' + 
                data.audits.map(audit => `
                    <option value="${audit.id}">
                        ${technicalEscHtml(audit.site_url.replace(/^https?:\/\//, ''))} - Score: ${audit.overall_score} (${formatPageSpeedDate(audit.created_at)})
                    </option>
                `).join('');
        } else {
            dropdown.innerHTML = '<option value="">No past audits found</option>';
        }
    } catch (err) {
        console.warn('Could not load technical audit history:', err.message);
    }
}

async function loadPastAudit() {
    const dropdown = document.getElementById('technical-history-dropdown');
    const auditId = dropdown?.value;
    if (!auditId) {
        showToast('Please select an audit from the dropdown to load', 'error');
        return;
    }

    setTechnicalLoading(true);
    document.getElementById('technical-results').style.display = 'none';

    try {
        const res = await fetch(`/api/technical/audit/${auditId}`);
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to load past audit');
        }

        lastTechnicalResult = data.result;
        renderTechnicalResults(data.result);
        
        // Update input field to show loaded URL
        const urlInput = document.getElementById('technical-site-input');
        if (urlInput) urlInput.value = data.result.siteUrl;

        document.getElementById('technical-results').style.display = 'block';
        document.getElementById('technical-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('Past audit loaded successfully', 'success');
    } catch (err) {
        showToast('Failed to load audit: ' + err.message, 'error');
    } finally {
        setTechnicalLoading(false);
    }
}

function exportTechnicalCSV() {
    if (!lastTechnicalResult || !lastTechnicalResult.pages || !lastTechnicalResult.pages.length) {
        showToast('No crawled pages available to export.', 'error');
        return;
    }

    const pages = lastTechnicalResult.pages;
    
    // Define CSV headers
    const headers = [
        'URL', 'Status', 'Depth', 'Title', 'Meta Description', 'Canonical', 
        'Canonical Status', 'H1 Count', 'Word Count', 'Internal Links', 
        'External Links', 'Images', 'Images Missing Alt', 'Issues'
    ];

    // Map pages to CSV rows
    const rows = pages.map(page => [
        page.url,
        page.status || '0',
        page.depth || '0',
        page.title || '',
        page.metaDescription || '',
        page.canonical || '',
        page.canonicalStatus || '',
        page.h1Count || '0',
        page.wordCount || '0',
        page.internalLinks || '0',
        page.externalLinks || '0',
        page.imageCount || '0',
        page.imagesMissingAlt || '0',
        (page.issues || []).join(' | ')
    ]);

    // Build CSV string safely
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    // Trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    
    // Format filename based on site URL
    const siteDomain = lastTechnicalResult.siteUrl.replace(/^https?:\/\//, '').replace(/\/.*/, '');
    const dateStr = new Date().toISOString().split('T')[0];
    
    a.href = url;
    a.download = `technical_audit_${siteDomain}_${dateStr}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

function renderTechnicalSummary(summary = {}, robotsTxt = {}, sitemaps = [], crawlConfig = {}) {
    const container = document.getElementById('technical-summary-grid');
    if (!container) return;

    const cards = [
        { label: 'Pages Crawled', value: summary.pagesCrawled || 0, tone: 'blue' },
        { label: 'Broken Pages', value: summary.brokenPages || 0, tone: (summary.brokenPages || 0) ? 'red' : 'green' },
        { label: 'Redirects', value: summary.redirects || 0, tone: (summary.redirects || 0) ? 'orange' : 'green' },
        { label: 'Noindex Pages', value: summary.noindexPages || 0, tone: (summary.noindexPages || 0) ? 'orange' : 'green' },
        { label: 'Missing Canonicals', value: summary.missingCanonicals || 0, tone: (summary.missingCanonicals || 0) ? 'red' : 'green' },
        { label: 'Canonical Chain Issues', value: summary.canonicalChainIssues || 0, tone: (summary.canonicalChainIssues || 0) ? 'red' : 'green' },
        { label: 'Hreflang Issues', value: summary.hreflangIssues || 0, tone: (summary.hreflangIssues || 0) ? 'orange' : 'green' },
        { label: 'Pagination Issues', value: summary.paginationIssues || 0, tone: (summary.paginationIssues || 0) ? 'orange' : 'green' },
        { label: 'Pages with Schema', value: summary.pagesWithSchema || 0, tone: (summary.pagesWithSchema || 0) ? 'green' : 'orange' },
        { label: 'Missing H1', value: summary.missingH1Pages || 0, tone: (summary.missingH1Pages || 0) ? 'red' : 'green' },
        { label: 'Invalid Heading Hierarchy', value: summary.invalidHeadingHierarchyPages || 0, tone: (summary.invalidHeadingHierarchyPages || 0) ? 'orange' : 'green' },
        { label: 'Images Missing Alt', value: summary.imagesMissingAlt || 0, tone: (summary.imagesMissingAlt || 0) ? 'orange' : 'green' },
        { label: 'Images Missing Dimensions', value: summary.imagesMissingDimensions || 0, tone: (summary.imagesMissingDimensions || 0) ? 'orange' : 'green' },
        { label: 'Thin Content Pages', value: summary.thinContentPages || 0, tone: (summary.thinContentPages || 0) ? 'orange' : 'green' },
        { label: 'Mixed Content Pages', value: summary.mixedContentPages || 0, tone: (summary.mixedContentPages || 0) ? 'red' : 'green' },
        { label: 'Missing Security Headers', value: summary.missingSecurityHeadersPages || 0, tone: (summary.missingSecurityHeadersPages || 0) ? 'orange' : 'green' },
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
            <div class="technical-infra-item"><strong>Security headers:</strong> ${crawlConfig.checkSecurityHeaders ? (summary.missingSecurityHeaderCounts && Object.keys(summary.missingSecurityHeaderCounts).length ? technicalEscHtml(Object.entries(summary.missingSecurityHeaderCounts).map(([header, count]) => `${header}: ${count}`).join(', ')) : 'Recommended headers present') : 'Optional check not enabled'}</div>
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

    tbody.innerHTML = pages.map((page) => {
        const headingSummary = page.h1Count
            ? `H1 ${technicalEscHtml(page.h1Count)} · H2 ${technicalEscHtml(page.h2Count || 0)}${page.headingHierarchyValid === false ? ' · skipped levels' : ''}`
            : 'No H1';
        const imageSummary = page.imageCount
            ? `${technicalEscHtml(page.imageCount)} total · ${technicalEscHtml(page.imagesMissingAlt || 0)} missing alt${page.imagesMissingDimensions ? ' · ' + technicalEscHtml(page.imagesMissingDimensions) + ' missing dims' : ''}`
            : 'No images';
        const wordSummary = page.wordCount
            ? `${technicalEscHtml(page.wordCount)} words${page.wordCount < 300 ? ' · thin' : ''}`
            : '—';
        const securitySummary = page.missingSecurityHeaders && page.missingSecurityHeaders.length
            ? `Missing ${technicalEscHtml(page.missingSecurityHeaders.slice(0, 3).join(', '))}${page.missingSecurityHeaders.length > 3 ? ', ...' : ''}`
            : 'OK';

        return `
            <tr>
                <td><span class="technical-status-badge status-${technicalStatusClass(page.status)}">${technicalEscHtml(String(page.status || '—'))}</span></td>
                <td><div class="technical-url-cell" title="${technicalEscHtml(page.url || '')}">${technicalEscHtml(page.url || '')}</div></td>
                <td>${technicalEscHtml(page.title || '—')}</td>
                <td>${technicalEscHtml(String(page.depth ?? '—'))}</td>
                <td>${technicalEscHtml(page.canonicalStatus || '—')}</td>
                <td>${headingSummary}</td>
                <td>${imageSummary}</td>
                <td>${wordSummary}</td>
                <td>${securitySummary}</td>
                <td>${technicalEscHtml((page.issues || []).join(', ') || 'OK')}</td>
            </tr>
        `;
    }).join('');
}


async function runPageSpeedCheck() {
    const url = document.getElementById('pagespeed-url-input')?.value.trim() || '';
    const clientId = document.getElementById('pagespeed-client-select')?.value || null;
    if (!url) {
        showToast('Enter a site URL to test PageSpeed', 'error');
        return;
    }

    setPageSpeedLoading(true);
    const results = document.getElementById('pagespeed-results');
    if (results) results.style.display = 'none';

    try {
        const res = await fetch('/api/technical/pagespeed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url,
                strategy: document.getElementById('pagespeed-strategy-input')?.value || 'mobile',
                clientId,
            }),
        });
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'PageSpeed check failed');
        }

        renderPageSpeedResults(data.result);
        loadPageSpeedHistory();
        if (results) {
            results.style.display = 'block';
            results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (err) {
        showToast('PageSpeed check failed: ' + err.message, 'error');
    } finally {
        setPageSpeedLoading(false);
    }
}

function setPageSpeedLoading(on) {
    const btn = document.getElementById('pagespeed-check-btn');
    if (!btn) return;
    btn.disabled = on;
    btn.innerHTML = on
        ? '<i class="fas fa-spinner fa-spin"></i> Checking PageSpeed...'
        : '<i class="fas fa-bolt"></i> Run PageSpeed';
}

function renderPageSpeedResults(result = {}) {
    const sourceLabel = document.getElementById('pagespeed-source-label');
    if (sourceLabel) {
        sourceLabel.textContent = `${result.strategy || 'mobile'} lab data for ${result.finalUrl || result.url || 'site'}`;
    }

    const scores = result.scores || {};
    const scoreGrid = document.getElementById('pagespeed-score-grid');
    if (scoreGrid) {
        scoreGrid.innerHTML = [
            { label: 'Performance', value: scores.performance, icon: 'fa-gauge-high' },
            { label: 'Accessibility', value: scores.accessibility, icon: 'fa-universal-access' },
            { label: 'Best Practices', value: scores.bestPractices, icon: 'fa-shield-halved' },
            { label: 'SEO', value: scores.seo, icon: 'fa-magnifying-glass-chart' },
        ].map(item => pageSpeedScoreCard(item)).join('');
    }

    // CrUX field data
    const crux = result.crux;
    const cruxContainer = document.getElementById('pagespeed-crux-grid');
    if (cruxContainer) {
        if (crux && crux.metrics && Object.keys(crux.metrics).length > 0) {
            const ratingColors = { good: '#10b981', needs_improvement: '#f59e0b', poor: '#ef4444', unknown: '#6b7280' };
            const ratingLabels = { good: 'Good', needs_improvement: 'Needs Improvement', poor: 'Poor', unknown: 'N/A' };
            const cruxItems = [
                { key: 'lcp', label: 'LCP', unit: 'ms' },
                { key: 'inp', label: 'INP', unit: 'ms' },
                { key: 'cls', label: 'CLS', unit: '' },
                { key: 'fcp', label: 'FCP', unit: 'ms' },
                { key: 'ttfb', label: 'TTFB', unit: 'ms' },
            ].filter(item => crux.metrics[item.key]);

            cruxContainer.innerHTML = cruxItems.length ? `
                <h4><i class="fas fa-users"></i> Field Data (Real Users${crux.recordPeriod ? ' — ' + technicalEscHtml(crux.recordPeriod) : ''})</h4>
                <div class="pagespeed-metric-grid">
                    ${cruxItems.map(item => {
                        const m = crux.metrics[item.key];
                        const color = ratingColors[m.rating] || ratingColors.unknown;
                        return `
                            <div class="pagespeed-metric-card" style="border-top:3px solid ${color}">
                                <div class="pagespeed-metric-name">${technicalEscHtml(item.label)} (p75)</div>
                                <div class="pagespeed-metric-value">${technicalEscHtml(String(m.p75))}${item.unit ? ' ' + item.unit : ''}</div>
                                <div class="pagespeed-metric-title" style="color:${color};font-weight:600">${ratingLabels[m.rating] || 'N/A'}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : '<p class="text-muted">No field data available for this origin.</p>';
        } else if (cruxContainer) {
            cruxContainer.innerHTML = '<p class="text-muted">CrUX field data not available (site may have insufficient traffic).</p>';
        }
    }

    const metrics = result.metrics || {};
    const metricGrid = document.getElementById('pagespeed-metric-grid');
    if (metricGrid) {
        const metricItems = [
            { key: 'lcp', label: 'LCP' },
            { key: 'inp', label: 'INP' },
            { key: 'cls', label: 'CLS' },
            { key: 'fcp', label: 'FCP' },
            { key: 'speedIndex', label: 'Speed Index' },
            { key: 'tbt', label: 'TBT' },
        ];
        metricGrid.innerHTML = metricItems.map(item => {
            const metric = metrics[item.key] || {};
            return `
                <div class="pagespeed-metric-card">
                    <div class="pagespeed-metric-name">${technicalEscHtml(item.label)}</div>
                    <div class="pagespeed-metric-value">${technicalEscHtml(metric.displayValue || '—')}</div>
                    <div class="pagespeed-metric-title">${technicalEscHtml(metric.title || '')}</div>
                </div>
            `;
        }).join('');
    }

    const suggestions = document.getElementById('pagespeed-suggestions');
    if (suggestions) {
        const items = result.suggestions || [];
        suggestions.innerHTML = items.length
            ? `<h4>Suggested fixes</h4>${items.map(item => `<div class="pagespeed-suggestion"><i class="fas fa-check"></i><span>${technicalEscHtml(item)}</span></div>`).join('')}`
            : '<h4>Suggested fixes</h4><div class="technical-empty-state" style="padding:14px 0;">No major PageSpeed suggestions found.</div>';
    }

    const opportunities = document.getElementById('pagespeed-opportunities');
    if (opportunities) {
        const items = result.opportunities || [];
        opportunities.innerHTML = items.length
            ? `<h4>Top opportunities</h4>${items.slice(0, 6).map(item => `
                <div class="pagespeed-opportunity">
                    <div><strong>${technicalEscHtml(item.title)}</strong>${item.displayValue ? `<span>${technicalEscHtml(item.displayValue)}</span>` : ''}</div>
                    <small>${item.savingsMs ? `${technicalEscHtml(String(item.savingsMs))} ms potential saving` : ''}</small>
                </div>
            `).join('')}`
            : '';
    }
}

function pageSpeedScoreCard(item) {
    const value = item.value ?? '—';
    const numeric = Number(item.value);
    const tone = Number.isFinite(numeric) && numeric >= 90 ? 'green' : Number.isFinite(numeric) && numeric >= 50 ? 'orange' : 'red';
    return `
        <div class="pagespeed-score-card ${tone}">
            <div class="pagespeed-score-icon"><i class="fas ${item.icon}"></i></div>
            <div>
                <div class="pagespeed-score-value">${technicalEscHtml(String(value))}</div>
                <div class="pagespeed-score-label">${technicalEscHtml(item.label)}</div>
            </div>
        </div>
    `;
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
