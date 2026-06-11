/**
 * Project SEO Dashboard
 * Renders one project at a time with keywords, ranks, technical score,
 * content gaps, top competitors, alerts, and next recommended actions.
 */

const PD = {
    currentProjectId: null,
    cache: new Map(),
};

const PD_SELECT = '#pdProjectSelect';
const PD_BODY = '#pdDashboardBody';
const PD_EMPTY = '#pdEmptyState';

function pdFormatNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '—';
    if (typeof window.formatNumber === 'function') return window.formatNumber(num);
    return Number(num).toLocaleString();
}

function pdFormatTimeAgo(dateStr) {
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

function pdEscape(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function pdRankClass(pos) {
    if (!pos || pos <= 0) return '';
    if (pos === 1) return 'rank-1';
    if (pos <= 10) return 'rank-top';
    if (pos <= 20) return 'rank-mid';
    return 'rank-low';
}

function pdChangeBadge(change) {
    if (!change) return '<span class="pd-change same">—</span>';
    const dir = change.direction;
    if (dir === 'up') {
        return `<span class="pd-change up" title="Moved up"><i class="fas fa-arrow-up"></i> ${change.delta || ''}</span>`;
    }
    if (dir === 'down') {
        return `<span class="pd-change down" title="Dropped"><i class="fas fa-arrow-down"></i> ${Math.abs(change.delta || 0)}</span>`;
    }
    if (dir === 'new') {
        return '<span class="pd-change new" title="New ranking"><i class="fas fa-sparkles"></i> New</span>';
    }
    if (dir === 'lost') {
        return '<span class="pd-change lost" title="Lost ranking"><i class="fas fa-ghost"></i> Lost</span>';
    }
    return '<span class="pd-change same">—</span>';
}

function pdIntentTag(intent) {
    if (!intent) return '<span class="pd-intent-tag">—</span>';
    const cls = String(intent).toLowerCase().replace(/[^a-z]/g, '');
    return `<span class="pd-intent-tag ${cls}">${pdEscape(intent)}</span>`;
}

function pdEmpty(message, icon = 'fa-inbox') {
    return `<div class="pd-empty-block"><i class="fas ${icon}"></i>${pdEscape(message)}</div>`;
}

function pdSetText(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
}

function pdSetHtml(selector, value) {
    const element = document.querySelector(selector);
    if (element) element.innerHTML = value;
}

function pdTechScoreColor(score) {
    if (score === null || score === undefined) return '#94a3b8';
    if (score >= 80) return '#10b981';
    if (score >= 60) return '#f59e0b';
    if (score >= 40) return '#f97316';
    return '#ef4444';
}

function pdTechLabel(score) {
    if (score === null || score === undefined) return 'No audit yet';
    if (score >= 80) return 'Healthy site';
    if (score >= 60) return 'Needs polish';
    if (score >= 40) return 'Significant issues';
    return 'Critical issues';
}

function renderPdHeader(data) {
    const project = data.project;
    const client = project.client || {};
    const meta = [];
    if (client.industry) meta.push(`<span class="pdh-chip"><i class="fas fa-industry"></i> ${pdEscape(client.industry)}</span>`);
    if (project.targetLocation) meta.push(`<span class="pdh-chip"><i class="fas fa-map-marker-alt"></i> ${pdEscape(project.targetLocation)}</span>`);
    if (Array.isArray(client.targetLocations) && client.targetLocations.length) {
        meta.push(`<span class="pdh-chip"><i class="fas fa-globe"></i> ${pdEscape(client.targetLocations.slice(0, 3).join(', '))}</span>`);
    }
    if (client.website) meta.push(`<span class="pdh-chip"><i class="fas fa-link"></i> <a href="${pdEscape(client.website)}" target="_blank" rel="noopener">${pdEscape(client.domain || client.website)}</a></span>`);
    if (project.projectType) meta.push(`<span class="pdh-chip"><i class="fas fa-folder"></i> ${pdEscape(project.projectType)}</span>`);

    pdSetText('#pdProjectName', project.name || 'Project');
    pdSetText('#pdProjectSub', `${client.name || 'Client'} · ${pdFormatNumber(data.summary?.keywordCount)} target keywords · generated ${pdFormatTimeAgo(data.generatedAt)}`);
    pdSetHtml('#pdProjectMeta', meta.join(''));
}

function renderPdSummary(data) {
    const s = data.summary || {};
    pdSetText('#pdStatKeywords', pdFormatNumber(s.keywordCount));
    pdSetText('#pdStatTop10', pdFormatNumber(s.top10));
    pdSetText('#pdStatAvg', s.avgPosition === null || s.avgPosition === undefined ? '—' : Number(s.avgPosition).toFixed(1));
    const tech = data.technical;
    pdSetText('#pdStatTech', tech && tech.score !== null && tech.score !== undefined ? `${tech.score}` : '—');
    pdSetText('#pdStatVolume', pdFormatNumber(s.totalSearchVolume));
    pdSetText('#pdStatAlerts', pdFormatNumber(data.alerts?.unreadCount || 0));
    pdSetText('#pdStatGscClicks', data.gsc ? pdFormatNumber(data.gsc.clicks || 0) : '—');
    pdSetText('#pdStatGscScore', data.gsc?.performanceScore !== null && data.gsc?.performanceScore !== undefined ? data.gsc.performanceScore : '—');

    pdSetText('#pdMoveUp', pdFormatNumber(s.improvedRankings));
    pdSetText('#pdMoveDown', pdFormatNumber(s.droppedRankings));
    pdSetText('#pdMoveNew', pdFormatNumber(s.newRankings));
    pdSetText('#pdMoveLost', pdFormatNumber(s.lostRankings));
    pdSetText('#pdMoveGap', pdFormatNumber(s.unranked));
}

function renderPdKeywords(data) {
    const tbody = document.querySelector('#pdKeywordsTable tbody');
    if (!tbody) return;
    const rows = data.targetKeywords || [];
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="6">${pdEmpty('No target keywords linked to this project yet.', 'fa-key')}</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(k => {
        const intent = pdIntentTag(k.intent);
        const rank = k.rank && k.rank.position > 0
            ? `<span class="pd-rank-cell"><strong class="${pdRankClass(k.rank.position)}">#${k.rank.position}</strong></span>`
            : `<span class="pd-rank-cell none">Not ranked</span>`;
        return `
            <tr>
                <td>
                    <div class="pd-keyword">${pdEscape(k.keyword)}</div>
                    ${k.location ? `<div class="pd-meta">${pdEscape(k.location)}</div>` : ''}
                </td>
                <td>${intent}</td>
                <td>${pdFormatNumber(k.searchVolume)}</td>
                <td>${k.difficulty || 0}</td>
                <td>${rank}</td>
                <td>${pdChangeBadge(k.change)}</td>
            </tr>
        `;
    }).join('');
}

function renderPdCompetitors(data) {
    const container = $('#pdCompetitorsList');
    if (!container) return;
    const comps = data.topCompetitors || [];
    if (!comps.length) {
        container.innerHTML = pdEmpty('No competitor data yet. Run keyword research to start tracking who outranks you.', 'fa-users');
        return;
    }
    container.innerHTML = comps.map(c => `
        <div class="pd-competitor">
            <div style="min-width:0;flex:1">
                <div class="pd-competitor-domain">${pdEscape(c.domain)}</div>
                <div class="pd-competitor-stats">
                    <span><strong>${pdFormatNumber(c.keywordCount)}</strong> keywords</span>
                    ${c.avgPosition ? `<span>avg <strong>${c.avgPosition.toFixed(1)}</strong></span>` : ''}
                    ${c.bestPosition ? `<span>best <strong>#${c.bestPosition}</strong></span>` : ''}
                </div>
            </div>
            <div class="pd-competitor-rank">
                <strong>#${c.bestPosition || '—'}</strong>
                <span>best</span>
            </div>
        </div>
    `).join('');
}

function renderPdTechnical(data) {
    const container = $('#pdTechnicalBlock');
    if (!container) return;
    const tech = data.technical;
    if (!tech) {
        container.innerHTML = pdEmpty('No technical audit on file. Run one from the Technical SEO tab to populate this card.', 'fa-spider');
        return;
    }

    const score = tech.score;
    const circumference = 2 * Math.PI * 42;
    const offset = score === null ? circumference : circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;
    const color = pdTechScoreColor(score);

    const issuesHtml = (tech.topIssues && tech.topIssues.length)
        ? `<div class="pd-tech-issues">${tech.topIssues.map(i => `
            <div class="pd-tech-issue">
                <div class="pd-tech-issue-text">
                    <strong>${pdEscape(i.title || i.message || 'Issue')}</strong>
                    ${i.description ? `<div class="pd-meta" style="color:var(--gray);font-size:0.78rem;margin-top:2px">${pdEscape(i.description)}</div>` : ''}
                </div>
                <span class="pd-severity ${pdEscape((i.severity || '').toLowerCase())}">${pdEscape(i.severity || 'info')}</span>
            </div>
        `).join('')}</div>`
        : `<p style="color:var(--gray);font-size:0.85rem;margin-top:12px">No significant issues flagged in the latest audit.</p>`;

    container.innerHTML = `
        <div class="pd-tech-score">
            <div class="pd-tech-ring">
                <svg viewBox="0 0 100 100">
                    <circle class="track" cx="50" cy="50" r="42"></circle>
                    <circle class="fill" cx="50" cy="50" r="42"
                        stroke="${color}"
                        stroke-dasharray="${circumference}"
                        stroke-dashoffset="${offset}"></circle>
                </svg>
                <div class="pd-tech-number">
                    <strong>${score === null ? '—' : score}</strong>
                    <small>/100</small>
                </div>
            </div>
            <div class="pd-tech-info">
                <h4>${pdEscape(pdTechLabel(score))}</h4>
                <p>
                    ${pdFormatNumber(tech.pagesCrawled || 0)} pages crawled ·
                    ${pdFormatNumber(tech.issueCount || 0)} total issues
                    ${tech.criticalIssueCount ? ` · <strong style="color:var(--danger)">${tech.criticalIssueCount} critical</strong>` : ''}
                </p>
                <p style="margin-top:4px;font-size:0.78rem">Audited ${pdFormatTimeAgo(tech.auditedAt)} on ${pdEscape(tech.siteUrl || '')}</p>
            </div>
        </div>
        ${issuesHtml}
    `;
}


function renderPdGsc(data) {
    const container = $('#pdGscBlock');
    if (!container) return;
    const gsc = data.gsc;
    if (!gsc) {
        container.innerHTML = `
            <div class="pd-gsc-empty">
                <div>${pdEmpty('No Google Search Console data synced yet. Add the service account JSON, connect the client property, then sync this project.', 'fa-magnifying-glass-chart')}</div>
                <div class="pd-gsc-env-note">Requires GSC_SERVICE_ACCOUNT_JSON and GSC user access for the client property.</div>
            </div>
        `;
        return;
    }

    const ctr = gsc.ctr === null || gsc.ctr === undefined ? '—' : `${(Number(gsc.ctr) * 100).toFixed(1)}%`;
    const position = gsc.position === null || gsc.position === undefined ? '—' : Number(gsc.position).toFixed(1);
    const quickWins = gsc.quickWinKeywords || [];
    const lowCtr = gsc.lowCtrPages || [];
    const topPages = gsc.topPages || [];

    container.innerHTML = `
        <div class="pd-gsc-summary">
            <div><span>Clicks</span><strong>${pdFormatNumber(gsc.clicks || 0)}</strong></div>
            <div><span>Impressions</span><strong>${pdFormatNumber(gsc.impressions || 0)}</strong></div>
            <div><span>CTR</span><strong>${ctr}</strong></div>
            <div><span>Avg position</span><strong>${position}</strong></div>
        </div>
        <div class="pd-gsc-grid">
            <div>
                <h4>Quick-win keywords</h4>
                ${quickWins.length ? quickWins.slice(0, 6).map(row => `
                    <div class="pd-gsc-row">
                        <span>${pdEscape(row.query)}</span>
                        <strong>#${Number(row.position).toFixed(1)}</strong>
                        <small>${pdFormatNumber(row.impressions)} impr.</small>
                    </div>
                `).join('') : pdEmpty('No keywords in positions 8-20 yet.', 'fa-key')}
            </div>
            <div>
                <h4>Low CTR pages</h4>
                ${lowCtr.length ? lowCtr.slice(0, 6).map(row => `
                    <div class="pd-gsc-row">
                        <span title="${pdEscape(row.page)}">${pdEscape((row.page || '').replace(/^https?:\/\//, ''))}</span>
                        <strong>${(Number(row.ctr) * 100).toFixed(1)}%</strong>
                        <small>${pdFormatNumber(row.impressions)} impr.</small>
                    </div>
                `).join('') : pdEmpty('No low-CTR page opportunities yet.', 'fa-bullseye')}
            </div>
            <div>
                <h4>Top pages</h4>
                ${topPages.length ? topPages.slice(0, 6).map(row => `
                    <div class="pd-gsc-row">
                        <span title="${pdEscape(row.page)}">${pdEscape((row.page || '').replace(/^https?:\/\//, ''))}</span>
                        <strong>${pdFormatNumber(row.clicks)}</strong>
                        <small>clicks</small>
                    </div>
                `).join('') : pdEmpty('No page data synced yet.', 'fa-file-lines')}
            </div>
        </div>
    `;
}

async function syncPdGsc() {
    if (!PD.currentProjectId) return;
    const btn = document.querySelector('#pdGscSyncBtn');
    const original = btn?.innerHTML;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
    }
    try {
        const data = await api(`/api/projects/${PD.currentProjectId}/gsc/sync`, { method: 'POST', body: JSON.stringify({}) });
        showSuccess(`GSC synced: ${pdFormatNumber(data.result?.rows || 0)} rows`);
        PD.cache.delete(PD.currentProjectId);
        await loadProjectDashboard(PD.currentProjectId, { force: true });
    } catch (err) {
        showError(err.message || 'Could not sync GSC data');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    }
}

function renderPdContentGaps(data) {
    const container = $('#pdContentGaps');
    if (!container) return;
    const gaps = data.contentGaps || [];
    if (!gaps.length) {
        container.innerHTML = pdEmpty('No content gaps detected. Every priority keyword has a page you are ranking for.', 'fa-puzzle-piece');
        return;
    }
    container.innerHTML = gaps.map((g, idx) => {
        let priorityLabel = 'low';
        if (idx < 2) priorityLabel = 'high';
        else if (idx < 5) priorityLabel = 'medium';
        const tag = priorityLabel === 'high' ? 'P0' : priorityLabel === 'medium' ? 'P1' : 'P2';
        return `
            <div class="pd-gap-item">
                <div style="flex:1;min-width:0">
                    <div class="pd-gap-keyword">${pdEscape(g.keyword)}</div>
                    <div class="pd-gap-meta">
                        <span>Vol ${pdFormatNumber(g.searchVolume)}</span>
                        <span>KD ${g.difficulty || 0}</span>
                        ${g.intent ? `<span>${pdEscape(g.intent)}</span>` : ''}
                    </div>
                </div>
                <span class="pd-gap-priority ${priorityLabel}">${tag}</span>
            </div>
        `;
    }).join('');
}

function renderPdAlerts(data) {
    const container = $('#pdAlertsList');
    if (!container) return;
    const alerts = data.alerts?.recent || [];
    if (!alerts.length) {
        container.innerHTML = pdEmpty('No alerts for this project\'s keywords. Rank and indexing events will appear here.', 'fa-bell');
        return;
    }
    container.innerHTML = alerts.slice(0, 10).map(a => {
        const icon = (() => {
            switch (a.type) {
                case 'rank_drop': return 'fa-arrow-down';
                case 'rank_improvement': return 'fa-arrow-up';
                case 'new_ranking': return 'fa-sparkles';
                case 'lost_ranking': return 'fa-ghost';
                default: return 'fa-bell';
            }
        })();
        return `
            <div class="pd-alert ${a.isRead ? '' : 'unread'}">
                <div class="pd-alert-icon ${pdEscape(a.type)}"><i class="fas ${icon}"></i></div>
                <div class="pd-alert-body">
                    <div class="pd-alert-msg">${pdEscape(a.message)}</div>
                    <div class="pd-alert-meta">
                        <span><i class="fas fa-key"></i> ${pdEscape(a.keyword || '')}</span>
                        <span><i class="fas fa-clock"></i> ${pdFormatTimeAgo(a.createdAt)}</span>
                        ${a.oldValue || a.newValue ? `<span>${pdEscape(a.oldValue || '')} → ${pdEscape(a.newValue || '')}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderPdActions(data) {
    const container = $('#pdActionsList');
    if (!container) return;
    const actions = data.actions || [];
    if (!actions.length) {
        container.innerHTML = pdEmpty('No recommended actions right now.', 'fa-flag-checkered');
        return;
    }
    container.innerHTML = actions.map(a => `
        <div class="pd-action">
            <div class="pd-action-priority ${pdEscape(a.priority)}"></div>
            <div class="pd-action-body">
                <span class="pd-action-tag ${pdEscape(a.priority)}">${pdEscape(a.priority)}</span>
                <div class="pd-action-title">${pdEscape(a.title)}</div>
                <div class="pd-action-detail">${pdEscape(a.detail)}</div>
            </div>
        </div>
    `).join('');
}

function renderPdDashboard(data) {
    renderPdHeader(data);
    renderPdSummary(data);
    renderPdKeywords(data);
    renderPdCompetitors(data);
    renderPdTechnical(data);
    renderPdGsc(data);
    renderPdContentGaps(data);
    renderPdAlerts(data);
    renderPdActions(data);
    const body = document.querySelector(PD_BODY);
    const empty = document.querySelector(PD_EMPTY);
    if (body) body.style.display = '';
    if (empty) empty.style.display = 'none';
}

function pdShowEmpty(message) {
    const body = document.querySelector(PD_BODY);
    if (body) body.style.display = 'none';
    const empty = document.querySelector(PD_EMPTY);
    if (!empty) return;
    empty.style.display = '';
    if (message) {
        const body = empty.querySelector('.card-body');
        if (body) {
            body.innerHTML = `<div class="pd-empty-icon"><i class="fas fa-folder-open"></i></div><h3>${pdEscape(message)}</h3><p>Create a project from the Clients page, then come back here for a one-glance view of keywords, ranks, technical health, competitors, alerts, and next actions.</p>`;
        }
    }
}

async function loadProjectDashboard(projectId, { force = false } = {}) {
    if (!projectId) {
        pdShowEmpty('Select a project to see its SEO health.');
        return;
    }
    if (!force && PD.cache.has(projectId)) {
        renderPdDashboard(PD.cache.get(projectId));
        return;
    }
    try {
        const body = document.querySelector(PD_BODY);
        const empty = document.querySelector(PD_EMPTY);
        if (body) body.style.display = '';
        if (empty) empty.style.display = 'none';
        const data = await api(`/api/projects/${projectId}/dashboard`);
        if (data && data.error) {
            throw new Error(data.error);
        }
        PD.cache.set(projectId, data);
        renderPdDashboard(data);
    } catch (err) {
        console.error('Failed to load project dashboard', err);
        showError(err.message || 'Could not load project dashboard');
        const body = document.querySelector(PD_BODY);
        if (body) body.insertAdjacentHTML('afterbegin', pdEmpty('Could not load dashboard data. ' + (err.message || ''), 'fa-triangle-exclamation'));
    }
}

async function populateProjectDashboardSelect() {
    const select = document.querySelector(PD_SELECT);
    if (!select) return [];
    try {
        const data = await api('/api/projects');
        const projects = data.projects || [];
        const current = PD.currentProjectId;
        select.innerHTML = '<option value="">Select a project…</option>' + projects.map(p => `
            <option value="${pdEscape(p.id)}">${pdEscape(p.client_name)} · ${pdEscape(p.name)}</option>
        `).join('');
        if (current && projects.some(p => p.id === current)) {
            select.value = current;
        }
        return projects;
    } catch (err) {
        console.error('Failed to load projects for dashboard', err);
        select.innerHTML = '<option value="">No projects available</option>';
        return [];
    }
}

async function initProjectDashboard() {
    const select = document.querySelector(PD_SELECT);
    if (!select) return;

    if (!select.dataset.bound) {
        select.dataset.bound = '1';
        select.addEventListener('change', () => {
            PD.currentProjectId = select.value;
            if (select.value) {
                loadProjectDashboard(select.value);
            } else {
                pdShowEmpty();
            }
        });
    }

    const gscSyncBtn = document.querySelector('#pdGscSyncBtn');
    if (gscSyncBtn && !gscSyncBtn.dataset.bound) {
        gscSyncBtn.dataset.bound = '1';
        gscSyncBtn.addEventListener('click', syncPdGsc);
    }

    const refreshBtn = document.querySelector('#pdRefreshBtn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = '1';
        refreshBtn.addEventListener('click', () => {
            if (PD.currentProjectId) loadProjectDashboard(PD.currentProjectId, { force: true });
        });
    }

    const projects = await populateProjectDashboardSelect();

    if (!projects.length) {
        pdShowEmpty('No projects yet. Create one from the Clients page first.');
        PD.currentProjectId = null;
        return;
    }

    if (!PD.currentProjectId || !projects.some(p => p.id === PD.currentProjectId)) {
        PD.currentProjectId = projects[0].id;
    }
    select.value = PD.currentProjectId;
    await loadProjectDashboard(PD.currentProjectId);
}

window.openProjectDashboard = function (projectId) {
    PD.currentProjectId = projectId;
    if (typeof window.navigateTo === 'function') {
        window.navigateTo('project-dashboard');
    } else {
        window.location.hash = 'project-dashboard';
    }
};

window.initProjectDashboard = initProjectDashboard;
window.loadProjectDashboard = loadProjectDashboard;
window.populateProjectDashboardSelect = populateProjectDashboardSelect;
