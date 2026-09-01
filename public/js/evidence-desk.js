/**
 * Evidence Desk interaction layer.
 * Keeps provenance affordances local to the shell so feature modules do not
 * need to know how the evidence drawer or source states are rendered.
 */
(function initEvidenceDesk() {
    const drawer = document.getElementById('evidenceDrawer');
    const overlay = document.getElementById('evidenceDrawerOverlay');
    const closeButton = document.getElementById('closeEvidenceDrawer');
    const drawerBody = document.getElementById('evidenceDrawerBody');

    if (!drawer || !overlay) return;

    const drawerCopy = {
        workspace: {
            label: 'Workspace evidence',
            body: 'The overview uses records returned by this agency workspace. The counts are not estimates. If a source has no records, the interface keeps that gap visible.'
        },
        sources: {
            label: 'Collection rules',
            body: 'Measured values come from stored or connected sources. Derived values are labelled as proxies. A missing connection or stale sync is shown as not collected, never as zero.'
        },
        report: {
            label: 'Report evidence',
            body: 'A report draft should tell you which sources contributed, when they were last collected, and which sections are incomplete. Use the source coverage row before saving or sharing.'
        }
    };

    function openDrawer(kind) {
        const copy = drawerCopy[kind] || drawerCopy.workspace;
        const intro = drawerBody.querySelector('p');
        if (intro) intro.textContent = copy.body;
        drawer.querySelector('#evidenceDrawerTitle').textContent = copy.label;
        drawer.classList.add('is-open');
        overlay.classList.add('is-open');
        drawer.removeAttribute('inert');
        drawer.setAttribute('aria-hidden', 'false');
        overlay.setAttribute('aria-hidden', 'false');
        // inert main content while drawer open
        document.getElementById('main-content')?.setAttribute('inert', '');
        closeButton?.focus();
    }

    function closeDrawer() {
        drawer.classList.remove('is-open');
        overlay.classList.remove('is-open');
        drawer.setAttribute('aria-hidden', 'true');
        drawer.setAttribute('inert', '');
        overlay.setAttribute('aria-hidden', 'true');
        document.getElementById('main-content')?.removeAttribute('inert');
    }

    document.addEventListener('click', event => {
        const trigger = event.target.closest('[data-evidence-trigger]');
        if (trigger) openDrawer(trigger.dataset.evidenceTrigger);
    });
    closeButton?.addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
    });

    function setWorkspaceState(state, detail) {
        const health = document.getElementById('workspaceSourceHealth');
        const sourceState = document.getElementById('workspaceSourceState');
        const lastCheck = document.getElementById('overviewLastCheck');
        if (!health || !sourceState) return;

        const states = {
            loaded: { dot: 'ed-status-dot-green', label: 'Workspace data loaded', source: 'Measured now' },
            failed: { dot: 'ed-status-dot-amber', label: 'Load needs review', source: 'Could not verify' },
            pending: { dot: 'ed-status-dot-neutral', label: 'Waiting for data', source: 'Pending load' }
        };
        const current = states[state] || states.pending;
        health.innerHTML = `<span class="ed-status-dot ${current.dot}"></span> ${current.label}`;
        sourceState.textContent = detail || current.source;
        if (lastCheck && state === 'loaded') {
            try {
                lastCheck.textContent = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date());
            } catch {
                lastCheck.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }
        }
    }

    window.evidenceDesk = {
        markWorkspaceLoaded(detail) { setWorkspaceState('loaded', detail); },
        markWorkspaceFailed(detail) { setWorkspaceState('failed', detail); },
        markSourceHealth(health = {}) {
            const statusCopy = {
                fresh: { dot: 'ed-status-dot-green', label: 'Fresh source data' },
                stale: { dot: 'ed-status-dot-amber', label: 'Refresh needed' },
                failed: { dot: 'ed-status-dot-red', label: 'Provider failure' },
                missing: { dot: 'ed-status-dot-amber', label: 'Evidence gaps' },
                unavailable: { dot: 'ed-status-dot-red', label: 'Could not verify' },
                not_configured: { dot: 'ed-status-dot-neutral', label: 'Setup needed' },
            };
            const overall = statusCopy[health.overallStatus] || statusCopy.unavailable;
            const healthElement = document.getElementById('workspaceSourceHealth');
            if (healthElement) {
                const sources = Array.isArray(health.sources) ? health.sources : [];
                const trackedSources = sources.filter(source => source.status !== 'not_configured');
                const freshCount = trackedSources.filter(source => source.status === 'fresh').length;
                const total = trackedSources.length;
                const suffix = total ? ` · ${freshCount}/${total} fresh` : '';
                healthElement.innerHTML = `<span class="ed-status-dot ${overall.dot}"></span> ${overall.label}${suffix}`;
            }

            const sources = Array.isArray(health.sources) ? health.sources : [];
            const stateText = source => {
                if (!source) return 'Could not verify';
                if (source.status === 'fresh') return source.lastCollectedAt ? `Fresh · ${formatRelativeDate(source.lastCollectedAt)}` : 'Fresh';
                if (source.status === 'stale') return source.lastCollectedAt ? `Stale · ${formatRelativeDate(source.lastCollectedAt)}` : 'Stale';
                if (source.status === 'failed') return 'Latest run failed';
                if (source.status === 'not_configured') return 'Not connected';
                if (source.status === 'missing') return 'Not collected';
                return 'Could not verify';
            };
            const rowMap = {
                workspace: 'workspaceSourceState',
                rankings: 'rankTrackerSourceState',
                technical: 'technicalSourceState',
                pageSpeed: 'pageSpeedSourceState',
                gsc: 'connectedDataSourceState',
            };
            sources.forEach(source => {
                const element = document.getElementById(rowMap[source.key]);
                if (element && source.key !== 'ga4') element.textContent = stateText(source);
            });
            const connected = sources.filter(source => source.key === 'gsc' || source.key === 'ga4');
            const connectedElement = document.getElementById('connectedDataSourceState');
            if (connectedElement && connected.length) {
                const gsc = connected.find(source => source.key === 'gsc');
                const ga4 = connected.find(source => source.key === 'ga4');
                connectedElement.textContent = `${gsc ? `GSC ${stateText(gsc)}` : ''}${gsc && ga4 ? ' · ' : ''}${ga4 ? `GA4 ${stateText(ga4)}` : ''}`;
            }
        },
        markReportSources(report) {
            const provenance = report?.provenance || {};
            const sourceState = (key, fallback) => {
                const item = provenance[key];
                if (!item) return fallback;
                if (item.status === 'not_collected') return 'Not collected';
                if (item.status === 'proxy') return 'Proxy / labelled';
                if (item.lastCollectedAt) return `Collected ${formatRelativeDate(item.lastCollectedAt)}`;
                return 'Collected';
            };
            const states = {
                reportRankSourceState: sourceState('rankings', report?.summary?.trackedKeywords ? 'Collected' : 'Not collected'),
                reportTechnicalSourceState: sourceState('technical', report?.summary?.latestTechnicalScore != null ? 'Collected' : 'Not collected'),
                reportPageSpeedSourceState: sourceState('pageSpeed', report?.data?.pageSpeed ? 'Collected' : 'Not collected'),
                reportGscSourceState: sourceState('gsc', report?.data?.gsc ? 'Collected' : 'Not collected')
            };
            Object.entries(states).forEach(([id, value]) => {
                const element = document.getElementById(id);
                if (element) element.textContent = value;
            });
        }
    };

    function formatRelativeDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'recently';
        try {
            return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(date);
        } catch {
            return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        }
    }

    // Keep the approved display headlines stable as their containers resize.
    // This is the production equivalent of the Pretext resize contract for the
    // server-rendered app: content determines height, never a fixed crop.
    if ('ResizeObserver' in window) {
        const resize = new ResizeObserver(entries => {
            entries.forEach(({ target }) => {
                target.style.minHeight = '0';
                target.style.minHeight = `${target.scrollHeight}px`;
            });
        });
        document.querySelectorAll('[data-pretext]').forEach(element => resize.observe(element));
    }
})();
