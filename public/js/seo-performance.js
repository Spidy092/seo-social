let seoPerfLoaded = false;

function seoPerfNumber(value) {
    const n = Number(value) || 0;
    return n.toLocaleString();
}

function seoPerfPct(value) {
    const n = Number(value) || 0;
    return `${n.toFixed(1)}%`;
}

async function initSeoPerformancePage() {
    const select = document.getElementById('seoPerfClientSelect');
    const refresh = document.getElementById('seoPerfRefreshBtn');
    if (!select) return;

    if (!seoPerfLoaded) {
        refresh?.addEventListener('click', () => loadSeoPerformanceData());
        await loadSeoPerformanceClients();
        seoPerfLoaded = true;
    }

    await loadSeoPerformanceData();
}

async function loadSeoPerformanceClients() {
    const select = document.getElementById('seoPerfClientSelect');
    if (!select) return;

    try {
        const res = await fetch('/api/ga4/clients');
        const data = await res.json();
        const clients = data.clients || [];
        select.innerHTML = clients.length
            ? clients.map(client => `<option value="${client.id}">${client.name}${client.ga4_property_id ? '' : ' (GA4 not connected)'}</option>`).join('')
            : '<option value="">No clients found</option>';
    } catch (err) {
        select.innerHTML = '<option value="">Could not load clients</option>';
    }
}

async function loadSeoPerformanceData() {
    const clientId = document.getElementById('seoPerfClientSelect')?.value;
    if (!clientId) return;

    const kpis = document.getElementById('seoPerfKpis');
    const opportunities = document.getElementById('seoPerfOpportunities');
    const keywordPages = document.getElementById('seoPerfKeywordPages');

    if (kpis) kpis.innerHTML = '<div class="card"><p class="text-muted">Loading SEO performance...</p></div>';
    if (opportunities) opportunities.innerHTML = '<p class="text-muted">Loading opportunities...</p>';
    if (keywordPages) keywordPages.innerHTML = '<p class="text-muted">Loading keyword-page data...</p>';

    try {
        const [overviewRes, oppRes, keywordRes] = await Promise.all([
            fetch(`/api/seo-performance/overview/${encodeURIComponent(clientId)}`).then(r => r.json()),
            fetch(`/api/seo-performance/opportunities/${encodeURIComponent(clientId)}?limit=20`).then(r => r.json()),
            fetch(`/api/seo-performance/keyword-pages/${encodeURIComponent(clientId)}?limit=30`).then(r => r.json()),
        ]);

        renderSeoPerformanceKpis(overviewRes.data || {});
        renderSeoPerformanceOpportunities(oppRes.data || []);
        renderSeoPerformanceKeywordPages(keywordRes.data || []);
    } catch (err) {
        if (kpis) kpis.innerHTML = `<div class="card"><p class="text-danger">${err.message || 'Could not load SEO performance.'}</p></div>`;
    }
}

function renderSeoPerformanceKpis(data) {
    const el = document.getElementById('seoPerfKpis');
    if (!el) return;

    const cards = [
        ['Organic Clicks', seoPerfNumber(data.clicks), 'fa-mouse-pointer'],
        ['Organic Sessions', seoPerfNumber(data.sessions), 'fa-chart-line'],
        ['SEO Conversions', seoPerfNumber(data.conversions), 'fa-bullseye'],
        ['CTR', seoPerfPct(data.ctrPct), 'fa-percent'],
        ['Pages Analyzed', seoPerfNumber(data.pagesAnalyzed), 'fa-file-lines'],
        ['High Priority Issues', seoPerfNumber(data.highPriorityIssues), 'fa-triangle-exclamation'],
    ];

    el.innerHTML = cards.map(([label, value, icon]) => `
        <div class="metric-card">
            <div class="metric-header">
                <span class="metric-label">${label}</span>
                <span class="metric-icon"><i class="fas ${icon}"></i></span>
            </div>
            <div class="metric-value">${value}</div>
        </div>
    `).join('');
}

function renderSeoPerformanceOpportunities(rows) {
    const el = document.getElementById('seoPerfOpportunities');
    if (!el) return;

    if (!rows.length) {
        el.innerHTML = '<p class="text-muted">No combined opportunities yet. Sync GSC and GA4 for this client first.</p>';
        return;
    }

    el.innerHTML = `
        <table class="data-table premium">
            <thead><tr><th>Page</th><th>Issue</th><th>Clicks</th><th>Sessions</th><th>Bounce</th><th>Conversions</th><th>Action</th></tr></thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td style="max-width:260px;word-break:break-word;">${row.page || row.normalizedUrl}</td>
                        <td><span class="badge">${row.insightTitle}</span></td>
                        <td>${seoPerfNumber(row.clicks)}</td>
                        <td>${seoPerfNumber(row.sessions)}</td>
                        <td>${seoPerfPct(row.bounceRate)}</td>
                        <td>${seoPerfNumber(row.conversions)}</td>
                        <td>${row.recommendedAction}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function renderSeoPerformanceKeywordPages(rows) {
    const el = document.getElementById('seoPerfKeywordPages');
    if (!el) return;

    if (!rows.length) {
        el.innerHTML = '<p class="text-muted">No keyword-page rows yet. Run a fresh GSC sync after this update.</p>';
        return;
    }

    el.innerHTML = `
        <table class="data-table premium">
            <thead><tr><th>Keyword</th><th>Page</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th><th>Sessions</th><th>Conv.</th></tr></thead>
            <tbody>
                ${rows.map(row => `
                    <tr>
                        <td>${row.keyword || '-'}</td>
                        <td style="max-width:260px;word-break:break-word;">${row.page || row.normalizedUrl}</td>
                        <td>${seoPerfNumber(row.clicks)}</td>
                        <td>${seoPerfNumber(row.impressions)}</td>
                        <td>${seoPerfPct(row.ctrPct)}</td>
                        <td>${Number(row.avgPosition || 0).toFixed(1)}</td>
                        <td>${seoPerfNumber(row.sessions)}</td>
                        <td>${seoPerfNumber(row.conversions)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}
