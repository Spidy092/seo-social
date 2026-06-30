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

function renderPdRankedKeywords(data) {
    const container = document.querySelector('#pdRankedKeywordsBlock');
    if (!container) return;
    const rk = data.rankedKeywords;

    // ── Polished empty state (no URL configured) ──
    if (!rk || !rk.url) {
        const clientName = data.project?.client?.name;
        const message = clientName
            ? `No domain or URL is set for <strong>${pdEscape(clientName)}</strong>. Add a website URL on the client, or set a tracking domain on the project, to see ranked keywords.`
            : 'No domain or URL configured for this project. Set the client website or a project tracking domain to see ranked keywords.';
        container.innerHTML = `
            <div class="pd-ranked-kw-empty-state">
                <i class="fas fa-globe fa-2x" style="color:var(--gray-light,#d1d5db);margin-bottom:8px"></i>
                <div>${message}</div>
            </div>
        `;
        return;
    }

    const source = rk.source || 'none';
    const allKeywords = Array.isArray(rk.keywords) ? rk.keywords : [];
    const tracked = new Set(Array.isArray(rk.trackedKeywords) ? rk.trackedKeywords : []);
    const count = Number(rk.count) || allKeywords.length;
    const sourceLabels = {
        gsc: 'Google Search Console',
        serper: 'Serper.dev',
        rank_tracker: 'Internal rank tracker',
        cache: 'Cached',
        none: 'No data',
    };
    const sourceLabel = sourceLabels[source] || source;
    const cached = rk.cached || source === 'cache';
    const defaultUrl = rk.url || (data.project?.client?.domain || '');
    const defaultLocation = rk.location || '';
    const inputId = 'pdRankedKwInput';
    const locInputId = 'pdRankedKwLocationInput';
    const btnId = 'pdRankedKwRefreshBtn';
    const exportId = 'pdRankedKwExportBtn';
    const addAllId = 'pdRankedKwAddAllBtn';
    const untrackedId = 'pdRankedKwUntrackedToggle';

    // Delta chip ("vs last check")
    let deltaChip = '';
    if (rk.delta && typeof rk.delta.delta === 'number') {
        const d = rk.delta.delta;
        const sign = d > 0 ? '+' : '';
        const tone = d > 0 ? 'up' : d < 0 ? 'down' : 'same';
        deltaChip = `<span class="pd-delta-chip ${tone}">${sign}${d} since last check</span>`;
    }

    // Untracked-only filter (state is local to the card)
    const showUntrackedOnly = container.dataset.untrackedOnly === '1';
    const untrackedCount = allKeywords.filter((k) => !tracked.has(String(k.keyword).toLowerCase())).length;
    const visible = showUntrackedOnly
        ? allKeywords.filter((k) => !tracked.has(String(k.keyword).toLowerCase()))
        : allKeywords;
    const untrackedToggleHtml = `
        <label class="pd-ranked-kw-toggle">
            <input type="checkbox" id="${untrackedId}" ${showUntrackedOnly ? 'checked' : ''}>
            <span>Untracked only (${untrackedCount})</span>
        </label>
    `;

    // No-URL / no-data empty state
    if (allKeywords.length === 0) {
        // When every source returned zero, show "No data" instead of the last
        // attempted source — it's less misleading.
        const badgeSource = (source === 'gsc' || source === 'serper' || source === 'rank_tracker') ? 'none' : source;
        const badgeLabel = badgeSource === 'none' ? 'No data' : sourceLabel;
        container.innerHTML = `
            <div class="pd-ranked-kw-bar">
                <input id="${inputId}" type="text" placeholder="example.com or https://example.com/page"
                       value="${pdEscape(defaultUrl)}" autocomplete="off" spellcheck="false">
                <input id="${locInputId}" type="text" placeholder="Location (e.g. Coimbatore)"
                       value="${pdEscape(defaultLocation)}" autocomplete="off" spellcheck="false"
                       class="pd-ranked-kw-loc-input">
                <button class="btn btn-primary" id="${btnId}" type="button">
                    <i class="fas fa-rotate"></i> Refresh
                </button>
            </div>
            <div class="pd-empty">
                <div class="pd-empty-icon"><i class="fas fa-key"></i></div>
                <h3>No keywords found for <strong>${pdEscape(defaultUrl)}</strong></h3>
                
                <div style="margin-top: 24px; text-align: left; background: var(--bg-body, #f8fafc); border: 1px solid var(--border-color, #e2e8f0); padding: 24px; border-radius: var(--border-radius-sm, 8px); max-width: 580px; margin-left: auto; margin-right: auto; box-shadow: var(--shadow-sm, 0 1px 2px 0 rgba(0,0,0,0.05));">
                    <p style="margin-bottom: 16px; color: var(--text-secondary, #475569); font-size: 0.9rem; line-height: 1.5;">
                        Tried in order: <strong>Google Search Console</strong> <i class="fas fa-arrow-right" style="margin: 0 4px; font-size: 0.75rem; opacity: 0.5;"></i> <strong>Serper.dev</strong> <i class="fas fa-arrow-right" style="margin: 0 4px; font-size: 0.75rem; opacity: 0.5;"></i> <strong>internal rank tracker</strong>. None returned data.
                    </p>
                    <p style="font-weight: 600; font-size: 0.95rem; margin-bottom: 12px; color: var(--text-primary, #0f172a);">To see ranked keywords, either:</p>
                    <ul style="list-style: none; padding: 0; margin: 0;">
                        <li style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-secondary, #475569); display: flex; align-items: flex-start; gap: 10px;">
                            <i class="fas fa-check-circle" style="color: var(--secondary, #10b981); margin-top: 3px; font-size: 0.9rem;"></i>
                            <span>Connect <strong>Google Search Console</strong> for this client (best — real query data)</span>
                        </li>
                        <li style="margin-bottom: 10px; font-size: 0.9rem; color: var(--text-secondary, #475569); display: flex; align-items: flex-start; gap: 10px;">
                            <i class="fas fa-check-circle" style="color: var(--secondary, #10b981); margin-top: 3px; font-size: 0.9rem;"></i>
                            <span>Add a <code>SERPER_API_KEY</code> to <code>.env</code> (live SERP, costs credits)</span>
                        </li>
                        <li style="font-size: 0.9rem; color: var(--text-secondary, #475569); display: flex; align-items: flex-start; gap: 10px;">
                            <i class="fas fa-check-circle" style="color: var(--secondary, #10b981); margin-top: 3px; font-size: 0.9rem;"></i>
                            <span>Add this domain to your <strong>rank tracker</strong> and run a rank check</span>
                        </li>
                    </ul>
                </div>
            </div>
            <div class="pd-ranked-kw-meta">
                <span class="pd-source-badge ${pdEscape(badgeSource)}">${pdEscape(badgeLabel)}</span>
                <span>Last checked ${pdFormatTimeAgo(rk.checkedAt)}</span>
            </div>
        `;
        bindRankedKwHandlers({ inputId, locInputId, btnId, exportId, addAllId, untrackedId });
        return;
    }

    // ── Render keyword list ──
    const renderList = (list) => list.slice(0, 50).map(k => {
        const pos = k.position ? Number(k.position) : null;
        const posHtml = pos
            ? `<span class="pd-ranked-kw-pos ${pdRankClass(pos)}">#${pos}</span>`
            : `<span class="pd-ranked-kw-pos none">—</span>`;
        const meta = [
            k.clicks != null ? `${pdFormatNumber(k.clicks)} clicks` : null,
            k.impressions != null ? `${pdFormatNumber(k.impressions)} impr.` : null,
        ].filter(Boolean).join(' · ');
        const kLower = String(k.keyword).toLowerCase();
        const isTracked = tracked.has(kLower);
        const plusBtn = isTracked
            ? `<span class="pd-ranked-kw-tracked" title="Already a target keyword"><i class="fas fa-check"></i></span>`
            : `<button class="pd-ranked-kw-add-btn" data-keyword="${pdEscape(k.keyword)}"
                       data-position="${pos || ''}" title="Add as target keyword">
                    <i class="fas fa-plus"></i>
                </button>`;
        return `
            <div class="pd-ranked-kw-row">
                <div class="pd-ranked-kw-keyword">
                    <strong>${pdEscape(k.keyword)}</strong>
                    ${meta ? `<div class="pd-meta">${pdEscape(meta)}</div>` : ''}
                </div>
                ${posHtml}
                ${plusBtn}
            </div>
        `;
    }).join('');

    container.innerHTML = `
        <div class="pd-ranked-kw-bar">
            <input id="${inputId}" type="text" placeholder="example.com or https://example.com/page"
                   value="${pdEscape(defaultUrl)}" autocomplete="off" spellcheck="false">
            <input id="${locInputId}" type="text" placeholder="Location (e.g. Coimbatore)"
                   value="${pdEscape(defaultLocation)}" autocomplete="off" spellcheck="false"
                   class="pd-ranked-kw-loc-input">
            <button class="btn btn-primary" id="${btnId}" type="button">
                <i class="fas fa-rotate"></i> Refresh
            </button>
            <button class="btn" id="${exportId}" type="button" title="Download CSV">
                <i class="fas fa-download"></i>
            </button>
        </div>
        <div class="pd-ranked-kw-summary">
            <div class="pd-ranked-kw-count">${pdFormatNumber(visible.length)}</div>
            <div class="pd-ranked-kw-meta">
                <span>${showUntrackedOnly ? 'untracked keywords' : 'keywords this URL ranks for'}</span>
                <span class="pd-source-badge ${pdEscape(source)}">${pdEscape(sourceLabel)}</span>
                ${cached ? '<span class="pd-source-badge cache">cached</span>' : ''}
                ${deltaChip}
                <span>· Last checked ${pdFormatTimeAgo(rk.checkedAt)}</span>
            </div>
        </div>
        <div class="pd-ranked-kw-toolbar">
            ${untrackedToggleHtml}
            <button class="btn pd-ranked-kw-add-all" id="${addAllId}" type="button">
                <i class="fas fa-plus-circle"></i> Add all visible as targets
            </button>
        </div>
        <div class="pd-ranked-kw-list">${renderList(visible)}</div>
    `;
    bindRankedKwHandlers({ inputId, locInputId, btnId, exportId, addAllId, untrackedId });
}

function bindRankedKwHandlers({ inputId, locInputId, btnId, exportId, addAllId, untrackedId }) {
    const input = document.getElementById(inputId);
    const locInput = document.getElementById(locInputId);
    const btn = document.getElementById(btnId);
    const exportBtn = document.getElementById(exportId);
    const addAllBtn = document.getElementById(addAllId);
    const untrackedCb = document.getElementById(untrackedId);
    if (!btn) return;

    const doRefresh = async (force) => {
        if (!PD.currentProjectId) return;
        const url = input ? input.value.trim() : '';
        const location = locInput ? locInput.value.trim() : '';
        btn.disabled = true;
        const original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing…';
        try {
            const params = new URLSearchParams();
            if (url) params.set('url', url);
            if (location) params.set('location', location);
            if (force) params.set('refresh', 'true');
            const data = await api(`/api/projects/${PD.currentProjectId}/ranked-keywords?${params.toString()}`);
            const payload = PD.cache.get(PD.currentProjectId) || {};
            payload.rankedKeywords = data;
            PD.cache.set(PD.currentProjectId, payload);
            renderPdRankedKeywords(payload);
            showSuccess(`Found ${pdFormatNumber(data.count || 0)} keywords via ${data.source || 'data source'}`);
        } catch (err) {
            showError(err.message || 'Could not refresh ranked keywords');
        } finally {
            btn.disabled = false;
            btn.innerHTML = original;
        }
    };

    btn.addEventListener('click', () => doRefresh(true));
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doRefresh(false); }
        });
    }
    if (locInput) {
        locInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doRefresh(false); }
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (!PD.currentProjectId) return;
            const url = input ? input.value.trim() : '';
            const location = locInput ? locInput.value.trim() : '';
            const params = new URLSearchParams();
            if (url) params.set('url', url);
            if (location) params.set('location', location);
            window.location.href = `/api/projects/${PD.currentProjectId}/ranked-keywords/export?${params.toString()}`;
        });
    }

    // Per-row "+" buttons: add a single keyword as a target
    document.querySelectorAll('.pd-ranked-kw-add-btn').forEach((b) => {
        b.addEventListener('click', async (e) => {
            e.preventDefault();
            const keyword = b.dataset.keyword;
            const position = b.dataset.position || null;
            if (!keyword || !PD.currentProjectId) return;
            b.disabled = true;
            const original = b.innerHTML;
            b.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const r = await api(`/api/projects/${PD.currentProjectId}/keywords/promote`, {
                    method: 'POST',
                    body: JSON.stringify({
                        keywords: [{
                            keyword,
                            location: (locInput && locInput.value.trim()) || '',
                            position: position ? Number(position) : null,
                        }],
                    }),
                });
                showSuccess(`Added "${keyword}" as a target keyword (${r.added} added, ${r.skipped} skipped)`);
                b.outerHTML = '<span class="pd-ranked-kw-tracked" title="Already a target keyword"><i class="fas fa-check"></i></span>';
            } catch (err) {
                showError(err.message || 'Could not add keyword');
                b.innerHTML = original;
                b.disabled = false;
            }
        });
    });

    if (addAllBtn) {
        addAllBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (!PD.currentProjectId) return;
            const rows = Array.from(document.querySelectorAll('.pd-ranked-kw-add-btn'));
            if (!rows.length) {
                showSuccess('Nothing to add — all visible keywords are already tracked.');
                return;
            }
            const keywords = rows.map((b) => ({
                keyword: b.dataset.keyword,
                location: (locInput && locInput.value.trim()) || '',
                position: b.dataset.position ? Number(b.dataset.position) : null,
            }));
            addAllBtn.disabled = true;
            const original = addAllBtn.innerHTML;
            addAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adding…';
            try {
                const r = await api(`/api/projects/${PD.currentProjectId}/keywords/promote`, {
                    method: 'POST',
                    body: JSON.stringify({ keywords }),
                });
                showSuccess(`Added ${r.added} keyword${r.added === 1 ? '' : 's'} as targets (${r.skipped} already tracked)`);
                // Re-render the card to reflect the newly-tracked state
                const payload = PD.cache.get(PD.currentProjectId) || {};
                if (payload.rankedKeywords && Array.isArray(r.conflicts)) {
                    const newlyTracked = new Set(r.conflicts.map((k) => String(k).toLowerCase()));
                    payload.rankedKeywords.trackedKeywords = Array.from(new Set([
                        ...(payload.rankedKeywords.trackedKeywords || []),
                        ...newlyTracked,
                    ]));
                    PD.cache.set(PD.currentProjectId, payload);
                    renderPdRankedKeywords(payload);
                }
            } catch (err) {
                showError(err.message || 'Could not add keywords');
            } finally {
                addAllBtn.disabled = false;
                addAllBtn.innerHTML = original;
            }
        });
    }

    if (untrackedCb) {
        untrackedCb.addEventListener('change', () => {
            const container = document.getElementById('pdRankedKeywordsBlock');
            if (!container) return;
            container.dataset.untrackedOnly = untrackedCb.checked ? '1' : '0';
            const payload = PD.cache.get(PD.currentProjectId) || {};
            renderPdRankedKeywords(payload);
        });
    }
}

function renderPdDashboard(data) {
    renderPdHeader(data);
    renderPdSummary(data);
    renderPdKeywords(data);
    renderPdCompetitors(data);
    renderPdTechnical(data);
    renderPdGsc(data);
    renderPdRankedKeywords(data);
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

// ─────────────────────────────────────────────────────────────────────
// Full Project Audit widget
//
// Drop one file's worth of UI + polling into the existing project
// dashboard. The widget:
//   1. Shows a "▶ Run Full Audit" button next to the refresh button
//   2. On click, POSTs /api/projects/:id/audits and polls the result
//   3. Renders a score + prioritized action list when done
//   4. Auto-loads the latest completed audit on dashboard open
// ─────────────────────────────────────────────────────────────────────
const PD_AUDIT_BTN_ID   = 'pdRunAuditBtn';
const PD_AUDIT_PANEL_ID = 'pdAuditPanel';
const PD_AUDIT_POLL_MS  = 2000;

function pdEnsureAuditButton() {
    if (document.getElementById(PD_AUDIT_BTN_ID)) return;
    const refreshBtn = document.querySelector('#pdRefreshBtn');
    if (!refreshBtn || !refreshBtn.parentElement) return;
    const btn = document.createElement('button');
    btn.id = PD_AUDIT_BTN_ID;
    btn.className = 'pd-btn pd-btn-accent';
    btn.innerHTML = '<i class="fas fa-rocket"></i> Run Full Audit';
    btn.title = 'Run a complete SEO audit (technical, on-page, keywords, competitors, GSC, GA4, performance)';
    refreshBtn.parentElement.appendChild(btn);
    btn.addEventListener('click', pdStartFullAudit);
}

function pdEnsureAuditPanel() {
    if (document.getElementById(PD_AUDIT_PANEL_ID)) return;
    const body = document.querySelector(PD_BODY);
    if (!body) return;
    const panel = document.createElement('div');
    panel.id = PD_AUDIT_PANEL_ID;
    panel.className = 'pd-audit-panel';
    panel.style.display = 'none';
    body.insertBefore(panel, body.firstChild);
}

async function pdStartFullAudit() {
    if (!PD.currentProjectId) return;
    const btn = document.getElementById(PD_AUDIT_BTN_ID);
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Queuing…';
    }
    try {
        const resp = await api(`/api/projects/${PD.currentProjectId}/audits`, {
            method: 'POST',
            body: JSON.stringify({ triggerSource: 'manual' }),
        });
        if (resp && resp.error) throw new Error(resp.error);
        pdRenderAuditPanel({
            status: 'pending',
            progress: 0,
            checksTotal: resp.audit.checksTotal,
        }, 'Audit queued — running in background…');
        pdPollAudit(resp.audit.id);
    } catch (err) {
        pdRenderAuditPanel({ status: 'failed' }, `Failed to queue audit: ${err.message}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-rocket"></i> Run Full Audit';
        }
    }
}

async function pdPollAudit(auditId) {
    const tick = async () => {
        try {
            const resp = await api(`/api/projects/${PD.currentProjectId}/audits/${auditId}`);
            const audit = resp.audit;
            if (!audit) return;
            pdRenderAuditPanel(audit);
            if (audit.status === 'pending' || audit.status === 'running') {
                setTimeout(tick, PD_AUDIT_POLL_MS);
            }
        } catch (err) {
            pdRenderAuditPanel({ status: 'failed' }, `Polling failed: ${err.message}`);
        }
    };
    setTimeout(tick, PD_AUDIT_POLL_MS);
}

async function pdLoadLatestAudit() {
    if (!PD.currentProjectId) return;
    try {
        const resp = await api(`/api/projects/${PD.currentProjectId}/audits/latest`);
        if (resp && resp.audit) pdRenderAuditPanel(resp.audit);
    } catch (err) {
        // silent — not all projects have an audit yet
    }
}

function pdRenderAuditPanel(audit, fallbackMessage) {
    pdEnsureAuditPanel();
    const panel = document.getElementById(PD_AUDIT_PANEL_ID);
    if (!panel) return;

    const status = audit.status || 'unknown';
    const progress = audit.progress != null ? audit.progress : 0;
    const checksTotal = audit.checks_total || audit.checksTotal || 0;
    const checksDone = audit.checks_done || 0;

    if (status === 'pending' || status === 'running') {
        panel.style.display = '';
        panel.innerHTML = `
            <div class="pd-audit-running">
                <div class="pd-audit-title"><i class="fas fa-spinner fa-spin"></i> Full audit in progress…</div>
                <div class="pd-audit-progress-bar"><div class="pd-audit-progress-fill" style="width:${progress}%"></div></div>
                <div class="pd-audit-progress-meta">${checksDone} / ${checksTotal} checks complete · ${progress}%</div>
                <div class="pd-audit-actions-row">
                    <button class="pd-btn-secondary pd-btn-sm" data-cancel-audit="${pdEscape(audit.id || '')}">
                        <i class="fas fa-stop"></i> Cancel audit
                    </button>
                </div>
                ${fallbackMessage ? `<div class="pd-audit-note">${pdEscape(fallbackMessage)}</div>` : ''}
            </div>`;
        const cancelBtn = panel.querySelector('[data-cancel-audit]');
        if (cancelBtn) cancelBtn.addEventListener('click', () => pdCancelAudit(audit.id));
        return;
    }

    if (status === 'cancelled') {
        panel.style.display = '';
        panel.innerHTML = `
            <div class="pd-audit-cancelled">
                <div class="pd-audit-title"><i class="fas fa-ban"></i> Audit cancelled</div>
                <div class="pd-audit-progress-meta">${checksDone} / ${checksTotal} checks had completed before cancellation</div>
                <div class="pd-audit-actions-row">
                    <button class="pd-btn-primary pd-btn-sm" data-retry-audit="${pdEscape(audit.id || '')}">
                        <i class="fas fa-redo"></i> Run again
                    </button>
                </div>
            </div>`;
        const retryBtn = panel.querySelector('[data-retry-audit]');
        if (retryBtn) retryBtn.addEventListener('click', () => pdRetryAudit(audit.id));
        return;
    }

    if (status === 'failed' && !audit.summary) {
        panel.style.display = '';
        panel.innerHTML = `
            <div class="pd-audit-failed">
                <div class="pd-audit-title"><i class="fas fa-exclamation-triangle"></i> Audit failed</div>
                <div class="pd-audit-note">${pdEscape(audit.error_message || fallbackMessage || 'Unknown error')}</div>
            </div>`;
        return;
    }

    // Completed (success or partial)
    const summary = audit.summary || {};
    const score = summary.score;
    const headline = summary.headline || 'Audit complete';
    const actions = summary.actions || [];
    const scoreClass = score == null ? '' : (score >= 80 ? 'good' : score >= 60 ? 'ok' : 'bad');

    panel.style.display = '';
    panel.innerHTML = `
        <div class="pd-audit-report">
            <div class="pd-audit-headline">
                <div class="pd-audit-score ${scoreClass}">
                    <div class="pd-audit-score-num">${score != null ? score : '—'}</div>
                    <div class="pd-audit-score-label">/ 100</div>
                </div>
                <div class="pd-audit-headline-text">
                    <h3>${pdEscape(headline)}</h3>
                    <div class="pd-audit-meta">
                        <span><i class="fas fa-check-circle"></i> ${checksDone} / ${checksTotal} checks</span>
                        <span><i class="fas fa-${summary.checksCompleted === checksTotal ? 'check' : 'info-circle'}"></i>
                              ${status === 'success' ? 'All checks passed' : 'Some checks skipped/failed'}</span>
                        <span><i class="fas fa-clock"></i> ${pdFormatTimeAgo(audit.completed_at || audit.created_at)}</span>
                    </div>
                </div>
            </div>
            ${actions.length ? `
                <div class="pd-audit-actions">
                    <h4>Top actions</h4>
                    <ol>
                        ${actions.map(a => `
                            <li class="pd-audit-action priority-${a.priority}">
                                <span class="pd-audit-priority">${a.priority}</span>
                                <div>
                                    <div class="pd-audit-action-title">${pdEscape(a.title)}</div>
                                    <div class="pd-audit-action-detail">${pdEscape(a.detail || '')}</div>
                                </div>
                            </li>`).join('')}
                    </ol>
                </div>
            ` : ''}
            <div class="pd-audit-footer">
                <small>Triggered by ${pdEscape(audit.trigger_source || 'manual')} · run a new audit to refresh</small>
            </div>
        </div>`;
}

// Hook into initProjectDashboard: when the page is ready, inject the
// audit button + auto-load the latest audit.
const _pdOrigInit = initProjectDashboard;
window.initProjectDashboard = async function patchedInit() {
    await _pdOrigInit();
    pdEnsureAuditButton();
    pdEnsureAuditPanel();
    await pdLoadLatestAudit();
};

// ─── Audit settings panel ────────────────────────────────────────────
// Lets the user toggle individual checks, opt out of auto-audit on
// create, opt out of the weekly re-audit, and set custom keywords.
const PD_AUDIT_SETTINGS_PANEL = 'pdAuditSettingsPanel';
const PD_AUDIT_SETTINGS_TOGGLE = 'pdAuditSettingsToggle';

function pdEnsureSettingsToggle() {
    if (document.getElementById(PD_AUDIT_SETTINGS_TOGGLE)) return;
    const refreshBtn = document.querySelector('#pdRefreshBtn');
    if (!refreshBtn || !refreshBtn.parentElement) return;
    const btn = document.createElement('button');
    btn.id = PD_AUDIT_SETTINGS_TOGGLE;
    btn.className = 'pd-btn-secondary';
    btn.innerHTML = '<i class="fas fa-sliders-h"></i> Audit Settings';
    refreshBtn.parentElement.appendChild(btn);
    btn.addEventListener('click', () => pdToggleSettingsPanel());
}

async function pdToggleSettingsPanel() {
    pdEnsureSettingsPanel();
    const panel = document.getElementById(PD_AUDIT_SETTINGS_PANEL);
    if (!panel) return;
    if (panel.style.display === 'none' || !panel.style.display) {
        await pdLoadAndRenderSettings();
        panel.style.display = '';
    } else {
        panel.style.display = 'none';
    }
}

function pdEnsureSettingsPanel() {
    if (document.getElementById(PD_AUDIT_SETTINGS_PANEL)) return;
    const body = document.querySelector(PD_BODY);
    if (!body) return;
    const panel = document.createElement('div');
    panel.id = PD_AUDIT_SETTINGS_PANEL;
    panel.className = 'pd-audit-settings-panel';
    panel.style.display = 'none';
    body.insertBefore(panel, body.firstChild);
}

async function pdLoadAndRenderSettings() {
    if (!PD.currentProjectId) return;
    const panel = document.getElementById(PD_AUDIT_SETTINGS_PANEL);
    if (!panel) return;
    panel.innerHTML = '<div class="pd-audit-settings-loading"><i class="fas fa-spinner fa-spin"></i> Loading settings…</div>';
    try {
        const resp = await api(`/api/projects/${PD.currentProjectId}/audit-config`);
        pdRenderSettingsPanel(resp);
    } catch (err) {
        panel.innerHTML = `<div class="pd-audit-settings-error">Failed to load settings: ${pdEscape(err.message)}</div>`;
    }
}

function pdRenderSettingsPanel(resp) {
    const panel = document.getElementById(PD_AUDIT_SETTINGS_PANEL);
    if (!panel) return;
    const s = resp.settings || {};
    const checks = resp.availableChecks || [];
    const enabledSet = new Set(s.enabledChecks || []);

    panel.innerHTML = `
        <div class="pd-audit-settings-head">
            <h3><i class="fas fa-sliders-h"></i> Audit Settings</h3>
            <p>Control what the full-audit feature does for this project. Inherited defaults from global settings appear in parentheses.</p>
        </div>

        <div class="pd-audit-settings-section">
            <h4>Checks to run</h4>
            <p class="pd-audit-settings-hint">Untick the checks you don't want. Unticking all = use global default.</p>
            <div class="pd-audit-checks-grid" id="pdAuditChecksGrid">
                ${checks.map(c => `
                    <label class="pd-audit-check">
                        <input type="checkbox" data-check="${pdEscape(c)}" ${enabledSet.has(c) ? 'checked' : ''}>
                        <span>${pdEscape(c)}</span>
                    </label>
                `).join('')}
            </div>
        </div>

        <div class="pd-audit-settings-section">
            <h4>Auto-audit on project creation</h4>
            <label class="pd-audit-toggle">
                <input type="checkbox" id="pdAutoOnCreate" ${s.autoAuditOnCreate ? 'checked' : ''}>
                <span>Run a full audit automatically whenever a new project is created</span>
            </label>
        </div>

        <div class="pd-audit-settings-section">
            <h4>Weekly re-audit</h4>
            <label class="pd-audit-toggle">
                <input type="checkbox" id="pdWeeklyEnabled" ${s.weeklyEnabled ? 'checked' : ''}>
                <span>Re-audit this project once a week</span>
            </label>
            <div class="pd-audit-inline">
                <label>Day of week
                    <select id="pdWeeklyDow">
                        ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => `<option value="${i}" ${(s.weeklyDayOfWeek||0)===i?'selected':''}>${d}</option>`).join('')}
                    </select>
                </label>
                <label>Hour
                    <input type="number" id="pdWeeklyHour" min="0" max="23" value="${s.weeklyHour != null ? s.weeklyHour : 2}">
                </label>
            </div>
        </div>

        <div class="pd-audit-settings-section">
            <h4>Custom keywords <small>(included in the keyword check)</small></h4>
            <textarea id="pdCustomKeywords" rows="3" placeholder="one keyword per line">${pdEscape((s.customKeywords||[]).join('\n'))}</textarea>
        </div>

        <div class="pd-audit-settings-section">
            <h4>Notifications on completion</h4>
            <label class="pd-audit-toggle">
                <input type="checkbox" id="pdNotifyOnComplete" ${s.notifyOnComplete ? 'checked' : ''}>
                <span>Notify when an audit finishes</span>
            </label>
            <div class="pd-audit-inline">
                <label>Emails (comma-separated)
                    <input type="text" id="pdNotifyEmails" value="${pdEscape((s.notifyEmails||[]).join(', '))}" placeholder="alice@acme.com, bob@acme.com">
                </label>
            </div>
            <div class="pd-audit-inline">
                <label>Webhook URL (optional)
                    <input type="text" id="pdNotifyWebhook" value="${pdEscape(s.notifyWebhook||'')}" placeholder="https://hooks.slack.com/…">
                </label>
            </div>
        </div>

        <div class="pd-audit-settings-actions">
            <button class="pd-btn-primary" id="pdSaveAuditSettings"><i class="fas fa-save"></i> Save settings</button>
            <button class="pd-btn-secondary" id="pdCancelAuditSettings"><i class="fas fa-times"></i> Close</button>
            <span class="pd-audit-settings-status" id="pdSettingsStatus"></span>
        </div>
    `;

    document.getElementById('pdSaveAuditSettings').addEventListener('click', pdSaveSettings);
    document.getElementById('pdCancelAuditSettings').addEventListener('click', () => {
        panel.style.display = 'none';
    });
}

async function pdSaveSettings() {
    const projectId = PD.currentProjectId;
    if (!projectId) return;
    const status = document.getElementById('pdSettingsStatus');
    status.textContent = 'Saving…';

    const checks = Array.from(document.querySelectorAll('#pdAuditChecksGrid input[type=checkbox]'))
        .filter(cb => cb.checked)
        .map(cb => cb.dataset.check);

    const body = {
        enabledChecks: checks,
        autoAuditOnCreate: document.getElementById('pdAutoOnCreate').checked,
        weeklyEnabled: document.getElementById('pdWeeklyEnabled').checked,
        weeklyDayOfWeek: parseInt(document.getElementById('pdWeeklyDow').value, 10),
        weeklyHour: parseInt(document.getElementById('pdWeeklyHour').value, 10),
        customKeywords: document.getElementById('pdCustomKeywords').value
            .split('\n').map(s => s.trim()).filter(Boolean),
        notifyOnComplete: document.getElementById('pdNotifyOnComplete').checked,
        notifyEmails: document.getElementById('pdNotifyEmails').value
            .split(',').map(s => s.trim()).filter(Boolean),
        notifyWebhook: document.getElementById('pdNotifyWebhook').value.trim() || null,
    };

    try {
        const resp = await api(`/api/projects/${projectId}/audit-config`, {
            method: 'PUT',
            body: JSON.stringify(body),
        });
        status.textContent = '✓ Saved';
        setTimeout(() => { status.textContent = ''; }, 2000);
    } catch (err) {
        status.textContent = '✗ ' + (err.message || 'save failed');
    }
}

// Wire up the settings toggle in the patched init
const _pdOrigInit2 = window.initProjectDashboard;
window.initProjectDashboard = async function patchedInit2() {
    await _pdOrigInit2();
    pdEnsureSettingsToggle();
};

// ─── Cancel + retry ───────────────────────────────────────────────────
async function pdCancelAudit(auditId) {
    if (!PD.currentProjectId || !auditId) return;
    if (!confirm('Cancel this audit? Checks that have already started will be skipped.')) return;
    try {
        await api(`/api/projects/${PD.currentProjectId}/audits/${auditId}/cancel`, { method: 'POST' });
        await pdLoadLatestAudit();
    } catch (err) {
        alert('Cancel failed: ' + err.message);
    }
}

async function pdRetryAudit(auditId) {
    if (!PD.currentProjectId || !auditId) return;
    try {
        await api(`/api/projects/${PD.currentProjectId}/audits/${auditId}/retry`, { method: 'POST' });
        await pdLoadLatestAudit();
    } catch (err) {
        alert('Retry failed: ' + err.message);
    }
}

