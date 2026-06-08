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

    document.getElementById('generateReportBtn').addEventListener('click', generateReport);
    document.getElementById('saveReportBtn')?.addEventListener('click', saveReport);
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
        select.innerHTML = '<option value="">No specific client (by domain)</option>';
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

    if (!domain && !clientId) {
        showReportToast('Please enter a domain or select a client', 'error');
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

    const { meta, summary, aiNarrative, data } = report;

    const healthColor = aiNarrative.overallHealthScore >= 70 ? '#10b981'
        : aiNarrative.overallHealthScore >= 40 ? '#f59e0b' : '#ef4444';

    content.innerHTML = `
        <!-- Meta bar -->
        <div style="display:flex;align-items:center;gap:12px;padding:16px;background:var(--bg);border-radius:10px;margin-bottom:20px;flex-wrap:wrap;">
            <div style="flex:1;min-width:200px;">
                <div style="font-weight:700;font-size:1rem;">${escHtml(meta.title)}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                    ${formatDate(meta.periodStart)} → ${formatDate(meta.periodEnd)}
                    ${meta.domain ? ' · ' + escHtml(meta.domain) : ''}
                </div>
            </div>
            <div style="text-align:center;background:white;border:2px solid ${healthColor};border-radius:50%;width:64px;height:64px;display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
                <div style="font-size:1.2rem;font-weight:800;color:${healthColor};line-height:1;">${aiNarrative.overallHealthScore}%</div>
                <div style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Health</div>
            </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">
            ${statChip(summary.trackedKeywords, 'Keywords Tracked', '#4f46e5')}
            ${statChip(summary.top10, 'Top 10', '#10b981')}
            ${statChip(summary.top3, 'Top 3', '#7c3aed')}
            ${statChip(summary.avgPosition || '—', 'Avg Position', '#f59e0b')}
            ${statChip('+' + summary.improved, 'Improved', '#10b981')}
            ${statChip('-' + summary.dropped, 'Dropped', '#ef4444')}
        </div>

        <!-- Traffic estimate -->
        <div style="background:linear-gradient(135deg,#eef2ff,#f5f3ff);border:1px solid #c7d2fe;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
            <div style="font-size:11px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Estimated Monthly Traffic</div>
            <div style="font-size:1.8rem;font-weight:800;color:#4f46e5;">${summary.estimatedMonthlyTraffic.toLocaleString()} <span style="font-size:0.9rem;color:var(--text-muted);font-weight:400;">visits/month</span></div>
        </div>

        <!-- Executive Summary -->
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:14px 16px;margin-bottom:20px;">
            <div style="font-size:11px;font-weight:600;color:#6366f1;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Executive Summary</div>
            <p style="font-size:13px;color:#3730a3;line-height:1.7;margin:0;">${escHtml(aiNarrative.executiveSummary)}</p>
        </div>

        <!-- Wins & Issues -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;">
            <div style="border:1px solid var(--border);border-radius:10px;padding:14px;">
                <div style="font-size:11px;font-weight:600;color:#10b981;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">✓ Key Wins</div>
                ${aiNarrative.keyWins.map(w => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);padding-left:20px;position:relative;"><span style="position:absolute;left:0;color:#10b981;font-weight:700;">✓</span>${escHtml(w)}</div>`).join('')}
            </div>
            <div style="border:1px solid var(--border);border-radius:10px;padding:14px;">
                <div style="font-size:11px;font-weight:600;color:#f59e0b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">⚠ Issues</div>
                ${aiNarrative.keyIssues.map(i => `<div style="font-size:13px;padding:5px 0;border-bottom:1px solid var(--border);padding-left:20px;position:relative;"><span style="position:absolute;left:0;color:#f59e0b;">⚠</span>${escHtml(i)}</div>`).join('')}
            </div>
        </div>

        <!-- Content Recs -->
        <div style="margin-bottom:20px;">
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">✍️ Content Recommendations</div>
            ${aiNarrative.contentRecommendations.map(rec => {
                const icons = { blog: '📝', 'service-page': '🛠️', 'landing-page': '🎯' };
                const colors = { blog: '#eef2ff', 'service-page': '#d1fae5', 'landing-page': '#fef3c7' };
                return `
                <div style="display:flex;gap:10px;border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px;align-items:flex-start;">
                    <div style="width:32px;height:32px;border-radius:8px;background:${colors[rec.type]||'#f3f4f6'};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1rem;">${icons[rec.type]||'📄'}</div>
                    <div>
                        <div style="font-weight:600;font-size:13px;">${escHtml(rec.title)}</div>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${escHtml(rec.rationale)}</div>
                        <span style="display:inline-block;margin-top:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:#eef2ff;color:#4f46e5;">${rec.type}</span>
                    </div>
                </div>`;
            }).join('')}
        </div>

        <!-- Next Month Plan -->
        <div>
            <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">🗓️ Next Month Action Plan</div>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
                ${aiNarrative.nextMonthPlan.map(item => `
                <div style="border:1px solid var(--border);border-radius:8px;padding:12px;background:var(--bg);">
                    <div style="font-size:10px;font-weight:700;color:#4f46e5;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Week ${item.week}</div>
                    <div style="font-size:12px;line-height:1.5;">${escHtml(item.action)}</div>
                </div>`).join('')}
            </div>
        </div>
    `;

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
        // Update open button
        document.getElementById('openReportBtn').onclick = () => window.open(`/reports/${savedReportId}/html`, '_blank');
    } catch (err) {
        showReportToast(`Save failed: ${err.message}`, 'error');
    } finally {
        btn.innerHTML = orig;
        btn.disabled = false;
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
            container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px;">No saved reports yet. Generate your first report above.</p>';
            return;
        }

        container.innerHTML = reports.map(r => `
            <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);">
                <div style="width:36px;height:36px;background:#eef2ff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;">📊</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.title)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">
                        ${r.client_name ? escHtml(r.client_name) + ' · ' : ''}${r.period_days} days · ${formatDate(r.generated_at)}
                    </div>
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
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
function statChip(value, label, color) {
    return `
        <div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:1.4rem;font-weight:800;color:${color};line-height:1;">${value}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${label}</div>
        </div>`;
}

function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escHtml(str) {
    if (!str) return '';
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
