let searchVisibilityLoaded = false;
let searchVisibilityClients = [];
let searchVisibilityProjects = [];
let latestSearchVisibilityRecommendations = [];
let latestSearchVisibilityUrl = '';

function svEscape(value) {
    if (typeof escapeHtml === 'function') return escapeHtml(value);
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[ch]));
}

function svStatusBadge(value, label) {
    return `<span class="badge" style="background:${value ? '#dcfce7' : '#fee2e2'};color:${value ? '#166534' : '#991b1b'};">${label || (value ? 'Ready' : 'Missing')}</span>`;
}

async function svFetchJson(url, options = {}) {
    const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
    return data;
}

async function initSearchVisibilityPage() {
    const select = document.getElementById('svClientSelect');
    if (!select) return;

    if (!searchVisibilityLoaded) {
        document.getElementById('svRefreshBtn')?.addEventListener('click', () => loadSearchVisibilityData());
        document.getElementById('svClientSelect')?.addEventListener('change', () => loadSearchVisibilityData());
        document.getElementById('svConnectGscBtn')?.addEventListener('click', connectSearchVisibilityGsc);
        document.getElementById('svConnectGa4Btn')?.addEventListener('click', connectSearchVisibilityGa4);
        document.getElementById('svSaveIndexNowBtn')?.addEventListener('click', saveSearchVisibilityIndexNow);
        document.getElementById('svSyncGscBtn')?.addEventListener('click', () => syncSearchVisibilitySource('gsc'));
        document.getElementById('svSyncGa4Btn')?.addEventListener('click', () => syncSearchVisibilitySource('ga4'));
        document.getElementById('svInspectBtn')?.addEventListener('click', inspectSearchVisibilityUrl);
        document.getElementById('svListSitemapsBtn')?.addEventListener('click', loadSearchVisibilitySitemaps);
        document.getElementById('svSubmitSitemapBtn')?.addEventListener('click', submitSearchVisibilitySitemap);
        document.getElementById('svSubmitIndexNowBtn')?.addEventListener('click', submitSearchVisibilityIndexNow);
        document.getElementById('svGoogleIndexingBtn')?.addEventListener('click', notifySearchVisibilityGoogleIndexing);
        document.getElementById('svCreateTaskBtn')?.addEventListener('click', createSearchVisibilityTask);
        document.getElementById('svCreateAlertsBtn')?.addEventListener('click', createSearchVisibilityAlerts);
        document.getElementById('svCreateTasksBtn')?.addEventListener('click', createSearchVisibilityTasks);
        await loadSearchVisibilityClients();
        searchVisibilityLoaded = true;
    }

    await loadSearchVisibilityData();
}

async function loadSearchVisibilityClients() {
    const select = document.getElementById('svClientSelect');
    if (!select) return;
    try {
        const data = await svFetchJson('/api/clients');
        searchVisibilityClients = data.clients || [];
        select.innerHTML = searchVisibilityClients.length
            ? searchVisibilityClients.map(client => `<option value="${client.id}">${svEscape(client.name)}</option>`).join('')
            : '<option value="">No clients found</option>';
    } catch (err) {
        select.innerHTML = '<option value="">Could not load clients</option>';
        showToast?.(err.message, 'error');
    }
}

async function loadSearchVisibilityData() {
    const clientId = document.getElementById('svClientSelect')?.value;
    if (!clientId) return;

    await Promise.all([
        loadSearchVisibilityStatus(clientId),
        loadSearchVisibilityProjects(clientId),
        loadSearchVisibilityActions(clientId),
    ]);
}

async function loadSearchVisibilityStatus(clientId) {
    const el = document.getElementById('svStatusCards');
    if (el) el.innerHTML = '<div class="card"><p class="text-muted">Loading connection status...</p></div>';

    try {
        const data = await svFetchJson(`/api/search-visibility/status/${encodeURIComponent(clientId)}`);
        const status = data.status || {};
        const client = data.client || {};
        if (document.getElementById('svGscSiteUrl')) document.getElementById('svGscSiteUrl').value = client.gscSiteUrl || client.websiteUrl || '';
        if (document.getElementById('svGa4PropertyId')) document.getElementById('svGa4PropertyId').value = client.ga4PropertyId || '';
        if (document.getElementById('svIndexNowLocation')) document.getElementById('svIndexNowLocation').value = client.indexNowKeyLocation || '';

        el.innerHTML = `
            <div class="metric-card"><div class="metric-label">Service Account</div><div class="metric-value">${svStatusBadge(status.googleServiceAccountConfigured)}</div></div>
            <div class="metric-card"><div class="metric-label">Search Console</div><div class="metric-value">${svStatusBadge(status.gscConnected)}</div><small>${svEscape(client.gscSiteUrl || 'No property connected')}</small></div>
            <div class="metric-card"><div class="metric-label">GA4</div><div class="metric-value">${svStatusBadge(status.ga4Connected)}</div><small>${svEscape(client.ga4PropertyId || 'No property connected')}</small></div>
            <div class="metric-card"><div class="metric-label">IndexNow</div><div class="metric-value">${svStatusBadge(status.indexNowConfigured)}</div><small>${svEscape(client.indexNowKeyLocation || 'Key not configured')}</small></div>
        `;

        const next = document.getElementById('svNextActions');
        if (next) {
            next.innerHTML = (data.nextActions || []).length
                ? `<ul>${data.nextActions.map(item => `<li>${svEscape(item)}</li>`).join('')}</ul>`
                : '<p class="text-muted">Connections look ready. Use URL Inspection or discovery tools below.</p>';
        }
    } catch (err) {
        if (el) el.innerHTML = `<div class="card"><p class="text-danger">${svEscape(err.message)}</p></div>`;
    }
}

async function loadSearchVisibilityProjects(clientId) {
    const select = document.getElementById('svProjectSelect');
    if (!select) return;
    try {
        const data = await svFetchJson(`/api/clients/${encodeURIComponent(clientId)}/projects`);
        searchVisibilityProjects = data.projects || [];
        select.innerHTML = searchVisibilityProjects.length
            ? searchVisibilityProjects.map(project => `<option value="${project.id}">${svEscape(project.name)}</option>`).join('')
            : '<option value="">No projects for this client</option>';
    } catch (_) {
        select.innerHTML = '<option value="">Could not load projects</option>';
    }
}

async function connectSearchVisibilityGsc() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const siteUrl = document.getElementById('svGscSiteUrl')?.value;
    if (!clientId || !siteUrl) return showToast?.('Client and GSC property are required', 'error');
    try {
        await svFetchJson('/api/gsc/connect', { method: 'POST', body: JSON.stringify({ clientId, siteUrl }) });
        showToast?.('Search Console property connected', 'success');
        await loadSearchVisibilityData();
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function connectSearchVisibilityGa4() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const propertyId = document.getElementById('svGa4PropertyId')?.value;
    if (!clientId || !propertyId) return showToast?.('Client and numeric GA4 property ID are required', 'error');
    try {
        await svFetchJson('/api/ga4/connect', { method: 'POST', body: JSON.stringify({ clientId, propertyId }) });
        showToast?.('GA4 property connected', 'success');
        await loadSearchVisibilityData();
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function saveSearchVisibilityIndexNow() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const key = document.getElementById('svIndexNowKey')?.value;
    const keyLocation = document.getElementById('svIndexNowLocation')?.value;
    if (!clientId || !key) return showToast?.('Client and IndexNow key are required', 'error');
    try {
        await svFetchJson('/api/search-visibility/indexnow/connect', { method: 'POST', body: JSON.stringify({ clientId, key, keyLocation }) });
        document.getElementById('svIndexNowKey').value = '';
        showToast?.('IndexNow key saved', 'success');
        await loadSearchVisibilityData();
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function syncSearchVisibilitySource(source) {
    const clientId = document.getElementById('svClientSelect')?.value;
    if (!clientId) return;
    try {
        const days = 30;
        await svFetchJson(`/api/${source}/sync/${encodeURIComponent(clientId)}`, { method: 'POST', body: JSON.stringify({ days }) });
        showToast?.(`${source.toUpperCase()} sync completed`, 'success');
        await loadSearchVisibilityData();
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function inspectSearchVisibilityUrl() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const inspectionUrl = document.getElementById('svInspectionUrl')?.value;
    const output = document.getElementById('svInspectionResult');
    if (!clientId || !inspectionUrl) return showToast?.('Client and URL are required', 'error');
    if (output) output.innerHTML = '<p class="text-muted">Inspecting URL...</p>';
    try {
        const data = await svFetchJson('/api/search-visibility/inspect', {
            method: 'POST',
            body: JSON.stringify({ clientId, inspectionUrl }),
        });
        latestSearchVisibilityRecommendations = data.recommendations || [];
        latestSearchVisibilityUrl = inspectionUrl;
        renderSearchVisibilityInspection(data);
        await loadSearchVisibilityActions(clientId);
    } catch (err) {
        if (output) output.innerHTML = `<p class="text-danger">${svEscape(err.message)}</p>`;
    }
}

function renderSearchVisibilityInspection(data) {
    const output = document.getElementById('svInspectionResult');
    const taskBtn = document.getElementById('svCreateTaskBtn');
    if (!output) return;
    const index = data.result?.inspectionResult?.indexStatusResult || {};
    const rows = [
        ['Verdict', index.verdict || '-'],
        ['Coverage', index.coverageState || '-'],
        ['Robots', index.robotsTxtState || '-'],
        ['Indexing', index.indexingState || '-'],
        ['Fetch', index.pageFetchState || '-'],
        ['User canonical', index.userCanonical || '-'],
        ['Google canonical', index.googleCanonical || '-'],
    ];
    output.innerHTML = `
        <table class="data-table premium"><tbody>
            ${rows.map(([k, v]) => `<tr><th>${svEscape(k)}</th><td>${svEscape(v)}</td></tr>`).join('')}
        </tbody></table>
        <h4 style="margin:16px 0 8px;">Recommended fixes</h4>
        <ul>${(data.recommendations || []).map(item => `<li>${svEscape(item)}</li>`).join('')}</ul>
        <p class="text-muted" style="font-size:.82rem;">URL Inspection shows Google Search Console status. It does not guarantee immediate indexing.</p>
    `;
    if (taskBtn) taskBtn.disabled = !(data.recommendations || []).length;
}

async function loadSearchVisibilitySitemaps() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const el = document.getElementById('svSitemapsList');
    if (!clientId || !el) return;
    el.innerHTML = '<p class="text-muted">Loading sitemaps...</p>';
    try {
        const data = await svFetchJson(`/api/search-visibility/sitemaps/${encodeURIComponent(clientId)}`);
        const rows = data.sitemaps || [];
        el.innerHTML = rows.length
            ? `<table class="data-table premium"><thead><tr><th>Sitemap</th><th>Submitted</th><th>Errors</th><th>Warnings</th></tr></thead><tbody>${rows.map(row => `
                <tr><td>${svEscape(row.path || row.feedpath || row.url || '-')}</td><td>${svEscape(row.lastSubmitted || '-')}</td><td>${Number(row.errors || 0)}</td><td>${Number(row.warnings || 0)}</td></tr>
            `).join('')}</tbody></table>`
            : '<p class="text-muted">No submitted sitemaps returned by Search Console.</p>';
    } catch (err) {
        el.innerHTML = `<p class="text-danger">${svEscape(err.message)}</p>`;
    }
}

async function submitSearchVisibilitySitemap() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const sitemapUrl = document.getElementById('svSitemapUrl')?.value;
    if (!clientId || !sitemapUrl) return showToast?.('Client and sitemap URL are required', 'error');
    try {
        const data = await svFetchJson('/api/search-visibility/sitemaps/submit', { method: 'POST', body: JSON.stringify({ clientId, sitemapUrl }) });
        showToast?.('Sitemap submitted to Search Console', 'success');
        renderSearchVisibilityRecommendations(data.recommendations || []);
        await Promise.all([loadSearchVisibilitySitemaps(), loadSearchVisibilityActions(clientId)]);
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function submitSearchVisibilityIndexNow() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const raw = document.getElementById('svIndexNowUrls')?.value || '';
    const urls = raw.split(/[\\n,]+/).map(v => v.trim()).filter(Boolean);
    if (!clientId || !urls.length) return showToast?.('Client and at least one URL are required', 'error');
    try {
        const data = await svFetchJson('/api/search-visibility/indexnow/submit', { method: 'POST', body: JSON.stringify({ clientId, urls }) });
        showToast?.('IndexNow notification sent', 'success');
        renderSearchVisibilityRecommendations(data.recommendations || []);
        await loadSearchVisibilityActions(clientId);
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}

async function notifySearchVisibilityGoogleIndexing() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const url = document.getElementById('svGoogleIndexingUrl')?.value;
    const type = document.getElementById('svGoogleIndexingType')?.value;
    const pageType = document.getElementById('svGoogleIndexingPageType')?.value;
    if (!clientId || !url || !type || !pageType) return showToast?.('Client, URL, notification type, and eligible page type are required', 'error');
    try {
        const data = await svFetchJson('/api/search-visibility/google-indexing/notify', { method: 'POST', body: JSON.stringify({ clientId, url, type, pageType }) });
        showToast?.('Google Indexing API notification sent for eligible page type', 'success');
        renderSearchVisibilityRecommendations(data.recommendations || []);
        await loadSearchVisibilityActions(clientId);
    } catch (err) {
        showToast?.(err.message, 'error');
        await loadSearchVisibilityActions(clientId);
    }
}

function renderSearchVisibilityRecommendations(recommendations) {
    latestSearchVisibilityRecommendations = recommendations;
    const el = document.getElementById('svInspectionResult');
    if (!el) return;
    el.innerHTML = `
        <h4>Recommended fixes</h4>
        <ul>${recommendations.map(item => `<li>${svEscape(item)}</li>`).join('')}</ul>
        <p class="text-muted" style="font-size:.82rem;">Discovery requests help search engines find URLs. They do not guarantee indexing or ranking.</p>
    `;
}

async function loadSearchVisibilityActions(clientId) {
    const el = document.getElementById('svActionsTable');
    if (!clientId || !el) return;
    el.innerHTML = '<p class="text-muted">Loading recent actions...</p>';
    try {
        const data = await svFetchJson(`/api/search-visibility/actions/${encodeURIComponent(clientId)}?limit=30`);
        const rows = data.actions || [];
        el.innerHTML = rows.length
            ? `<table class="data-table premium"><thead><tr><th>When</th><th>Provider</th><th>Action</th><th>Status</th><th>URL</th><th>Error</th></tr></thead><tbody>${rows.map(row => `
                <tr>
                    <td>${new Date(row.created_at).toLocaleString()}</td>
                    <td>${svEscape(row.provider)}</td>
                    <td>${svEscape(row.action_type)}</td>
                    <td>${svStatusBadge(row.status === 'success', svEscape(row.status))}</td>
                    <td style="max-width:260px;word-break:break-word;">${svEscape(row.url || row.sitemap_url || '-')}</td>
                    <td>${svEscape(row.error_message || '-')}</td>
                </tr>
            `).join('')}</tbody></table>`
            : '<p class="text-muted">No search visibility actions yet.</p>';
    } catch (err) {
        el.innerHTML = `<p class="text-danger">${svEscape(err.message)}</p>`;
    }
}

async function createSearchVisibilityTask() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const projectId = document.getElementById('svProjectSelect')?.value;
    const recommendation = latestSearchVisibilityRecommendations[0] || 'Review search visibility issue and apply recommended fixes.';
    if (!clientId || !projectId) return showToast?.('Select a project before creating a task', 'error');
    try {
        const title = latestSearchVisibilityUrl
            ? `Fix search visibility issue for ${latestSearchVisibilityUrl}`
            : 'Fix search visibility issue';
        await svFetchJson('/api/search-visibility/create-task', {
            method: 'POST',
            body: JSON.stringify({
                clientId,
                projectId,
                title,
                description: latestSearchVisibilityRecommendations.join('\\n'),
                url: latestSearchVisibilityUrl,
                recommendation,
            }),
        });
        showToast?.('SEO task created', 'success');
        await loadSearchVisibilityActions(clientId);
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}


async function createSearchVisibilityAlerts() {
    const clientId = document.getElementById('svClientSelect')?.value;
    if (!clientId) return showToast?.('Select a client before creating alerts', 'error');
    try {
        const data = await svFetchJson('/api/search-visibility/create-alerts/' + encodeURIComponent(clientId), {
            method: 'POST',
            body: JSON.stringify({ limit: 20 }),
        });
        showToast?.('Created ' + (data.generatedCount || 0) + ' search visibility alerts', 'success');
        if (typeof refreshAlertBadge === 'function') refreshAlertBadge();
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}


async function createSearchVisibilityTasks() {
    const clientId = document.getElementById('svClientSelect')?.value;
    const projectId = document.getElementById('svProjectSelect')?.value;
    if (!clientId || !projectId) return showToast?.('Select a client and project before creating tasks', 'error');
    try {
        const data = await svFetchJson('/api/search-visibility/create-tasks/' + encodeURIComponent(clientId), {
            method: 'POST',
            body: JSON.stringify({ projectId, limit: 20 }),
        });
        showToast?.('Created ' + (data.generatedCount || 0) + ' search visibility tasks', 'success');
    } catch (err) {
        showToast?.(err.message, 'error');
    }
}
