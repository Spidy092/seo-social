/**
 * 📊 Agency Reports Frontend
 * Handles report generation, preview, saving, and navigation.
 */

// ─── State ───
let currentReport = null;
let savedReportId = null;

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
    loadClients();
    loadSavedReports();
    loadScheduledReports();
    checkSmtpStatus();

    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('saveReportBtn')?.addEventListener('click', saveReport);
    document.getElementById('shareReportBtn')?.addEventListener('click', createShareLink);
    document.getElementById('openReportBtn')?.addEventListener('click', openFullReport);

    // Auto-fill title when period or domain changes
    ['reportDomain', 'reportPeriod'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', autoFillTitle);
    });
});

// ─── Load Clients into Select ───
async function loadClients() {
    try {
        const res = await fetch('/api/clients');
        const { clients = [] } = await res.json();
        const select = document.getElementById('reportClientSelect');
        if (!select) return;
        select.innerHTML = '<option value="">Choose a client</option>';
        clients.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = `${c.name}${c.website_url ? ' — ' + c.website_url : ''}`;
            opt.dataset.domain = c.website_url || '';
            select.appendChild(opt);
        });
        select.addEventListener('change', () => {
            const chosen = select.options[select.selectedIndex];
            const domain = chosen.dataset.domain || '';
            if (domain) {
                document.getElementById('reportDomain').value = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
            }
            autoFillTitle();
            if (select.value) showReportToast('Client context set. Review the period, then generate the evidence draft.', 'info');
        });
    } catch (err) {
        console.warn('Could not load clients for report builder:', err.message);
    }
}

// ─── Auto Fill Title ───
function autoFillTitle() {
    const titleEl = document.getElementById('reportTitle');
    if (titleEl && !titleEl.value) {
        const domain = document.getElementById('reportDomain')?.value?.trim();
        const now = new Date();
        const month = now.toLocaleString('default', { month: 'long' });
        const year = now.getFullYear();
        titleEl.value = `SEO Report${domain ? ' — ' + domain : ''} — ${month} ${year}`;
    }
}

// ─── Generate Report ───
async function generateReport() {
    const domain = document.getElementById('reportDomain')?.value?.trim();
    const clientId = document.getElementById('reportClientSelect')?.value || null;
    const periodDays = parseInt(document.getElementById('reportPeriod')?.value || '30');
    const reportTitle = document.getElementById('reportTitle')?.value?.trim();
    const includePageSpeed = document.getElementById('reportIncludePageSpeed')?.checked !== false;

    if (!clientId) {
        showReportToast('Choose a client to keep this report agency-scoped.', 'error');
        return;
    }

    const btn = document.getElementById('generateReportBtn');
    const generating = document.getElementById('reportGenerating');
    btn.style.display = 'none';
    generating.style.display = 'block';
    savedReportId = null;

    try {
        const res = await fetch('/api/reports/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domain: domain || null,
                clientId: clientId || null,
                periodDays,
                reportTitle: reportTitle || undefined,
                includePageSpeed,
            }),
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to generate report');

        currentReport = data.report;
        renderReportPreview(currentReport);
        showReportToast('Report generated successfully!', 'success');
    } catch (err) {
        showReportToast(`Error: ${err.message}`, 'error');
    } finally {
        btn.style.display = '';
        generating.style.display = 'none';
    }
}

// ─── Render Preview ───
function renderReportPreview(report) {
    const card = document.getElementById('reportPreviewCard');
    const content = document.getElementById('reportPreviewContent');
    if (!card || !content) return;

    const { meta = {}, summary = {}, aiNarrative = {}, data = {} } = report || {};
    const list = value => Array.isArray(value) ? value : [];
    const metric = value => value === null || value === undefined || value === '' ? 'Not collected' : value;
    const wins = list(aiNarrative.keyWins);
    const issues = list(aiNarrative.keyIssues);
    const recommendations = list(aiNarrative.contentRecommendations);
    const plan = list(aiNarrative.nextMonthPlan);
    const provenance = report.provenance || {};
    const sourceCount = Object.values(provenance).filter(item => item && item.status !== 'not_collected').length;
    const estimatedTraffic = summary.trackedKeywords ? Number(summary.estimatedMonthlyTraffic || 0).toLocaleString() : 'Not collected';
    const gscClicks = data.gsc ? summary.gscClicks : 'Not collected';

    content.innerHTML = `
        <div class="ed-preview-meta">
            <div><div class="ed-preview-title">${escHtml(meta.title || 'Untitled report')}</div><div class="ed-preview-meta-copy">${formatDate(meta.periodStart)} → ${formatDate(meta.periodEnd)}${meta.domain ? ` · ${escHtml(meta.domain)}` : ''}</div></div>
            <div class="ed-preview-score"><strong>${metric(aiNarrative.overallHealthScore)}${aiNarrative.overallHealthScore !== undefined && aiNarrative.overallHealthScore !== null ? '%' : ''}</strong><span>Narrative signal</span></div>
        </div>
        <div class="ed-preview-grid">
            ${statChip(metric(summary.trackedKeywords), 'Tracked keywords')}
            ${statChip(metric(summary.top10), 'Top 10 positions')}
            ${statChip(metric(summary.top3), 'Top 3 positions')}
            ${statChip(metric(summary.avgPosition), 'Average position')}
            ${statChip(`+${metric(summary.improved)}`, 'Improved')}
            ${statChip(`-${metric(summary.dropped)}`, 'Dropped')}
            ${statChip(metric(summary.projectKeywords || summary.totalKeywords), 'Client keywords')}
            ${statChip(metric(summary.latestTechnicalScore), 'Technical score')}
            ${statChip(metric(gscClicks), 'GSC clicks')}
        </div>
        <div class="ed-preview-block"><h3>Traffic estimate <span class="ed-preview-inline-note">Proxy from ranking CTR model</span></h3><p class="ed-preview-large-value">${estimatedTraffic} <span>visits / month</span></p></div>
        <div class="ed-preview-columns">
            <div class="ed-preview-block"><h3>Executive summary</h3><p>${escHtml(aiNarrative.executiveSummary || 'No narrative was generated for this draft.')}</p></div>
            <div class="ed-preview-block"><h3>Report coverage</h3><p>${sourceCount} source${sourceCount === 1 ? '' : 's'} contributed. Open the source coverage row above before saving this draft.</p></div>
        </div>
        <div class="ed-preview-columns">
            <div class="ed-preview-block"><h3>Key wins</h3>${renderPreviewList(wins, 'No wins recorded in this period.', 'green')}</div>
            <div class="ed-preview-block"><h3>Issues to review</h3>${renderPreviewList(issues, 'No issues recorded in this period.', 'amber')}</div>
        </div>
        ${renderGscPreview(data.gsc)}
        <div class="ed-preview-block"><h3>PageSpeed and Core Web Vitals</h3>${renderPageSpeedPreview(data.pageSpeed)}</div>
        <div class="ed-preview-block"><h3>Content recommendations</h3>${recommendations.length ? recommendations.map(rec => `<div class="ed-preview-recommendation"><strong>${escHtml(rec.title)}</strong><span>${escHtml(rec.rationale)}</span><small>${escHtml(rec.type || 'recommendation')}</small></div>`).join('') : '<p>Not collected.</p>'}</div>
        <div class="ed-preview-block"><h3>Next month action plan</h3>${plan.length ? `<ol class="ed-preview-plan">${plan.map(item => `<li><strong>Week ${escHtml(item.week)}</strong><span>${escHtml(item.action)}</span></li>`).join('')}</ol>` : '<p>No action plan was generated.</p>'}</div>
    `;

    window.evidenceDesk?.markReportSources(report);
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Save Report ───
async function saveReport() {
    if (!currentReport) return;
    const btn = document.getElementById('saveReportBtn');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/reports/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ report: currentReport }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        savedReportId = data.reportId;
        showReportToast('Report saved!', 'success');
        loadSavedReports();
        const shareBtn = document.getElementById('shareReportBtn');
        if (shareBtn) shareBtn.disabled = false;
        // Update open button
        document.getElementById('openReportBtn').onclick = () => window.open(`/reports/${savedReportId}/html`, '_blank');
    } catch (err) {
        showReportToast(`Save failed: ${err.message}`, 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
    }
}

async function requestShareLink(id) {
    const res = await fetch(`/api/reports/${id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInHours: 168 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create share link');
    return `${window.location.origin}${data.sharePath}`;
}

async function copyShareLink(id) {
    const url = await requestShareLink(id);
    try {
        await navigator.clipboard.writeText(url);
        showReportToast('Share link copied. It expires in 7 days.', 'success');
    } catch {
        window.prompt('Copy this share link', url);
    }
}

async function createShareLink() {
    if (!savedReportId) {
        showReportToast('Save the report first to create a controlled share link.', 'warning');
        return;
    }
    const btn = document.getElementById('shareReportBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating...';
    }
    try {
        await copyShareLink(savedReportId);
    } catch (err) {
        showReportToast(`Share failed: ${err.message}`, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-link"></i> Copy share link';
        }
    }
}

async function shareReportById(id) {
    try {
        await copyShareLink(id);
        loadSavedReports();
    } catch (err) {
        showReportToast(`Share failed: ${err.message}`, 'error');
    }
}

// ─── Open Full Report ───
function openFullReport() {
    if (savedReportId) {
        window.open(`/reports/${savedReportId}/html`, '_blank');
    } else {
        showReportToast('Save the report first to open the full printable version', 'warning');
    }
}

// ─── Load Saved Reports ───
async function loadSavedReports() {
    const container = document.getElementById('savedReportsList');
    if (!container) return;

    try {
        const res = await fetch('/api/reports');
        const { reports = [] } = await res.json();

        if (!reports.length) {
            container.innerHTML = '<p class="ed-empty-copy">No saved reports yet. Generate the first evidence draft above.</p>';
            return;
        }

        container.innerHTML = reports.map(r => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="width:30px;height:30px;background:#f4e6df;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8f3d20;flex-shrink:0;"><i class="fas fa-file-lines"></i></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">
                        ${r.client_name ? escHtml(r.client_name) + ' · ' : ''}${r.period_days} days · ${formatDate(r.generated_at)}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button onclick="shareReportById(${r.id})" class="btn btn-sm btn-outline" title="Copy expiring share link">
                        <i class="fas fa-link"></i>
                    </button>
                    <button onclick="window.open('/reports/${r.id}/html','_blank')" class="btn btn-sm btn-primary" title="Open full report">
                        <i class="fas fa-external-link-alt"></i>
                    </button>
                    <button onclick="deleteReport(${r.id})" class="btn btn-sm btn-outline" title="Delete" style="color:#ef4444;border-color:#fecaca;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        container.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:12px;">Could not load saved reports.</p>`;
    }
}

// ─── Delete Report ───
async function deleteReport(id) {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
        await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        loadSavedReports();
        showReportToast('Report deleted', 'success');
    } catch (err) {
        showReportToast('Delete failed', 'error');
    }
}

// ─── Helpers ───


function renderGscPreview(gsc) {
    if (!gsc) return '';
    const ctr = gsc.ctr === null || gsc.ctr === undefined ? '—' : `${(Number(gsc.ctr) * 100).toFixed(1)}%`;
    const position = gsc.position === null || gsc.position === undefined ? '—' : Number(gsc.position).toFixed(1);
    const quickWins = (gsc.quickWinKeywords || []).slice(0, 4);
    const lowCtr = (gsc.lowCtrPages || []).slice(0, 4);
    return `
        <div class="ed-preview-block ed-preview-source-block">
            <h3>Google Search Console <span class="ed-preview-inline-note">Stored client source</span></h3>
            <div class="ed-preview-grid ed-preview-grid-compact">
                ${statChip(gsc.clicks || 0, 'Clicks')}
                ${statChip(gsc.impressions || 0, 'Impressions')}
                ${statChip(ctr, 'CTR')}
                ${statChip(position, 'Average position')}
            </div>
            <div class="ed-preview-source-columns">
                <div>${quickWins.length ? `<strong>Quick wins</strong>${quickWins.map(row => `<span>${escHtml(row.query)} · #${Number(row.position).toFixed(1)}</span>`).join('')}` : '<span>Not collected.</span>'}</div>
                <div>${lowCtr.length ? `<strong>Low CTR pages</strong>${lowCtr.map(row => `<span>${escHtml((row.page || '').replace(/^https?:\/\//, ''))} · ${(Number(row.ctr) * 100).toFixed(1)}%</span>`).join('')}` : '<span>Not collected.</span>'}</div>
            </div>
        </div>
    `;
}

function renderPageSpeedPreview(pageSpeed) {
    if (!pageSpeed) {
        return '<p>Not collected. Add a website URL or run a PageSpeed check before using performance data in a client report.</p>';
    }
    const scores = pageSpeed.scores || {};
    const metrics = pageSpeed.metrics || {};
    const source = pageSpeed.source === 'google-pagespeed-insights' ? 'Google PSI mobile' : 'Technical crawl proxy';
    const metricItems = [metrics.lcp, metrics.inp, metrics.cls, metrics.fcp, metrics.speedIndex, metrics.avgLoad]
        .filter(Boolean)
        .slice(0, 4)
        .map(item => `<div class="ed-preview-metric"><span>${escHtml(item.title)}</span><strong>${escHtml(item.displayValue || '—')}</strong></div>`)
        .join('');
    const opportunities = (pageSpeed.opportunities || [])
        .slice(0, 2)
        .map(item => `<span class="ed-preview-opportunity">${escHtml(item.title)} ${item.displayValue ? `(${escHtml(item.displayValue)})` : ''}</span>`)
        .join('');

    return `
        <div class="ed-preview-source-note"><span class="ed-status-dot ${pageSpeed.source === 'google-pagespeed-insights' ? 'ed-status-dot-green' : 'ed-status-dot-amber'}"></span> ${source}</div>
        <div class="ed-preview-grid ed-preview-grid-compact">
            ${statChip(scores.performance ?? '—', 'Performance')}
            ${statChip(scores.accessibility ?? '—', 'Accessibility')}
            ${statChip(scores.bestPractices ?? '—', 'Best practices')}
            ${statChip(scores.seo ?? '—', 'SEO')}
        </div>
        ${metricItems || '<p>No metric details available.</p>'}
        ${opportunities ? `<div class="ed-preview-opportunities">${opportunities}</div>` : ''}
    `;
}

function statChip(value, label) {
    return `
        <div class="ed-preview-stat">
            <strong>${escHtml(value)}</strong>
            <span>${escHtml(label)}</span>
        </div>`;
}

function renderPreviewList(items, emptyMessage, tone) {
    if (!items.length) return `<p>${escHtml(emptyMessage)}</p>`;
    return `<ul class="ed-preview-list ed-preview-list-${tone}">${items.map(item => `<li>${escHtml(item)}</li>`).join('')}</ul>`;
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function showReportToast(message, type = 'info') {
    // Try to use the app's existing toast system if available
    if (typeof showToast === 'function') {
        showToast(message, type);
        return;
    }
    // Fallback minimal toast
    const toast = document.createElement('div');
    const colors = { success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#4f46e5' };
    toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:${colors[type]||colors.info};color:white;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:500;z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,0.2);animation:fadeIn 0.3s ease;`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ─── Scheduled Email Reports ─────────────────────────────────────────────────
async function checkSmtpStatus() {
    const container = document.getElementById('scheduledReportsSmtpStatus');
    if (!container) return;
    try {
        const res = await fetch('/api/scheduled-reports/smtp-status');
        const data = await res.json();
        if (data.ok) {
            container.innerHTML = '<span style="color:#10b981;font-size:12px;"><i class="fas fa-check-circle"></i> SMTP connected</span>';
        } else {
            container.innerHTML = `<span style="color:#f59e0b;font-size:12px;"><i class="fas fa-exclamation-triangle"></i> SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASS in .env</span>`;
        }
    } catch {
        container.innerHTML = '<span style="color:#94a3b8;font-size:12px;">Could not check SMTP status</span>';
    }
}

async function loadScheduledReports() {
    const container = document.getElementById('scheduledReportsList');
    if (!container) return;
    try {
        const res = await fetch('/api/scheduled-reports');
        const { schedules = [] } = await res.json();
        if (!schedules.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:12px;">No scheduled reports yet.</p>';
            return;
        }
        const freqLabels = { weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' };
        container.innerHTML = schedules.map(s => {
            const recipients = Array.isArray(s.recipients) ? s.recipients : [];
            return `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="width:36px;height:36px;background:#dbeafe;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0;">
                    <i class="fas fa-envelope" style="color:#2563eb;"></i>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;">${escHtml(s.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">
                        ${escHtml(s.domain)} · ${freqLabels[s.frequency] || s.frequency} at ${String(s.hour).padStart(2, '0')}:00
                        · ${recipients.length} recipient${recipients.length !== 1 ? 's' : ''}
                    </div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
                        ${s.last_sent_at ? 'Last sent: ' + formatDate(s.last_sent_at) : 'Never sent'}
                        ${s.next_run_at ? ' · Next: ' + formatDate(s.next_run_at) : ''}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;align-items:center;">
                    <span style="font-size:11px;padding:3px 8px;border-radius:12px;font-weight:600;${s.is_active ? 'background:#d1fae5;color:#065f46;' : 'background:#fee2e2;color:#991b1b;'}">${s.is_active ? 'Active' : 'Paused'}</span>
                    <button onclick="toggleScheduledReport(${s.id}, ${!s.is_active})" class="btn btn-sm btn-outline" title="${s.is_active ? 'Pause' : 'Resume'}">
                        <i class="fas ${s.is_active ? 'fa-pause' : 'fa-play'}"></i>
                    </button>
                    <button onclick="deleteScheduledReport(${s.id})" class="btn btn-sm btn-outline" title="Delete" style="color:#ef4444;border-color:#fecaca;">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join('');
    } catch {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:12px;">Could not load scheduled reports.</p>';
    }
}

async function createScheduledReport() {
    const domain = document.getElementById('schedDomain')?.value?.trim();
    const title = document.getElementById('schedTitle')?.value?.trim() || 'Monthly SEO Report';
    const recipientsRaw = document.getElementById('schedRecipients')?.value?.trim();
    const frequency = document.getElementById('schedFrequency')?.value || 'monthly';
    const hour = parseInt(document.getElementById('schedHour')?.value || '8');
    const dayOfMonth = parseInt(document.getElementById('schedDayOfMonth')?.value || '1');

    if (!domain) { showReportToast('Enter a domain', 'error'); return; }
    if (!recipientsRaw) { showReportToast('Enter at least one recipient email', 'error'); return; }

    const recipients = recipientsRaw.split(',').map(e => e.trim()).filter(Boolean);
    if (!recipients.length) { showReportToast('Enter valid email(s)', 'error'); return; }

    try {
        const res = await fetch('/api/scheduled-reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, title, recipients, frequency, hour, dayOfMonth }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create schedule');
        showReportToast('Scheduled report created!', 'success');
        loadScheduledReports();
        // Clear form
        document.getElementById('schedDomain').value = '';
        document.getElementById('schedRecipients').value = '';
        document.getElementById('schedTitle').value = '';
    } catch (err) {
        showReportToast(`Error: ${err.message}`, 'error');
    }
}

async function toggleScheduledReport(id, isActive) {
    try {
        await fetch(`/api/scheduled-reports/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive }),
        });
        loadScheduledReports();
    } catch (err) {
        showReportToast('Failed to update schedule', 'error');
    }
}

async function deleteScheduledReport(id) {
    if (!confirm('Delete this scheduled report?')) return;
    try {
        await fetch(`/api/scheduled-reports/${id}`, { method: 'DELETE' });
        loadScheduledReports();
        showReportToast('Schedule deleted', 'success');
    } catch {
        showReportToast('Delete failed', 'error');
    }
}

async function sendTestEmail() {
    const recipients = document.getElementById('schedRecipients')?.value?.trim();
    if (!recipients) { showReportToast('Enter a recipient email first', 'error'); return; }
    const email = recipients.split(',')[0].trim();
    try {
        const res = await fetch('/api/scheduled-reports/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showReportToast(`Test email sent to ${email}`, 'success');
    } catch (err) {
        showReportToast(`Test failed: ${err.message}`, 'error');
    }
}
