/* =====================================================
   Sitemap Generator – sitemap.js
   ===================================================== */
(function () {
    'use strict';

    // ─── State ────────────────────────────────────────────
    let currentMode = 'quick';   // 'quick' | 'client'
    let quickXml    = '';
    let clientXml   = '';
    let currentSavedId = null;
    let quickUrls   = [];
    let currentClientId = null;

    // ─── DOM refs ─────────────────────────────────────────
    const $ = id => document.getElementById(id);

    // Tabs
    const tabQuick  = $('smTabQuick');
    const tabClient = $('smTabClient');
    const panelQuick  = $('smPanelQuick');
    const panelClient = $('smPanelClient');

    // Quick mode
    const qGenBtn     = $('smQuickGenBtn');
    const qIdle       = $('smQuickIdle');
    const qProgress   = $('smQuickProgress');
    const qProgressLbl = $('smQuickProgressLabel');
    const qProgressBar = $('smQuickProgressBar');
    const qProgressStats = $('smQuickProgressStats');
    const qResult     = $('smQuickResult');
    const qError      = $('smQuickError');

    // Client mode
    const cClientSel  = $('smClientSelect');
    const cGenBtn     = $('smClientGenBtn');
    const cIdle       = $('smClientIdle');
    const cProgress   = $('smClientProgress');
    const cProgressLbl = $('smClientProgressLabel');
    const cProgressBar = $('smClientProgressBar');
    const cProgressStats = $('smClientProgressStats');
    const cResult     = $('smClientResult');
    const cError      = $('smClientError');
    const historyCard = $('smHistoryCard');
    const historyList = $('smHistoryList');

    // ─── Tab switching ────────────────────────────────────
    function switchTab(mode) {
        currentMode = mode;
        tabQuick.classList.toggle('active', mode === 'quick');
        tabClient.classList.toggle('active', mode === 'client');
        panelQuick.style.display  = mode === 'quick'  ? '' : 'none';
        panelClient.style.display = mode === 'client' ? '' : 'none';
        if (mode === 'quick') panelQuick.classList.add('active');
        else panelQuick.classList.remove('active');
        if (mode === 'client') loadClients();
    }

    tabQuick.addEventListener('click',  () => switchTab('quick'));
    tabClient.addEventListener('click', () => switchTab('client'));

    // ─── Helpers ──────────────────────────────────────────
    function showToast(msg, type = 'success') {
        if (typeof window.showToast === 'function') window.showToast(msg, type);
        else console.log(`[${type}]`, msg);
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }

    function readQuickOpts() {
        return {
            url:             $('smQuickUrl').value.trim(),
            maxPages:        parseInt($('smQuickMaxPages').value) || 500,
            maxDepth:        parseInt($('smQuickDepth').value) || 3,
            requestDelayMs:  parseInt($('smQuickDelay').value) || 300,
            defaultPriority: parseFloat($('smQuickPriority').value) || 0.6,
            respectRobots:   $('smQuickRespectRobots').checked,
            respectNoindex:  $('smQuickRespectNoindex').checked,
            followRedirects: $('smQuickFollowRedirects').checked,
            includeLastMod:  $('smQuickIncludeLastMod').checked,
            autoSplit:       $('smQuickAutoSplit').checked,
            stripUtmParams:  $('smQuickStripUtm').checked,
            stripQueryStrings: $('smQuickStripAllQueries') ? $('smQuickStripAllQueries').checked : false,
        };
    }

    function readClientOpts() {
        return {
            clientId:           cClientSel.value,
            startUrl:           $('smClientUrl').value.trim(),
            maxPages:           parseInt($('smClientMaxPages').value) || 5000,
            maxDepth:           parseInt($('smClientDepth').value) || 5,
            requestDelayMs:     parseInt($('smClientDelay').value) || 300,
            defaultPriority:    parseFloat($('smClientPriority').value) || 0.6,
            respectRobots:      $('smClientRespectRobots').checked,
            respectNoindex:     $('smClientRespectNoindex').checked,
            followRedirects:    $('smClientFollowRedirects').checked,
            includeLastMod:     $('smClientIncludeLastMod').checked,
            autoSplit:          $('smClientAutoSplit').checked,
            stripUtmParams:     $('smClientStripUtm').checked,
            stripQueryStrings:  $('smClientStripAllQueries') ? $('smClientStripAllQueries').checked : false,
            includeGscUrls:     $('smClientMergeGsc').checked,
            includeRankingUrls: $('smClientMergeRanking').checked,
            saveResult:         true,
        };
    }

    // ─── Quick generate ───────────────────────────────────
    qGenBtn.addEventListener('click', async () => {
        const opts = readQuickOpts();
        if (!opts.url) { showToast('Please enter a website URL.', 'error'); return; }

        // Reset UI
        qIdle.style.display    = 'none';
        qProgress.style.display = '';
        qResult.style.display  = 'none';
        qError.style.display   = 'none';
        qGenBtn.disabled = true;
        qProgressBar.style.width = '5%';
        qProgressLbl.textContent = 'Fetching robots.txt…';
        qProgressStats.textContent = '';

        let sse = null;
        try {
            const progressUrl = new URL(opts.url);
            sse = new EventSource('/api/sitemap/progress?url=' + encodeURIComponent(progressUrl.href));
            sse.onmessage = (e) => {
                const data = JSON.parse(e.data);
                const percent = Math.min(100, Math.round((data.crawled / data.max) * 100));
                qProgressBar.style.width = Math.max(5, percent) + '%';
                qProgressLbl.textContent = `Crawling: ${data.currentUrl}`;
                qProgressStats.textContent = `${data.crawled} / ${data.max} pages`;
            };
        } catch(e) {}

        try {
            const res = await fetch('/api/sitemap/generate', {
                method:  'POST',
                headers: {'Content-Type': 'application/json'},
                body:    JSON.stringify(opts),
            });
            if (sse) sse.close();
            const data = await res.json();

            if (!res.ok || !data.success) throw new Error(data.error || data.message || 'Unknown error');

            quickXml  = data.xml;
            quickUrls = data.urls || [];
            renderQuickResult(data);
            // Pro: stash image/video/news data for the tab strip + reports
            const images = (data.pages || []).flatMap(p => (p.images || []).map(i => ({ loc: i.loc, title: i.title })));
            const videos = (data.pages || []).flatMap(p => (p.videos || []));
            const news   = (data.pages || []).flatMap(p => (p.news   || []));
            if (window.sitemapPro) {
                window.sitemapPro.setImageData(images);
                window.sitemapPro.setVideoData(videos);
                window.sitemapPro.setNewsData(news);
                window.sitemapPro.refreshAfterCrawl('quick', data);
            }
        } catch (err) {
            if (sse) sse.close();
            $('smQuickErrorTitle').textContent = 'Crawl failed';
            $('smQuickErrorMsg').textContent   = err.message;
            qProgress.style.display = 'none';
            qError.style.display    = '';
            showToast(err.message, 'error');
        } finally {
            qGenBtn.disabled = false;
        }
    });

    function renderQuickResult(data) {
        qProgress.style.display = 'none';
        qResult.style.display   = '';
        qProgressBar.style.width = '100%';

        const total = (data.stats && data.stats.crawled) || data.totalUrls || 0;
        const stats = data.stats || {};
        const skipped = stats.skipped || data.skipped || 0;
        const durationMs = stats.durationMs || data.crawlTimeMs || 0;
        $('smQuickResultTitle').textContent = `Sitemap ready – ${total.toLocaleString()} URL${total !== 1 ? 's' : ''}`;
        $('smQuickResultSub').textContent   = `Crawled in ${(durationMs/1000).toFixed(1)}s · ${skipped} skipped`;

        // Pro: render the summary chips + ISO 8601 lastmod display
        const summary = $('smQuickSummary');
        if (summary && window.sitemapPro) {
            window.sitemapPro.renderSummary(summary, stats);
            summary.style.display = '';
        }

        // Show first 120 lines of XML in preview
        const lines = quickXml.split('\n').slice(0, 1000).join('\n');
        $('smQuickXmlPreview').textContent = lines + (quickXml.split('\n').length > 1000 ? '\n…(truncated)' : '');

        // Populate URL table — full ISO 8601 in lastmod
        const tbody = document.querySelector('#smQuickUrlTable tbody');
        tbody.innerHTML = '';
        quickUrls.slice(0, 2000).forEach((u, i) => {
            const tr = document.createElement('tr');
            const lastmod = u.lastmod ? u.lastmod.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—';
            tr.innerHTML = `<td>${i+1}</td><td>${escHtml(u.url || u)}</td><td>${u.priority || '—'}</td><td>${u.changefreq || '—'}</td><td>${escHtml(lastmod)}</td>`;
            tbody.appendChild(tr);
        });
        $('smQuickUrlCount').textContent = `${total.toLocaleString()} URLs`;
    }

    // URL table search
    $('smQuickUrlSearch').addEventListener('input', function () {
        const q = this.value.toLowerCase();
        document.querySelectorAll('#smQuickUrlTable tbody tr').forEach(tr => {
            tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
    });

    // Toggle URL list
    $('smQuickToggleUrlsBtn').addEventListener('click', () => {
        const wrap = $('smQuickUrlTableWrap');
        const visible = wrap.style.display !== 'none';
        wrap.style.display = visible ? 'none' : '';
        $('smQuickToggleUrlsBtn').innerHTML = visible
            ? '<i class="fas fa-list"></i> Show URL list'
            : '<i class="fas fa-list"></i> Hide URL list';
    });

    // Copy XML
    $('smQuickCopyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(quickXml).then(() => showToast('XML copied to clipboard!'));
    });

    // Download
    $('smQuickDownloadBtn').addEventListener('click', () => {
        downloadXml(quickXml, 'sitemap.xml');
    });

    // Copy robots.txt
    $('smQuickCopyRobotsBtn').addEventListener('click', () => {
        const ctx = window.sitemapPro ? window.sitemapPro.getLastContext() : null;
        const sitemapUrl = ctx && ctx.savedId && ctx.clientId
            ? `${location.origin}/sitemap.xml?clientId=${ctx.clientId}`
            : `${location.origin}/sitemap.xml`;
        const siteUrl = ctx && ctx.siteUrl ? ctx.siteUrl : location.origin;
        const robots = window.sitemapPro ? window.sitemapPro.buildRobotsTxt(siteUrl, sitemapUrl) : '';
        navigator.clipboard.writeText(robots).then(() => showToast('robots.txt copied!'));
    });

    // Copy public URL
    $('smQuickCopyPublicBtn').addEventListener('click', () => {
        const ctx = window.sitemapPro ? window.sitemapPro.getLastContext() : null;
        const url = ctx && ctx.clientId ? `${location.origin}/sitemap.xml?clientId=${ctx.clientId}` : `${location.origin}/sitemap.xml`;
        navigator.clipboard.writeText(url).then(() => showToast('Public URL copied!'));
    });

    // Validate
    $('smQuickValidateBtn').addEventListener('click', async () => {
        const ctx = window.sitemapPro ? window.sitemapPro.getLastContext() : null;
        if (!ctx || !ctx.savedId) { showToast('Save the sitemap first to validate.', 'error'); return; }
        try {
            const res = await fetch('/api/sitemap/validate', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: ctx.savedId })
            });
            const data = await res.json();
            if (!res.ok || !data.success) throw new Error(data.error || 'Validation failed');
            const v = data.validation;
            const msg = v.ok
                ? `✅ Sitemap passes Google spec checks (${v.summary.humanSize})`
                : `❌ ${v.errors.length} errors, ${v.warnings.length} warnings`;
            showToast(msg, v.ok ? 'success' : 'error');
        } catch (err) { showToast(err.message, 'error'); }
    });

    // Export
    $('smQuickExportBtn').addEventListener('click', async () => {
        const ctx = window.sitemapPro ? window.sitemapPro.getLastContext() : null;
        if (!ctx || !ctx.savedId) { showToast('Save the sitemap first to export.', 'error'); return; }
        const format = $('smQuickExportFormat').value;
        try {
            const res = await fetch('/api/sitemap/export', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: ctx.savedId, format })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Export failed');
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const ext = format === 'gz' ? 'xml.gz' : format;
            a.download = `sitemap-${ctx.savedId}.${ext}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            showToast(`Exported as ${format.toUpperCase()}`);
        } catch (err) { showToast(err.message, 'error'); }
    });

    // New crawl
    $('smQuickNewBtn').addEventListener('click', () => {
        qResult.style.display = 'none';
        qError.style.display  = 'none';
        qIdle.style.display   = '';
        quickXml = ''; quickUrls = [];
    });

    // ─── Client mode ──────────────────────────────────────
    async function loadClients() {
        try {
            const res  = await fetch('/api/clients');
            const data = await res.json();
            const clients = data.clients || data || [];
            cClientSel.innerHTML = '<option value="">– select a client –</option>';
            clients.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name + (c.website_url ? ` (${c.website_url})` : '');
                opt.dataset.url = c.website_url || '';
                cClientSel.appendChild(opt);
            });
        } catch { /* not logged in / no clients */ }
    }

    cClientSel.addEventListener('change', () => {
        const opt = cClientSel.selectedOptions[0];
        if (!opt || !opt.value) {
            $('smClientUrlGroup').style.display = 'none';
            historyCard.style.display = 'none';
            cIdle.style.display = '';
            cResult.style.display = 'none';
            cError.style.display  = 'none';
            return;
        }
        currentClientId = opt.value;
        $('smClientUrl').value = opt.dataset.url || '';
        $('smClientUrlGroup').style.display = '';
        historyCard.style.display = '';
        loadHistory(currentClientId);
    });

    cGenBtn.addEventListener('click', async () => {
        const opts = readClientOpts();
        if (!opts.clientId) { showToast('Select a client first.', 'error'); return; }
        if (!opts.startUrl) { showToast('Please enter a crawl URL.', 'error'); return; }

        cIdle.style.display    = 'none';
        cProgress.style.display = '';
        cResult.style.display  = 'none';
        cError.style.display   = 'none';
        cGenBtn.disabled = true;
        cProgressBar.style.width = '5%';
        cProgressLbl.textContent = 'Starting client crawl…';
        cProgressStats.textContent = '';

        // ── SSE progress stream ───────────────────────────────────────────────
        let sse = null;
        try {
            const progressUrl = new URL(opts.startUrl.startsWith('http') ? opts.startUrl : `https://${opts.startUrl}`);
            sse = new EventSource('/api/sitemap/progress?url=' + encodeURIComponent(progressUrl.href));
            sse.onmessage = (e) => {
                const d = JSON.parse(e.data);
                const percent = Math.min(100, Math.round((d.crawled / d.max) * 100));
                cProgressBar.style.width = Math.max(5, percent) + '%';
                cProgressLbl.textContent = `Crawling: ${d.currentUrl}`;
                cProgressStats.textContent = `${d.crawled} / ${d.max} pages`;
            };
        } catch(e) {}

        try {
            // Step 1: kick off the job (returns 202 + jobId in milliseconds)
            const res = await fetch('/api/sitemap/generate-client', {
                method:  'POST',
                headers: {'Content-Type': 'application/json'},
                body:    JSON.stringify(opts),
            });
            const kickoff = await res.json();
            if (!res.ok || !kickoff.success) throw new Error(kickoff.error || kickoff.message || 'Unknown error');

            const { jobId } = kickoff;
            cProgressLbl.textContent = 'Crawling pages…';

            // Step 2: poll /api/sitemap/job/:jobId until done
            const POLL_INTERVAL_MS = 3000;
            const MAX_POLLS = 400; // 20 min safety cap
            let polls = 0;
            const data = await new Promise((resolve, reject) => {
                const timer = setInterval(async () => {
                    polls++;
                    if (polls > MAX_POLLS) { clearInterval(timer); reject(new Error('Timed out waiting for crawl to finish.')); return; }
                    try {
                        const jr = await fetch(`/api/sitemap/job/${jobId}`);
                        const j  = await jr.json();
                        if (j.status === 'running') return; // still going
                        clearInterval(timer);
                        if (j.status === 'error' || !j.success) { reject(new Error(j.error || 'Crawl failed')); return; }
                        resolve(j);
                    } catch (e) { /* network blip — retry */ }
                }, POLL_INTERVAL_MS);
            });

            if (sse) sse.close();
            clientXml = data.xml;
            currentSavedId = data.savedId;
            renderClientResult(data);
            loadHistory(currentClientId);
            if (window.sitemapPro) {
                window.sitemapPro.setLastContext(currentClientId, data.savedId, opts.startUrl);
                window.sitemapPro.refreshAfterCrawl('client', data);
            }
        } catch (err) {
            if (sse) sse.close();
            $('smClientErrorTitle').textContent = 'Crawl failed';
            $('smClientErrorMsg').textContent   = err.message;
            cProgress.style.display = 'none';
            cError.style.display    = '';
            showToast(err.message, 'error');
        } finally {
            cGenBtn.disabled = false;
        }
    });

    function renderClientResult(data) {
        cProgress.style.display = 'none';
        cResult.style.display   = '';

        const total = (data.stats && data.stats.crawled) || 0;
        const skipped = (data.stats && data.stats.skipped) || 0;
        const durationMs = (data.stats && data.stats.durationMs) || 0;
        $('smClientResultTitle').textContent = `Sitemap ready – ${total.toLocaleString()} URL${total !== 1 ? 's' : ''}`;
        $('smClientResultSub').textContent   = `Crawled in ${(durationMs/1000).toFixed(1)}s · ${skipped} skipped`;

        const lines = clientXml.split('\n').slice(0, 1000).join('\n');
        $('smClientXmlPreview').textContent = lines + (clientXml.split('\n').length > 1000 ? '\n…(truncated)' : '');
    }

    $('smClientCopyBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(clientXml).then(() => showToast('XML copied!'));
    });
    $('smClientDownloadBtn').addEventListener('click', () => {
        downloadXml(clientXml, 'sitemap.xml');
    });
    $('smClientAuditBtn').addEventListener('click', () => {
        if (!currentClientId || !currentSavedId) return showToast('No saved crawl data found.', 'error');
        window.location.href = `/api/sitemap/audit/${currentClientId}/${currentSavedId}/download`;
    });
    $('smClientNewBtn').addEventListener('click', () => {
        cResult.style.display = 'none';
        cError.style.display  = 'none';
        cForm.style.display   = 'block';
        clientXml = '';
        currentSavedId = null;
    });

    // ─── History ──────────────────────────────────────────
    $('smHistoryRefreshBtn').addEventListener('click', () => {
        if (currentClientId) loadHistory(currentClientId);
    });

    async function loadHistory(clientId) {
        historyList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:16px;font-size:13px;">Loading…</p>';
        try {
            const res  = await fetch(`/api/sitemap/history/${clientId}`);
            const data = await res.json();
            const items = data.history || [];
            if (!items.length) {
                historyList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:16px;font-size:13px;">No history yet.</p>';
                return;
            }
            historyList.innerHTML = '';
            items.forEach(r => {
                const div = document.createElement('div');
                div.className = 'sitemap-history-item';
                div.innerHTML = `
                    <div class="sitemap-history-meta">
                        <span class="sitemap-history-url">${escHtml(r.site_url)}</span>
                        <span class="sitemap-history-sub">${r.total_urls} URLs · ${fmtDate(r.created_at)}</span>
                    </div>
                    <div class="sitemap-history-actions">
                        <button class="btn btn-sm btn-outline" onclick="smDownloadHistory('${r.id}', '${clientId}')"><i class="fas fa-download"></i> XML</button>
                        <button class="btn btn-sm btn-outline" onclick="smDownloadAudit('${r.id}', '${clientId}')"><i class="fas fa-file-csv"></i> CSV Audit</button>
                        <button class="btn btn-sm btn-outline" style="color:#ef4444;" onclick="smDeleteHistory('${r.id}', '${clientId}')"><i class="fas fa-trash"></i></button>
                    </div>`;
                historyList.appendChild(div);
            });
        } catch {
            historyList.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:16px;font-size:13px;">Failed to load history.</p>';
        }
    }

    // expose for inline handlers
    window.smDownloadHistory = async function (id, clientId) {
        try {
            const res  = await fetch(`/api/sitemap/history/${clientId}/${id}/download`);
            const text = await res.text();
            if (res.ok) {
                downloadXml(text, `sitemap_${id}.xml`);
            } else {
                let err = 'Download failed';
                try { const j = JSON.parse(text); if (j.error) err = j.error; } catch(e){}
                showToast(err, 'error');
            }
        } catch { showToast('Download failed', 'error'); }
    };

    window.smDownloadAudit = function (id, clientId) {
        window.location.href = `/api/sitemap/audit/${clientId}/${id}/download`;
    };

    window.smDeleteHistory = async function (id, clientId) {
        if (!confirm('Delete this sitemap generation record?')) return;
        try {
            await fetch(`/api/sitemap/history/${id}`, { method: 'DELETE' });
            loadHistory(clientId);
            showToast('Deleted.');
        } catch { showToast('Delete failed', 'error'); }
    };

    // ─── Utilities ────────────────────────────────────────
    function downloadXml(xml, filename) {
        const blob = new Blob([xml], { type: 'application/xml' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function escHtml(str) {
        return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ─── Wire up page entry ───────────────────────────────
    document.addEventListener('pageChanged', e => {
        if (e.detail?.page === 'sitemap') {
            switchTab('quick');
        }
    });

    // also handle via nav-item click pattern used by the app
    document.querySelectorAll('.nav-item[data-page="sitemap"]').forEach(el => {
        el.addEventListener('click', () => switchTab('quick'));
    });
})();
