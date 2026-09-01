/**
 * Autopilot — frontend controller
 * Drives the autonomous research -> analysis -> AI verdict -> action plan flow.
 */

const AP = {
    currentResult: null,
    steps: ['research', 'competitors', 'page-analysis', 'compare', 'action-plan'],
};

function apEscape(value) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(value);
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function apFormatTimeAgo(dateStr) {
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

function apShowProgress(show) {
    const el = document.getElementById('apProgress');
    if (el) el.style.display = show ? '' : 'none';
    if (show) {
        document.querySelectorAll('#apFlowSteps .ap-flow-step').forEach(s => s.classList.remove('active', 'done'));
    }
}

function apSetFlowStep(stepName, detailText) {
    const idx = AP.steps.indexOf(stepName);
    document.querySelectorAll('#apFlowSteps .ap-flow-step').forEach(el => {
        const elIdx = AP.steps.indexOf(el.dataset.step);
        el.classList.remove('active', 'done');
        if (elIdx < idx) el.classList.add('done');
        else if (elIdx === idx) el.classList.add('active');
    });
    const detail = document.getElementById('apProgressDetail');
    if (detail && detailText) detail.textContent = detailText;
}

function apShowError(message) {
    const banner = document.getElementById('apErrorBanner');
    const body = document.getElementById('apErrorBody');
    if (banner && body) {
        body.innerHTML = `<i class="fas fa-triangle-exclamation"></i> ${apEscape(message)}`;
        banner.style.display = '';
    }
}

function apClearError() {
    const banner = document.getElementById('apErrorBanner');
    if (banner) banner.style.display = 'none';
}

function apVerdictClass(verdict) {
    const v = (verdict || '').toLowerCase();
    if (v.includes('domina') || v.includes('winning')) return 'high';
    if (v.includes('risk') || v.includes('behind') || v.includes('crush')) return 'low';
    return 'medium';
}

function apRenderVerdict(comparison) {
    const ai = comparison?.aiAnalysis || {};
    document.getElementById('apVerdictTitle').textContent = ai.verdict || 'Analysis complete';
    document.getElementById('apVerdictSummary').textContent = ai.strategicSummary || 'No AI summary available.';
    document.getElementById('apVerdictObservation').innerHTML = ai.keyObservation
        ? `<i class="fas fa-circle-info"></i> ${apEscape(ai.keyObservation)}`
        : '';

    const score = Number.isFinite(ai.aiScore) ? Math.round(ai.aiScore) : null;
    const ring = document.getElementById('apScoreRing');
    const scoreEl = document.getElementById('apScoreValue');
    if (score !== null) {
        const color = score >= 66 ? 'var(--secondary)' : score >= 40 ? 'var(--warning)' : 'var(--danger)';
        ring.style.background = `conic-gradient(${color} ${score * 3.6}deg, var(--gray-light) 0deg)`;
        scoreEl.textContent = score;
    } else {
        scoreEl.textContent = '—';
    }

    const da = comparison?.scores?.domainAuthority;
    const meta = [];
    if (da) meta.push(`Domain authority: you ${da.mine ?? '—'} vs competitor ${da.competitor ?? '—'}`);
    if (comparison?.overallScore !== undefined) meta.push(`Overall score: ${comparison.overallScore}/100`);
    document.getElementById('apVerdictMeta').textContent = meta.join('  ·  ');
}

function apRenderActionPlan(result) {
    const list = document.getElementById('apActionPlanList');
    const plan = result.actionPlan || [];
    const hint = document.getElementById('apPlanHint');
    hint.textContent = result.tasksCreated?.length
        ? `${result.tasksCreated.length} task(s) created automatically`
        : 'Enable "auto-create tasks" and attach a project to push these straight to your task board';

    if (!plan.length) {
        list.innerHTML = '<p class="text-muted">No specific action items — your page is already competitive on the factors we measured.</p>';
        return;
    }

    list.innerHTML = plan.map((item, i) => `
        <div class="ap-plan-item">
            <div class="ap-plan-rank">${i + 1}</div>
            <div class="ap-plan-body">
                <div class="ap-plan-title-row">
                    <span class="ap-plan-title">${apEscape(item.action)}</span>
                    <span class="ap-plan-priority ${(item.priority || 'low').toLowerCase()}">${apEscape(item.priority || 'low')}</span>
                </div>
                ${item.why ? `<p style="margin:4px 0 0;color:var(--gray);font-size:0.82rem;">${apEscape(item.why)}</p>` : ''}
                ${(item.details || []).length ? `<ul class="ap-plan-details">${item.details.map(d => `<li>${apEscape(d)}</li>`).join('')}</ul>` : ''}
                <div class="ap-plan-footer">
                    ${item.estimatedImpact ? `<span><i class="fas fa-arrow-trend-up"></i> ${apEscape(item.estimatedImpact)}</span>` : ''}
                    ${item.effort ? `<span><i class="fas fa-gauge"></i> Effort: ${apEscape(item.effort)}</span>` : ''}
                    ${item.timeline ? `<span><i class="fas fa-clock"></i> ${apEscape(item.timeline)}</span>` : ''}
                </div>
            </div>
        </div>
    `).join('');

    if (result.tasksCreated?.length) {
        list.innerHTML += `<div class="ap-task-badge"><i class="fas fa-check-circle"></i> Pushed to your task board</div>`;
    }
}

function apRenderRelatedKeywords(result) {
    const wrap = document.getElementById('apRelatedKeywords');
    const related = result.relatedKeywords || [];
    if (!related.length) {
        wrap.innerHTML = '<p class="text-muted">No related keyword opportunities found.</p>';
        return;
    }
    wrap.innerHTML = related.map(k => `<span class="ap-keyword-chip">${apEscape(k.keyword || k)}</span>`).join('');
}

function apRenderResult(result) {
    AP.currentResult = result;
    document.getElementById('apResults').style.display = '';
    apRenderVerdict(result.comparison);
    apRenderActionPlan(result);
    apRenderRelatedKeywords(result);
    document.getElementById('apResults').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function apRun() {
    const myDomain = document.getElementById('apMyDomain')?.value.trim();
    const keyword = document.getElementById('apKeyword')?.value.trim();
    const location = document.getElementById('apLocation')?.value || 'India';
    const projectId = document.getElementById('apProjectSelect')?.value || '';
    const autoCreateTasks = document.getElementById('apAutoCreateTasks')?.checked || false;

    if (!myDomain || !keyword) {
        apShowError('Both your domain and a target keyword are required.');
        return;
    }
    if (autoCreateTasks && !projectId) {
        apShowError('Attach a project first if you want tasks auto-created.');
        return;
    }

    apClearError();
    document.getElementById('apResults').style.display = 'none';
    apShowProgress(true);
    apSetFlowStep('research', `Researching "${keyword}" in ${location}…`);

    const stepMessages = {
        research: `Researching "${keyword}" in ${location}…`,
        competitors: 'Discovering ranking competitors…',
        'page-analysis': 'Crawling and analyzing pages…',
        compare: 'Getting the AI expert verdict…',
        'action-plan': 'Building the prioritized action plan…',
    };

    let stepIdx = 0;
    const ticker = setInterval(() => {
        stepIdx = Math.min(AP.steps.length - 1, stepIdx + 1);
        const step = AP.steps[stepIdx];
        apSetFlowStep(step, stepMessages[step]);
    }, 2200);

    const btn = document.getElementById('apRunBtn');
    if (btn) btn.disabled = true;

    try {
        const data = await api('/api/autopilot/run', {
            method: 'POST',
            body: JSON.stringify({
                myDomain,
                keyword,
                location,
                projectId: projectId || undefined,
                autoCreateTasks,
            }),
        });
        clearInterval(ticker);
        if (!data.success) {
            apShowProgress(false);
            apShowError(data.error || 'Autopilot run failed.');
            return;
        }
        apSetFlowStep('action-plan', 'Done!');
        setTimeout(() => {
            apShowProgress(false);
            apRenderResult(data.result);
            apLoadHistory();
        }, 300);
    } catch (err) {
        clearInterval(ticker);
        apShowProgress(false);
        apShowError(err.message || 'Autopilot run failed.');
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function apLoadHistory() {
    const list = document.getElementById('apHistoryList');
    if (!list) return;
    try {
        const data = await api('/api/autopilot/history');
        const history = data.history || [];
        if (!history.length) {
            list.innerHTML = '<p class="text-muted">No runs yet. Kick off your first autopilot run.</p>';
            return;
        }
        list.innerHTML = history.map(h => `
            <div class="ap-history-item" data-id="${h.id}">
                <div class="ap-history-meta">
                    <div class="ap-history-keyword">${apEscape(h.keyword)}</div>
                    <div class="ap-history-sub">${apEscape(h.my_domain)} · ${apEscape(h.ai_verdict || 'No verdict')} · ${apFormatTimeAgo(h.created_at)}</div>
                </div>
                <span class="ap-plan-priority ${apVerdictClass(h.ai_verdict)}">${h.ai_score ?? '—'}</span>
            </div>
        `).join('');

        list.querySelectorAll('.ap-history-item').forEach(el => {
            el.addEventListener('click', async () => {
                try {
                    const runData = await api(`/api/autopilot/${el.dataset.id}`);
                    if (runData.success) apRenderResult(runData.run.result);
                } catch (err) {
                    console.error('Failed to load autopilot run:', err);
                }
            });
        });
    } catch (err) {
        console.error('Failed to load autopilot history:', err);
    }
}

async function initAutopilotPage() {
    if (typeof loadProjectOptions === 'function') {
        await loadProjectOptions('apProjectSelect', { includeAllLabel: 'No project' });
    }
    await apLoadHistory();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apRunBtn')?.addEventListener('click', apRun);
    document.getElementById('apRefreshHistoryBtn')?.addEventListener('click', apLoadHistory);
});
