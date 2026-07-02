/**
 * 🎯 Keyword Analyzer - Frontend App
 */

const API_BASE = '';

// ─── State ───
let currentPage = 'dashboard';
let currentKeyword = null;
let latestResearchData = null;
let latestResearchLocation = 'India';
const selectedRelatedKeywordKeys = new Set();
let humanizerAlternativesCache = [];
let humanizerHistoryCache = [];

let latestContentBrief = null;
let seoClientsCache = [];
let seoProjectsCache = [];

const PG = {
    competitors: { page: 1, perPage: 15, total: 0 },
    alerts:      { page: 1, perPage: 20, total: 0 },
    history:     { page: 1, perPage: 10, total: 0 },
    related:     { page: 1, perPage: 8, total: 0, data: [] },
};

// ─── DOM Elements ───
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ─── Breadcrumb Map ───
const breadcrumbMap = {
    dashboard: [{ icon: 'fa-home', label: 'Home' }, { label: 'Dashboard' }],
    clients: [{ icon: 'fa-home', label: 'Home' }, { label: 'Clients' }],
    'project-dashboard': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-briefcase', label: 'Clients' }, { label: 'Project Dashboard' }],
    research: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Keyword Research' }],
    competitors: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Competitors' }],
    analysis: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Compare & Analyze' }],
    tracking: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Rank Tracking' }],
    gsc: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Search Console' }],
    'seo-performance': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-chart-line', label: 'Analytics' }, { label: 'SEO Performance' }],
    'search-visibility': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-chart-line', label: 'Analytics' }, { label: 'Search Visibility' }],
    alerts: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-search', label: 'Research' }, { label: 'Alerts' }],
    onpage: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-spider', label: 'Audit' }, { label: 'On-Page SEO' }],
    'page-optimization': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-spider', label: 'Audit' }, { label: 'Page Optimization' }],
    'page-speed': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-spider', label: 'Audit' }, { label: 'PageSpeed' }],
    technical: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-spider', label: 'Audit' }, { label: 'Technical SEO' }],
    humanizer: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-pen-nib', label: 'Content' }, { label: 'Content Humanizer' }],
    'content-brief': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-pen-nib', label: 'Content' }, { label: 'Content Brief' }],
    reports: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-pen-nib', label: 'Content' }, { label: 'Agency Reports' }],
    tasks: [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-pen-nib', label: 'Content' }, { label: 'SEO Tasks' }],
    'agency-settings': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-building', label: 'Agency' }, { label: 'Agency Settings' }],
    'agency-members': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-building', label: 'Agency' }, { label: 'Team Members' }],
    'social-upload': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-share-nodes', label: 'Social' }, { label: 'Upload' }],
    'social-schedule': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-share-nodes', label: 'Social' }, { label: 'Schedule' }],
    'social-platforms': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-share-nodes', label: 'Social' }, { label: 'Platforms' }],
    'social-analytics': [{ icon: 'fa-home', label: 'Home' }, { icon: 'fa-share-nodes', label: 'Social' }, { label: 'Analytics' }],
};

// ─── Command Palette Pages ───
const commandPages = [
    { page: 'dashboard', title: 'Dashboard', desc: 'Overview stats and recent activity', icon: 'fa-chart-line' },
    { page: 'clients', title: 'Clients', desc: 'Manage SEO clients and projects', icon: 'fa-briefcase' },
    { page: 'project-dashboard', title: 'Project Dashboard', desc: 'Per-project SEO health overview', icon: 'fa-tachometer-alt' },
    { page: 'research', title: 'Keyword Research', desc: 'Research keywords with SERP data', icon: 'fa-search' },
    { page: 'competitors', title: 'Competitors', desc: 'View competing domains', icon: 'fa-users' },
    { page: 'analysis', title: 'Compare & Analyze', desc: 'Head-to-head domain comparison', icon: 'fa-balance-scale' },
    { page: 'tracking', title: 'Rank Tracking', desc: 'Track domain rankings over time', icon: 'fa-chart-bar' },
    { page: 'gsc', title: 'Search Console', desc: 'Google Search Console data', icon: 'fa-chart-column' },
    { page: 'seo-performance', title: 'SEO Performance', desc: 'GSC + GA4 combined insights', icon: 'fa-chart-line' },
    { page: 'search-visibility', title: 'Search Visibility', desc: 'Inspect URLs, submit sitemaps, and request discovery', icon: 'fa-magnifying-glass-chart' },
    { page: 'alerts', title: 'Alerts', desc: 'Rank changes and notifications', icon: 'fa-bell' },
    { page: 'onpage', title: 'On-Page SEO', desc: 'Analyze on-page SEO factors', icon: 'fa-file-invoice' },
    { page: 'page-optimization', title: 'Page Optimization', desc: 'Compare page vs top competitors', icon: 'fa-bullseye' },
    { page: 'page-speed', title: 'PageSpeed', desc: 'Core Web Vitals and performance', icon: 'fa-bolt' },
    { page: 'technical', title: 'Technical SEO', desc: 'Site-wide technical crawl', icon: 'fa-spider' },
    { page: 'humanizer', title: 'Content Humanizer', desc: 'AI content rewriting tool', icon: 'fa-pen-nib' },
    { page: 'content-brief', title: 'Content Brief', desc: 'AI-generated content briefs', icon: 'fa-file-lines' },
    { page: 'reports', title: 'Agency Reports', desc: 'Generate PDF-ready reports', icon: 'fa-file-pdf' },
    { page: 'tasks', title: 'SEO Tasks', desc: 'Kanban task board', icon: 'fa-tasks' },
    { page: 'agency-settings', title: 'Agency Settings', desc: 'Manage your agency profile and invites', icon: 'fa-building' },
    { page: 'agency-members', title: 'Team Members', desc: 'View and manage team members', icon: 'fa-user-group' },
    { page: 'social-upload', title: 'Upload Content', desc: 'Create social media posts', icon: 'fa-upload' },
    { page: 'social-schedule', title: 'Post Schedule', desc: 'View scheduled posts', icon: 'fa-calendar-alt' },
    { page: 'social-platforms', title: 'Social Platforms', desc: 'Connect social accounts', icon: 'fa-hashtag' },
    { page: 'social-analytics', title: 'Social Analytics', desc: 'Engagement statistics', icon: 'fa-chart-pie' },
];

// ─── Initialize ───
document.addEventListener('DOMContentLoaded', () => {
    initSidebarGroups();
    initSidebarCollapse();
    initCommandPalette();
    initDarkMode();
    initNavigation();
    initMobileSidebar();
    initBackToTop();
    initQuickActions();
    initCollapsibleSections();
    initWizards();
    initVoiceProfiles();
    initDiffModeToggler();
    initToneAdjusters();
    // Check for path on load for deep linking
    let pathPage = window.location.pathname.substring(1);
    if (pathPage === '') pathPage = 'dashboard';
    const validPages = commandPages.map(p => p.page).concat(['sitemap']); // Adding sitemap just in case
    
    if (pathPage && validPages.includes(pathPage)) {
        navigateTo(pathPage, true);
    } else {
        navigateTo('dashboard', true);
    }

    refreshAlertBadge();
    setInterval(refreshAlertBadge, 30000);
});

// ─── Wizards Init ───
function initWizards() {
    $$('.wizard-steps').forEach(stepsEl => {
        const container = stepsEl.closest('.card-body') || stepsEl.parentElement;
        initWizard(container);
    });
}

// ─── Collapsible Sections Init ───
function initCollapsibleSections() {
    $$('.collapsible-header').forEach(header => {
        initCollapsible(header);
    });
}

// ─── Sidebar Groups ───
function initSidebarGroups() {
    $$('.nav-group-header').forEach(header => {
        const group = header.closest('.nav-group');
        const items = group.querySelector('.nav-group-items');
        if (items) {
            items.style.maxHeight = items.scrollHeight + 'px';
        }
        header.addEventListener('click', () => {
            group.classList.toggle('collapsed');
            const items = group.querySelector('.nav-group-items');
            if (items) {
                if (group.classList.contains('collapsed')) {
                    items.style.maxHeight = '0px';
                } else {
                    items.style.maxHeight = items.scrollHeight + 'px';
                }
            }
        });
    });
}

// ─── Sidebar Collapse ───
// function initSidebarCollapse() {
//     const btn = $('#sidebarCollapseBtn');
//     const sidebar = $('.sidebar');
//     if (!btn || !sidebar) return;

//     const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
//     if (collapsed) sidebar.classList.add('collapsed');

//     btn.addEventListener('click', () => {
//         sidebar.classList.toggle('collapsed');
//         localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
//     });
// }
function initSidebarCollapse() {
    const btn = $('#sidebarCollapseBtn');
    const sidebar = $('.sidebar');

    const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (collapsed) sidebar.classList.add('collapsed');

    btn.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
    });
}

// ─── Mobile Sidebar ───
function initMobileSidebar() {
    const toggle = $('#menuToggle');
    const overlay = $('#sidebarOverlay');
    const sidebar = $('.sidebar');

    if (toggle) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('active');
            overlay.classList.toggle('active');
        });
    }

    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
        });
    }
}

// ─── Command Palette ───
function initCommandPalette() {
    const overlay = $('#commandPalette');
    const input = $('#commandPaletteInput');
    const results = $('#commandPaletteResults');
    const trigger = $('#commandPaletteTrigger');
    if (!overlay || !input || !results) return;

    let selectedIndex = 0;

    function openPalette() {
        overlay.classList.add('active');
        input.value = '';
        input.focus();
        selectedIndex = 0;
        renderCommands('');
    }

    function closePalette() {
        overlay.classList.remove('active');
        input.value = '';
    }

    function renderCommands(query) {
        const q = query.toLowerCase().trim();
        let filtered = commandPages;

        if (q) {
            filtered = commandPages.filter(p =>
                p.title.toLowerCase().includes(q) ||
                p.desc.toLowerCase().includes(q) ||
                p.page.toLowerCase().includes(q)
            );
        }

        if (filtered.length === 0) {
            results.innerHTML = '<div class="command-result-item" style="justify-content:center;color:#94a3b8;padding:24px;">No results found</div>';
            return;
        }

        results.innerHTML = filtered.map((p, i) => `
            <div class="command-result-item${i === selectedIndex ? ' active' : ''}" data-page="${p.page}" data-index="${i}">
                <div class="command-result-icon"><i class="fas ${p.icon}"></i></div>
                <div class="command-result-text">
                    <div class="command-result-title">${p.title}</div>
                    <div class="command-result-desc">${p.desc}</div>
                </div>
                <div class="command-result-hint">Enter</div>
            </div>
        `).join('');

        $$('.command-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const page = item.dataset.page;
                closePalette();
                navigateTo(page);
            });
        });
    }

    input.addEventListener('input', () => {
        selectedIndex = 0;
        renderCommands(input.value);
    });

    input.addEventListener('keydown', (e) => {
        const items = $$('.command-result-item[data-page]');
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelected(items);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            updateSelected(items);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = items[selectedIndex];
            if (selected) {
                closePalette();
                navigateTo(selected.dataset.page);
            }
        } else if (e.key === 'Escape') {
            closePalette();
        }
    });

    function updateSelected(items) {
        items.forEach((item, i) => {
            item.classList.toggle('active', i === selectedIndex);
        });
        const selected = items[selectedIndex];
        if (selected) selected.scrollIntoView({ block: 'nearest' });
    }

    // Open on trigger click
    if (trigger) {
        trigger.addEventListener('click', openPalette);
    }

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closePalette();
    });

    // Keyboard shortcut Ctrl+K / Cmd+K
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            if (overlay.classList.contains('active')) {
                closePalette();
            } else {
                openPalette();
            }
        }
        if (e.key === 'Escape' && overlay.classList.contains('active')) {
            closePalette();
        }
    });
}

// ─── Dark Mode ───
function initDarkMode() {
    const toggle = $('#themeToggle');
    const html = document.documentElement;
    const saved = localStorage.getItem('theme');

    if (saved === 'dark') {
        html.setAttribute('data-theme', 'dark');
        if (toggle) toggle.innerHTML = '<i class="fas fa-sun"></i>';
    }

    if (toggle) {
        toggle.addEventListener('click', () => {
            const isDark = html.getAttribute('data-theme') === 'dark';
            if (isDark) {
                html.removeAttribute('data-theme');
                toggle.innerHTML = '<i class="fas fa-moon"></i>';
                localStorage.setItem('theme', 'light');
            } else {
                html.setAttribute('data-theme', 'dark');
                toggle.innerHTML = '<i class="fas fa-sun"></i>';
                localStorage.setItem('theme', 'dark');
            }
        });
    }
}

// ─── Breadcrumbs ───
function updateBreadcrumbs(page) {
    const container = $('#breadcrumbs');
    if (!container) return;

    const crumbs = breadcrumbMap[page] || [{ icon: 'fa-home', label: 'Home' }];
    container.innerHTML = crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        const iconHtml = crumb.icon ? `<i class="fas ${crumb.icon}"></i>` : '';
        const sep = !isLast ? '<span class="breadcrumb-sep"><i class="fas fa-chevron-right"></i></span>' : '';
        return `<span class="breadcrumb-item">${iconHtml} ${crumb.label}</span>${sep}`;
    }).join('');
}

// ─── Alert Badge Polling via new /api/alerts/unread-count ───
async function refreshAlertBadge() {
    try {
        const res = await fetch(`${API_BASE}/api/alerts/unread-count`);
        const data = await res.json();
        const badge = $('#alertBadge');
        if (badge) {
            badge.textContent = data.count || 0;
            badge.style.display = data.count > 0 ? 'inline' : 'none';
        }
        // Also update dashboard stat if visible
        const stat = $('#activeAlerts');
        if (stat && currentPage === 'dashboard') stat.textContent = data.count || 0;
    } catch (e) { /* silent */ }
}

// ─── Navigation ───
function initNavigation() {
    $$('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const page = item.dataset.page;
            if (page) navigateTo(page);
        });
    });

    $$('.view-all').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            if (page) navigateTo(page);
        });
    });

    // Logout button handler
    $$('.logout-button').forEach(btn => {
        btn.addEventListener('click', () => {
            window.location.href = '/logout';
        });
    });

    // Handle back/forward buttons via History API
    window.addEventListener('popstate', () => {
        let pathPage = window.location.pathname.substring(1);
        if (pathPage === '') pathPage = 'dashboard';
        if (pathPage && pathPage !== currentPage) {
            navigateTo(pathPage, true);
        }
    });
}

function navigateTo(page, isPopState = false) {
    if (currentPage !== page) {
        currentPage = page;
        if (!isPopState) {
            window.history.pushState(null, '', '/' + page);
        }
    }
    
    // Update nav
    $$('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

    // Ensure parent group is expanded
    const activeItem = $(`.nav-item[data-page="${page}"]`);
    if (activeItem) {
        const group = activeItem.closest('.nav-group');
        if (group && group.classList.contains('collapsed')) {
            group.classList.remove('collapsed');
            const items = group.querySelector('.nav-group-items');
            if (items) items.style.maxHeight = items.scrollHeight + 'px';
        }
    }

    // Update page
    $$('.page').forEach(p => {
        p.classList.toggle('active', p.id === `page-${page}`);
    });

    // Update title
    const titles = {
        dashboard: 'Dashboard',
        clients: 'SEO Clients',
        'project-dashboard': 'Project SEO Dashboard',
        research: 'Keyword Research',
        competitors: 'Competitors',
        analysis: 'Compare & Analyze',
        tracking: 'Rank Tracking',
        alerts: 'Alerts',
        onpage: 'On-Page SEO Analyzer',
        'page-optimization': 'Page Optimization',
        'page-speed': 'PageSpeed',
        technical: 'Technical SEO Audit',
        gsc: 'Google Search Console',
        'seo-performance': 'SEO Performance',
        'search-visibility': 'Search Visibility',
        humanizer: 'Content Humanizer',
        'content-brief': 'Content Brief Generator',
        'social-upload': 'Upload Content',
        'social-schedule': 'Post Schedule',
        'social-platforms': 'Social Platforms',
        'social-analytics': 'Social Analytics',
        reports: 'Agency-Ready Reports',
        tasks: 'SEO Tasks Prioritization',
        'agency-settings': 'Agency Settings',
        'agency-members': 'Team Members'
    };

    $('#pageTitle').textContent = titles[page] || page;

    // Update breadcrumbs
    updateBreadcrumbs(page);

    // Close mobile sidebar
    const sidebar = $('.sidebar');
    const overlay = $('#sidebarOverlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');

    // Load page data
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'clients': loadClientWorkspace(); break;
        case 'project-dashboard': initProjectDashboard(); break;
        case 'research': loadResearchProjects(); break;
        case 'competitors': loadCompetitorProjectFilters().then(() => loadTopCompetitors()); break;
        case 'tracking': initRankTrackingPage(); break;
        case 'alerts': loadAlertProjectFilters().then(() => loadAlerts()); break;
        case 'onpage': break;
        case 'page-optimization': initPageOptimization(); break;
        case 'page-speed': break;
        case 'technical': break;
        case 'gsc': initGscPage(); break;
        case 'seo-performance': if (typeof initSeoPerformancePage === 'function') initSeoPerformancePage(); break;
        case 'search-visibility': if (typeof initSearchVisibilityPage === 'function') initSearchVisibilityPage(); break;
        case 'humanizer': loadHumanizerHistory(); break;
        case 'content-brief': if (typeof initContentBriefPage === 'function') initContentBriefPage(); break;
        case 'reports': if (typeof loadSavedReports === 'function') loadSavedReports(); break;
        case 'tasks': if (typeof initTasksPage === 'function') initTasksPage(); break;
        case 'agency-settings': if (typeof loadAgencySettingsPage === 'function') loadAgencySettingsPage(); break;
        case 'agency-members': if (typeof loadAgencyMembersPage === 'function') loadAgencyMembersPage(); break;
        case 'social-upload':
            $('#iframe-social-upload').src = $('#iframe-social-upload').dataset.src;
            break;
        case 'social-schedule': 
            $('#iframe-social-schedule').src = $('#iframe-social-schedule').dataset.src;
            break;
        case 'social-platforms':
            $('#iframe-social-platforms').src = $('#iframe-social-platforms').dataset.src;
            break;
        case 'social-analytics':
            $('#iframe-social-analytics').src = $('#iframe-social-analytics').dataset.src;
            break;
    }

}

// ─── Quick Action Handlers ───
function initQuickActions() {
    $$('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const page = btn.dataset.page;
            if (page) navigateTo(page);
        });
    });
}

// ─── Back to Top ───
function initBackToTop() {
    const btn = $('#backToTop');
    if (!btn) return;

    const content = $('.content');
    if (content) {
        content.addEventListener('scroll', () => {
            btn.classList.toggle('visible', content.scrollTop > 300);
        });
    }

    window.addEventListener('scroll', () => {
        btn.classList.toggle('visible', window.scrollY > 300);
    });

    btn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (content) content.scrollTo({ top: 0, behavior: 'smooth' });
    });
}

// ─── Skeleton Loaders ───
function showSkeleton(container, count = 3) {
    if (!container) return;
    const skeletons = Array.from({ length: count }, () =>
        '<div class="skeleton skeleton-stat"></div>'
    ).join('');
    container.innerHTML = `<div class="stats-grid">${skeletons}</div>`;
}

function showTableSkeleton(tbody, cols, rows = 5) {
    if (!tbody) return;
    const skeletonRows = Array.from({ length: rows }, () => {
        const cells = Array.from({ length: cols }, () =>
            '<td><div class="skeleton skeleton-text"></div></td>'
        ).join('');
        return `<tr>${cells}</tr>`;
    }).join('');
    tbody.innerHTML = skeletonRows;
}

// ─── Table Sorting ───
function initTableSorting(table) {
    if (!table || table.classList.contains('sortable')) return;
    table.classList.add('sortable');

    const headers = table.querySelectorAll('th');
    headers.forEach((th, colIndex) => {
        th.addEventListener('click', () => {
            const tbody = table.querySelector('tbody');
            if (!tbody) return;

            const rows = Array.from(tbody.querySelectorAll('tr'));
            const isAsc = th.classList.contains('sort-asc');
            const isDesc = th.classList.contains('sort-desc');

            // Clear other sort indicators
            headers.forEach(h => h.classList.remove('sort-asc', 'sort-desc'));

            // Determine sort direction
            let direction = 'asc';
            if (isAsc) direction = 'desc';
            else if (isDesc) direction = 'none';

            if (direction === 'none') {
                // Reset to original order
                rows.sort((a, b) => {
                    const aIdx = parseInt(a.dataset.originalIndex || 0);
                    const bIdx = parseInt(b.dataset.originalIndex || 0);
                    return aIdx - bIdx;
                });
            } else {
                th.classList.add(direction === 'asc' ? 'sort-asc' : 'sort-desc');

                // Store original indices
                rows.forEach((row, i) => {
                    if (!row.dataset.originalIndex) row.dataset.originalIndex = i;
                });

                rows.sort((a, b) => {
                    const aCell = a.cells[colIndex];
                    const bCell = b.cells[colIndex];
                    if (!aCell || !bCell) return 0;

                    const aVal = aCell.textContent.trim();
                    const bVal = bCell.textContent.trim();

                    // Try numeric sort
                    const aNum = parseFloat(aVal.replace(/[^0-9.-]/g, ''));
                    const bNum = parseFloat(bVal.replace(/[^0-9.-]/g, ''));

                    if (!isNaN(aNum) && !isNaN(bNum)) {
                        return direction === 'asc' ? aNum - bNum : bNum - aNum;
                    }

                    // String sort
                    return direction === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                });
            }

            // Re-append sorted rows
            rows.forEach(row => tbody.appendChild(row));
        });
    });
}

// ─── Table Filter ───
function initTableFilter(input, table) {
    if (!input || !table) return;

    input.addEventListener('input', () => {
        const query = input.value.toLowerCase().trim();
        const rows = table.querySelectorAll('tbody tr');

        rows.forEach(row => {
            const text = row.textContent.toLowerCase();
            row.style.display = query && !text.includes(query) ? 'none' : '';
        });
    });
}

// ─── Empty State Helper ───
function renderEmptyState(container, icon, title, message) {
    if (!container) return;
    container.innerHTML = `
        <div class="table-empty">
            <i class="fas ${icon}"></i>
            <h4>${title}</h4>
            <p>${message}</p>
        </div>
    `;
}

// ─── Form Validation ───
function initFormValidation(form) {
    if (!form) return;

    const inputs = form.querySelectorAll('input[required], select[required], textarea[required]');
    inputs.forEach(input => {
        const group = input.closest('.form-group');
        if (!group) return;

        // Create error element if not exists
        let errorEl = group.querySelector('.field-error');
        if (!errorEl) {
            errorEl = document.createElement('div');
            errorEl.className = 'field-error';
            errorEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> <span></span>';
            input.parentNode.appendChild(errorEl);
        }

        input.addEventListener('blur', () => validateField(input, group, errorEl));
        input.addEventListener('input', () => {
            if (group.classList.contains('has-error')) {
                validateField(input, group, errorEl);
            }
        });
    });

    form.addEventListener('submit', (e) => {
        let valid = true;
        inputs.forEach(input => {
            const group = input.closest('.form-group');
            const errorEl = group?.querySelector('.field-error');
            if (!validateField(input, group, errorEl)) valid = false;
        });
        if (!valid) e.preventDefault();
    });
}

function validateField(input, group, errorEl) {
    const value = input.value.trim();
    const span = errorEl?.querySelector('span');
    let error = '';

    if (input.required && !value) {
        error = 'This field is required';
    } else if (input.type === 'url' && value && !isValidUrl(value)) {
        error = 'Please enter a valid URL';
    } else if (input.type === 'email' && value && !isValidEmail(value)) {
        error = 'Please enter a valid email';
    }

    if (error) {
        group?.classList.add('has-error');
        if (span) span.textContent = error;
        return false;
    } else {
        group?.classList.remove('has-error');
        return true;
    }
}

function isValidUrl(str) {
    try {
        new URL(str.startsWith('http') ? str : `https://${str}`);
        return true;
    } catch { return false; }
}

function isValidEmail(str) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

// ─── Collapsible Sections ───
function initCollapsible(header) {
    if (!header) return;
    const body = header.nextElementSibling;
    if (!body || !body.classList.contains('collapsible-body')) return;

    header.addEventListener('click', () => {
        header.classList.toggle('open');
        body.classList.toggle('open');
    });
}

// ─── Multi-Step Wizard ───
function initWizard(container) {
    if (!container) return;
    const steps = container.querySelectorAll('.wizard-step');
    const panels = container.querySelectorAll('.wizard-panel');
    const nextBtns = container.querySelectorAll('.wizard-next');
    const prevBtns = container.querySelectorAll('.wizard-prev');

    function goToStep(num) {
        steps.forEach(s => {
            const stepNum = parseInt(s.dataset.step);
            s.classList.toggle('active', stepNum === num);
            s.classList.toggle('completed', stepNum < num);
        });
        panels.forEach(p => {
            p.classList.toggle('active', parseInt(p.dataset.panel) === num);
        });
    }

    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const next = parseInt(btn.dataset.next);
            // Validate current step fields
            const currentPanel = container.querySelector('.wizard-panel.active');
            const requiredInputs = currentPanel.querySelectorAll('input[required]');
            let valid = true;
            requiredInputs.forEach(input => {
                const group = input.closest('.form-group');
                const errorEl = group?.querySelector('.field-error');
                if (!validateField(input, group, errorEl)) valid = false;
            });
            if (valid) goToStep(next);
        });
    });

    prevBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            goToStep(parseInt(btn.dataset.prev));
        });
    });

    // Click on step labels to navigate (only to completed steps)
    steps.forEach(s => {
        s.addEventListener('click', () => {
            const stepNum = parseInt(s.dataset.step);
            if (s.classList.contains('completed')) goToStep(stepNum);
        });
    });

    // Initialize step lines
    const lines = container.querySelectorAll('.wizard-step-line');
    function updateLines() {
        lines.forEach((line, i) => {
            const prevStep = steps[i];
            line.style.background = prevStep?.classList.contains('completed') ? 'var(--secondary)' : 'var(--gray-light)';
        });
    }

    // Override goToStep to include line updates
    const origGoToStep = goToStep;
    window._wizardGoToStep = (num) => {
        origGoToStep(num);
        updateLines();
    };

    // Re-bind to use updated function
    nextBtns.forEach(btn => {
        btn.addEventListener('click', () => updateLines());
    });
    prevBtns.forEach(btn => {
        btn.addEventListener('click', () => updateLines());
    });
}

// ─── Alert Filter with Counts ───
function initAlertFilters(container, alerts) {
    if (!container) return;
    const buttons = container.querySelectorAll('.filter-btn');

    const counts = { all: alerts.length };
    alerts.forEach(a => {
        const type = a.alert_type || 'other';
        counts[type] = (counts[type] || 0) + 1;
    });

    buttons.forEach(btn => {
        const filter = btn.dataset.filter;
        const count = counts[filter] || 0;
        const baseText = btn.textContent.trim().replace(/\d+$/, '').trim();
        btn.innerHTML = `${baseText} <span class="filter-count">${count}</span>`;
    });
}

// ─── Error State Rendering ───
function renderErrorState(container, options = {}) {
    if (!container) return;
    const {
        icon = 'fa-exclamation-triangle',
        title = 'Something went wrong',
        message = 'An unexpected error occurred. Please try again.',
        detail = '',
        retryFn = null,
    } = options;

    const detailHtml = detail ? `<div class="error-detail">${escapeHtml(detail)}</div>` : '';
    const retryHtml = retryFn
        ? `<button class="btn-retry" onclick="(${retryFn.toString()})()"><i class="fas fa-rotate-right"></i> Try Again</button>`
        : '';

    container.innerHTML = `
        <div class="error-state">
            <div class="error-state-icon"><i class="fas ${icon}"></i></div>
            <h4>${title}</h4>
            <p>${message}</p>
            ${detailHtml}
            ${retryHtml}
        </div>
    `;
}

function renderInlineError(container, options = {}) {
    if (!container) return;
    const {
        message = 'Failed to load data',
        hint = 'Check your connection and try again',
        retryFn = null,
    } = options;

    const retryHtml = retryFn
        ? `<button class="btn-retry-sm" data-retry-id="${Date.now()}"><i class="fas fa-rotate-right"></i> Retry</button>`
        : '';

    container.innerHTML = `
        <div class="inline-error">
            <i class="fas fa-circle-exclamation"></i>
            <div class="inline-error-text">
                <div class="error-msg">${escapeHtml(message)}</div>
                <div class="error-hint">${escapeHtml(hint)}</div>
            </div>
            ${retryHtml}
        </div>
    `;

    if (retryFn) {
        const btn = container.querySelector('.btn-retry-sm');
        if (btn) btn.addEventListener('click', retryFn);
    }
}

function wrapWithErrorHandling(fn, container, options = {}) {
    return async function(...args) {
        try {
            return await fn.apply(this, args);
        } catch (err) {
            console.error(err);
            if (container) {
                renderInlineError(container, {
                    message: options.message || 'Failed to load data',
                    hint: err.message || 'Check your connection and try again',
                    retryFn: () => {
                        container.innerHTML = '<div class="inline-spinner"><div class="spinner-dot"></div> Loading...</div>';
                        wrapWithErrorHandling(fn, container, options).apply(this, args);
                    },
                });
            }
        }
    };
}

// ─── Content Humanizer ───
$('#humanizeBtn')?.addEventListener('click', async () => {
    const text = $('#humanizerInput')?.value.trim();
    const mode = $('#humanizerMode')?.value || 'standard';
    const tone = $('#humanizerTone')?.value || 'natural';
    const audience = $('#humanizerAudience')?.value.trim() || '';
    const brandVoice = $('#humanizerVoice')?.value.trim() || '';
    const preserveKeywords = $('#humanizerKeywords')?.value.trim() || '';
    const primaryKeyword = mode === 'seo-blog' ? ($('#humanizerPrimaryKeyword')?.value.trim() || '') : '';
    const relatedKeywords = mode === 'seo-blog' ? ($('#humanizerRelatedKeywords')?.value.trim() || '') : '';
    const preserveHtml = $('#humanizerPreserveHtml')?.checked || false;
    const maxChange = $('#humanizerMaxChange')?.value || 'balanced';
    const sample = $('#humanizerSample')?.value.trim() || '';

    if (!text || text.length < 30) {
        showError('Please paste at least a short paragraph to humanize.');
        return;
    }

    try {
        const data = await api('/api/content/humanize', {
            method: 'POST',
            body: JSON.stringify({
                text,
                mode,
                tone,
                audience,
                brandVoice,
                preserveKeywords,
                primaryKeyword,
                relatedKeywords,
                preserveHtml,
                maxChange,
                sample,
            }),
        });

        if (!data.success && !data.ok) {
            showError(data.error || 'Humanizer failed.');
            return;
        }

        renderHumanizerResult(data.result);
        loadHumanizerHistory();
        showSuccess('Content refined successfully.');
    } catch (err) {
        console.error('Humanizer failed:', err);
        showError('Could not humanize content right now.');
    }
});

$('#refreshHumanizerHistoryBtn')?.addEventListener('click', () => {
    loadHumanizerHistory();
});

$('#humanizerMode')?.addEventListener('change', () => {
    toggleHumanizerModeFields();
});

$('#copyHumanizedBtn')?.addEventListener('click', async () => {
    const output = $('#humanizerOutput');
    if (!output?.value) return;

    try {
        await navigator.clipboard.writeText(output.value);
        showSuccess('Refined copy copied to clipboard.');
    } catch (err) {
        showError('Could not copy text.');
    }
});

function renderHumanizerResult(result) {
    humanizerAlternativesCache = result.alternatives || [];
    $('#humanizerResults').style.display = 'block';
    $('#humanizerOriginalScore').textContent = `${result.originalAnalysis?.estimatedAiDetectionPercent ?? 0}%`;
    $('#humanizerRefinedScore').textContent = `${result.refinedAnalysis?.estimatedAiDetectionPercent ?? 0}%`;
    $('#humanizerReadability').textContent = `${capitalize(result.refinedAnalysis?.readability?.label || 'unknown')} (${result.refinedAnalysis?.readability?.score || 0})`;
    $('#humanizerWarningsCount').textContent = result.verification?.warnings?.length || 0;
    $('#humanizerSummary').textContent = result.summary || '';
    $('#humanizerOutput').value = result.refinedText || '';

    if ($('#humanizerDiffContainer').style.display === 'block') {
        renderDiffView();
    }

    const changes = result.changes || [];
    $('#humanizerChanges').innerHTML = changes.length
        ? changes.map(change => `<span class="tag tag-outline">${escapeHtml(change)}</span>`).join('')
        : '<span class="text-muted">No structured change notes returned.</span>';

    const warnings = result.verification?.warnings || [];
    $('#humanizerWarnings').innerHTML = warnings.length
        ? warnings.map(message => `<div class="recommendation-item warning" style="margin-bottom:10px;"><i class="fas fa-shield-alt"></i><span>${escapeHtml(message)}</span></div>`).join('')
        : '<div class="recommendation-item" style="background:#ecfdf5;color:#065f46;"><i class="fas fa-check-circle"></i><span>No preservation warnings detected.</span></div>';

    const alternatives = humanizerAlternativesCache;
    $('#humanizerAlternatives').innerHTML = alternatives.length
        ? alternatives.map((option, index) => `
            <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;">
                    <strong>${escapeHtml(capitalize(option.label))}</strong>
                    <button class="btn btn-sm btn-outline humanizer-alt-btn" data-alt-index="${index}">
                        Use this
                    </button>
                </div>
                <div style="white-space:pre-wrap;color:#4b5563;line-height:1.7;">${escapeHtml(option.text)}</div>
            </div>
        `).join('')
        : '<p class="text-muted">No alternatives returned for this rewrite.</p>';

    $$('.humanizer-alt-btn').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.altIndex);
            applyAlternativeHumanizerText(index);
        });
    });
}

function applyAlternativeHumanizerText(index) {
    const option = humanizerAlternativesCache[index];
    if (!option) return;
    $('#humanizerOutput').value = option.text;
    showSuccess('Alternative loaded into the output box.');
}

function toggleHumanizerModeFields() {
    const mode = $('#humanizerMode')?.value || 'standard';
    const seoFields = $('#seoBlogFields');
    if (!seoFields) return;
    seoFields.style.display = mode === 'seo-blog' ? 'block' : 'none';
}

async function loadHumanizerHistory() {
    const container = $('#humanizerHistoryList');
    if (!container) return;

    try {
        const data = await api('/api/content/history?limit=8');
        humanizerHistoryCache = data.history || [];
        renderHumanizerHistory(humanizerHistoryCache);
    } catch (err) {
        console.error('Failed to load humanizer history:', err);
        container.innerHTML = '<p class="text-muted">Could not load rewrite history.</p>';
    }
}

function renderHumanizerHistory(history) {
    const container = $('#humanizerHistoryList');
    if (!container) return;

    if (!history.length) {
        container.innerHTML = '<p class="text-muted">No saved rewrites yet.</p>';
        return;
    }

    container.innerHTML = history.map((item, index) => `
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px;">
                <div>
                    <div style="font-weight:600;color:#111827;">${escapeHtml(item.summary || 'Saved rewrite')}</div>
                    <div style="font-size:0.9rem;color:#6b7280;margin-top:4px;">${escapeHtml(item.mode || 'standard')} · ${escapeHtml(item.tone || 'natural')} · ${formatTimeAgo(item.created_at)}</div>
                </div>
                <button class="btn btn-sm btn-outline humanizer-history-load-btn" data-history-index="${index}">
                    Load
                </button>
            </div>
            <div style="color:#4b5563;line-height:1.6;">${escapeHtml(truncate(item.input_text || '', 180))}</div>
        </div>
    `).join('');

    $$('.humanizer-history-load-btn').forEach(button => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.historyIndex);
            loadHumanizerHistoryItem(index);
        });
    });
}

function loadHumanizerHistoryItem(index) {
    const item = humanizerHistoryCache[index];
    if (!item) return;

    $('#humanizerInput').value = item.input_text || '';
    $('#humanizerOutput').value = item.output_text || '';
    $('#humanizerMode').value = item.mode || 'standard';
    toggleHumanizerModeFields();
    $('#humanizerTone').value = item.tone || 'natural';
    $('#humanizerAudience').value = item.audience || '';
    $('#humanizerVoice').value = item.brand_voice || '';
    $('#humanizerKeywords').value = Array.isArray(item.preserve_keywords)
        ? item.preserve_keywords.join(', ')
        : '';
    $('#humanizerPrimaryKeyword').value = item.primary_keyword || '';
    $('#humanizerRelatedKeywords').value = Array.isArray(item.related_keywords)
        ? item.related_keywords.join(', ')
        : '';
    $('#humanizerPreserveHtml').checked = Boolean(item.preserve_html);
    $('#humanizerMaxChange').value = item.max_change || 'balanced';
    $('#humanizerSummary').textContent = item.summary || 'Loaded from history';
    $('#humanizerChanges').innerHTML = '<span class="text-muted">Loaded from saved history.</span>';
    $('#humanizerWarnings').innerHTML = '<div class="recommendation-item" style="background:#eff6ff;color:#1d4ed8;"><i class="fas fa-clock-rotate-left"></i><span>Loaded a previous rewrite result.</span></div>';
    $('#humanizerResults').style.display = 'block';
    showSuccess('Loaded rewrite from history.');
}

toggleHumanizerModeFields();

// ─── API Helper ───
async function api(endpoint, options = {}) {
    showLoading();
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        const data = await response.json();
        hideLoading();
        return data;
    } catch (err) {
        hideLoading();
        console.error('API Error:', err);
        showError(err.message);
        throw err;
    }
}

// ─── Dashboard ───
async function loadDashboard() {
    try {
        // Load stats from dedicated endpoint
        const stats = await api('/api/stats');
        $('#totalKeywords').textContent = stats.totalKeywords || 0;
        $('#totalCompetitors').textContent = stats.totalCompetitors || 0;
        $('#activeAlerts').textContent = stats.unreadAlerts || 0;
        $('#topRankings').textContent = stats.topRankings || 0;

        const clientStats = await api('/api/clients/stats');
        $('#totalClients').textContent = clientStats.clients || 0;
        $('#totalProjects').textContent = clientStats.projects || 0;

        // Load recent keywords
        const keywordsData = await api('/api/keywords?limit=5');
        renderRecentKeywords(keywordsData.keywords || []);

        // Load recent alerts
        const alertsData = await api('/api/alerts?limit=5');
        renderRecentAlerts(alertsData.alerts || []);

        // Load onboarding checklist
        loadOnboardingChecklist();

    } catch (err) {
        console.error('Dashboard load failed:', err);
        // Show error states
        const statIds = ['totalKeywords', 'activeAlerts', 'totalCompetitors', 'topRankings', 'totalClients', 'totalProjects'];
        statIds.forEach(id => {
            const el = $(`#${id}`);
            if (el) el.textContent = '-';
        });

        // Show inline error in recent keywords table
        const keywordsCard = $('#recentKeywordsTable')?.closest('.card-body');
        if (keywordsCard) {
            renderInlineError(keywordsCard, {
                message: 'Failed to load recent keywords',
                hint: err.message || 'Check your connection and try again',
                retryFn: () => loadDashboard(),
            });
        }

        // Show inline error in recent alerts
        const alertsCard = $('#recentAlertsList')?.closest('.card-body');
        if (alertsCard) {
            renderInlineError(alertsCard, {
                message: 'Failed to load recent alerts',
                hint: err.message || 'Check your connection and try again',
                retryFn: () => loadDashboard(),
            });
        }
    }
}

function renderRecentKeywords(keywords) {
    const tbody = $('#recentKeywordsTable tbody');
    if (!keywords.length) {
        tbody.innerHTML = '<tr><td colspan="4"><div class="table-empty"><i class="fas fa-key"></i><h4>No keywords yet</h4><p>Start with keyword research to see data here.</p></div></td></tr>';
        return;
    }

    tbody.innerHTML = keywords.map(kw => `
        <tr>
            <td><strong>${kw.keyword}</strong></td>
            <td>${formatNumber(kw.search_volume)}</td>
            <td><span class="badge badge-${kw.competition}">${kw.competition}</span></td>
            <td>
                <div class="progress-bar">
                    <div class="progress" style="width: ${kw.difficulty}%"></div>
                </div>
                ${kw.difficulty}%
            </td>
        </tr>
    `).join('');

    initTableSorting($('#recentKeywordsTable'));
}

function renderRecentAlerts(alerts) {
    const container = $('#recentAlertsList');
    if (!alerts.length) {
        container.innerHTML = '<p class="text-center text-muted">No alerts yet</p>';
        return;
    }

    container.innerHTML = alerts.map(alert => `
        <div class="alert-item ${alert.is_read ? '' : 'unread'}">
            <div class="alert-icon ${getAlertIconClass(alert.alert_type)}">
                <i class="fas ${getAlertIcon(alert.alert_type)}"></i>
            </div>
            <div class="alert-content">
                <div class="alert-message">${alert.message}</div>
                <div class="alert-time">${formatTimeAgo(alert.created_at)}</div>
            </div>
        </div>
    `).join('');
}

// ─── Onboarding Checklist ───
async function loadOnboardingChecklist() {
    const container = document.getElementById('onboardingChecklist');
    if (!container) return;

    try {
        const status = await api('/api/agency/onboarding-status');
        if (status.dismissed) {
            container.style.display = 'none';
            return;
        }

        const items = [
            { done: !status.isDefaultName, label: 'Name your agency', page: 'agency-settings' },
            { done: status.clientCount > 0, label: 'Add your first client', page: 'clients' },
            { done: status.keywordCount > 0, label: 'Run keyword research', page: 'research' },
            { done: status.memberCount > 1, label: 'Invite a team member', page: 'agency-settings' },
        ];

        const allDone = items.every(i => i.done);
        if (allDone) {
            container.style.display = 'none';
            return;
        }

        const itemsHtml = items.map(item => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 0;">
                <span style="width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;
                    ${item.done ? 'background:#dcfce7;color:#059669;' : 'background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;'}">
                    ${item.done ? '✓' : ''}
                </span>
                <a href="#" data-page="${item.page}" class="checklist-link"
                    style="${item.done ? 'text-decoration:line-through;color:#94a3b8;' : 'color:#0f172a;font-weight:600;'}font-size:13px;text-decoration:none;">
                    ${item.label}
                </a>
            </div>
        `).join('');

        const itemsDiv = document.getElementById('checklistItems');
        if (itemsDiv) itemsDiv.innerHTML = itemsHtml;
        container.style.display = 'block';

        container.querySelectorAll('.checklist-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                if (page) navigateTo(page);
            });
        });
    } catch (err) {
        container.style.display = 'none';
    }
}

const dismissBtn = document.getElementById('dismissOnboarding');
if (dismissBtn) {
    dismissBtn.addEventListener('click', async () => {
        try {
            await fetch('/api/agency/onboarding/dismiss', { method: 'POST' });
            const container = document.getElementById('onboardingChecklist');
            if (container) container.style.display = 'none';
        } catch (_) {}
    });
}

// ─── Location Cascading ───
const AREAS = {
    'Bangalore': ['Whitefield', 'Marathahalli', 'Koramangala', 'HSR Layout', 'Indiranagar', 'Jayanagar', 'Electronic City', 'MG Road', 'BTM Layout', 'JP Nagar', 'Banashankari', 'Malleshwaram', 'Hebbal', 'Yelahanka', 'Hennur', 'K.R. Puram'],
    'Mumbai': ['Andheri', 'Bandra', 'Juhu', 'Powai', 'Malad', 'Goregaon', 'Thane', 'Navi Mumbai'],
    'Delhi': ['Gurgaon', 'Noida', 'Dwarka', 'Saket', 'Lajpat Nagar', 'Rohini', 'Janakpuri', 'Connaught Place'],
    'Hyderabad': ['Gachibowli', 'Hitech City', 'Kukatpally', 'Jubilee Hills', 'Banjara Hills'],
};

$('#countryInput')?.addEventListener('change', function() {
    const country = this.value;
    const citySelect = $('#cityInput');
    const areaGroup = $('#areaGroup');
    
    if (country === 'India') {
        $('#cityGroup').style.display = 'block';
        citySelect.innerHTML = `
            <option value="">All India</option>
            <option value="Bangalore">Bangalore</option>
            <option value="Mumbai">Mumbai</option>
            <option value="Delhi">Delhi</option>
            <option value="Chennai">Chennai</option>
            <option value="Hyderabad">Hyderabad</option>
            <option value="Pune">Pune</option>
            <option value="Kolkata">Kolkata</option>
            <option value="Ahmedabad">Ahmedabad</option>
            <option value="Jaipur">Jaipur</option>
            <option value="Kochi">Kochi</option>
        `;
    } else {
        $('#cityGroup').style.display = 'none';
        $('#areaGroup').style.display = 'none';
    }
});

$('#cityInput')?.addEventListener('change', function() {
    const city = this.value;
    const areaSelect = $('#areaInput');
    const areaGroup = $('#areaGroup');
    
    if (city && AREAS[city]) {
        areaGroup.style.display = 'block';
        areaSelect.innerHTML = `<option value="">All ${city}</option>` + 
            AREAS[city].map(area => `<option value="${area}">${area}</option>`).join('');
    } else {
        areaGroup.style.display = 'none';
    }
});

// ─── Keyword Research ───
function getResearchLocationInput() {
    let location = $('#countryInput')?.value || 'India';
    const city = $('#cityInput')?.value;
    const area = $('#areaInput')?.value;

    if (city && city !== '') location = city;
    if (area && area !== '') location = `${area}, ${city}`;
    return location;
}

function keywordSelectionKey(keyword) {
    return String(keyword || '').trim().toLowerCase();
}

$('#researchBtn')?.addEventListener('click', async () => {
    const keyword = $('#keywordInput').value.trim();
    const location = getResearchLocationInput();

    if (!keyword) {
        showError('Please enter a keyword');
        return;
    }

    // Get options
    const projectId = $('#researchProjectSelect')?.value || '';

    const options = {
        projectId: projectId || undefined,
        includeIntent: $('#includeIntent')?.checked ?? true,
        includeSerpFeatures: $('#includeSerpFeatures')?.checked ?? true,
        includeContentGap: $('#includeContentGap')?.checked ?? true,
        includeCompetitorAnalysis: true,
        numResults: 20,
    };

    try {
        const data = await api('/api/keywords/advanced-research', {
            method: 'POST',
            body: JSON.stringify({ keyword, location, ...options }),
        });

        currentKeyword = data.keyword;
        latestResearchLocation = location;
        latestResearchData = data;
        selectedRelatedKeywordKeys.clear();
        renderAdvancedResearchResults(data);
    } catch (err) {
        console.error('Research failed:', err);
        showError('Research failed. Please try again.');
    }
});

function renderAdvancedResearchResults(data) {
    $('#researchResults').style.display = 'block';

    // Safety check for data
    if (!data || !data.metrics) {
        console.error('Invalid data received:', data);
        showError('Failed to load research data. Please try again.');
        return;
    }

    // Metrics
    $('#searchVolume').textContent = formatNumber(data.metrics.searchVolume || 0);
    $('#opportunityScore').textContent = (data.metrics.opportunityScore || 0) + '/100';
    $('#opportunityScore').style.color = data.metrics.opportunityScore >= 70 ? '#10b981' : data.metrics.opportunityScore >= 40 ? '#f59e0b' : '#ef4444';
    
    const compClass = data.metrics.competition === 'high' ? 'danger' : data.metrics.competition === 'medium' ? 'warning' : 'success';
    $('#competition').textContent = (data.metrics.competition || 'unknown').toUpperCase();
    $('#competition').className = `metric-value badge-${compClass}`;
    $('#difficulty').textContent = `${data.metrics.difficulty || 0}%`;

    // CPC Range
    if (data.metrics.cpc) {
        const min = data.metrics.cpc.range?.min || 0;
        const max = data.metrics.cpc.range?.max || 0;
        $('#cpcRange').textContent = `$${min} - $${max}`;
    }

    // Location Display
    if (data.location) {
        $('#locationDisplay').innerHTML = `
            <div class="location-breadcrumb">
                ${data.location.country ? `<span class="location-part">${data.location.country}</span>` : ''}
                ${data.location.state ? `<span class="location-sep"><i class="fas fa-chevron-right"></i></span><span class="location-part">${data.location.state}</span>` : ''}
                ${data.location.city ? `<span class="location-sep"><i class="fas fa-chevron-right"></i></span><span class="location-part">${data.location.city}</span>` : ''}
                ${data.location.area ? `<span class="location-sep"><i class="fas fa-chevron-right"></i></span><span class="location-part">${data.location.area}</span>` : ''}
            </div>
        `;
    }

    // Intent Analysis
    if (data.intent) {
        $('#intentSection').style.display = 'block';
        const intentColors = {
            informational: '#3b82f6',
            navigational: '#8b5cf6',
            commercial: '#f59e0b',
            transactional: '#10b981'
        };
        const intentIcons = {
            informational: 'fa-info-circle',
            navigational: 'fa-compass',
            commercial: 'fa-balance-scale',
            transactional: 'fa-shopping-cart'
        };
        
        $('#intentPrimary').textContent = data.intent.primary.toUpperCase();
        $('#intentPrimary').style.background = intentColors[data.intent.primary] || '#6b7280';
        $('#intentStage').textContent = `Stage: ${data.intent.stage}`;
        $('#intentDescription').textContent = data.intent.description;
        
        // Intent breakdown
        const breakdown = data.intent.breakdown;
        $('#intentBreakdown').innerHTML = `
            <div class="breakdown-bars">
                ${Object.entries(breakdown).map(([type, score]) => `
                    <div class="breakdown-item">
                        <span class="breakdown-label">${type}</span>
                        <div class="breakdown-bar">
                            <div class="breakdown-fill" style="width: ${Math.min(100, score * 20)}%; background: ${intentColors[type]}"></div>
                        </div>
                        <span class="breakdown-score">${score}</span>
                    </div>
                `).join('')}
            </div>
        `;
    }

    // SERP Features
    if (data.serpFeatures) {
        $('#serpFeaturesSection').style.display = 'block';
        const features = data.serpFeatures.detected;
        const featureIcons = {
            featuredSnippet: 'fa-quote-left',
            peopleAlsoAsk: 'fa-question-circle',
            localPack: 'fa-map-marker-alt',
            imagePack: 'fa-images',
            videoResults: 'fa-video',
            shoppingResults: 'fa-shopping-bag',
            knowledgeGraph: 'fa-database',
            topStories: 'fa-newspaper',
        };
        
        const featuresHtml = Object.entries(features).filter(([k, v]) => v).map(([feature]) => `
            <div class="feature-badge">
                <i class="fas ${featureIcons[feature] || 'fa-check'}"></i>
                <span>${feature.replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>
        `).join('') || '<span class="no-features">No special features detected</span>';
        
        $('#serpFeaturesGrid').innerHTML = featuresHtml;
        
        const oppClass = data.serpFeatures.richResultsOpportunity === 'high' ? 'success' : data.serpFeatures.richResultsOpportunity === 'medium' ? 'warning' : 'danger';
        $('#richOpportunity').innerHTML = `
            <div class="opp-label">Rich Results Opportunity:</div>
            <span class="opp-value badge-${oppClass}">${data.serpFeatures.richResultsOpportunity.toUpperCase()}</span>
        `;
    }

    // Content Gaps
    if (data.contentGaps) {
        $('#contentGapSection').style.display = 'block';
        
        if (data.contentGaps.questionsNotAnswered?.length > 0) {
            $('#gapQuestions').innerHTML = `
                <h4>Questions to Answer</h4>
                <div class="gap-questions">
                    ${data.contentGaps.questionsNotAnswered.slice(0, 5).map(q => `<span class="tag">${q}</span>`).join('')}
                </div>
            `;
        }
        
        if (data.contentGaps.topicsToCover?.length > 0) {
            $('#gapTopics').innerHTML = `
                <h4>Topics to Cover</h4>
                <div class="gap-topics">
                    ${data.contentGaps.topicsToCover.slice(0, 8).map(t => `<span class="tag tag-outline">${t}</span>`).join('')}
                </div>
            `;
        }
        
        if (data.contentGaps.targetLength) {
            $('#gapLength').innerHTML = `
                <h4>Target Content Length</h4>
                <p class="target-length">${data.contentGaps.targetLength}+ words</p>
            `;
        }
        
        if (data.contentGaps.missingElements?.length > 0) {
            $('#gapElements').innerHTML = `
                <h4>Missing Elements</h4>
                <div class="gap-elements">
                    ${data.contentGaps.missingElements.map(el => `
                        <div class="element-item ${el.impact === 'high' ? 'high' : ''}">
                            <strong>${el.element}</strong>: ${el.reason}
                            <span class="impact-badge">${el.impact}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    }

    // Top Pages Analysis
    if (data.topPagesAnalysis) {
        const stats = data.topPagesAnalysis;
        const statsGrid = $('#pagesStats');
        statsGrid.innerHTML = `
            <div class="stat-row">
                <div class="stat-label-with-icon">
                    <i class="fas fa-file-alt"></i>
                    <span>Average Word Count</span>
                </div>
                <div class="stat-value-big">${stats.averageWordCount || 0}</div>
            </div>
            <div class="stat-row">
                <div class="stat-label-with-icon">
                    <i class="fas fa-heading"></i>
                    <span>Average H2 Count</span>
                </div>
                <div class="stat-value-big">${stats.avgH2Count || 0}</div>
            </div>
        `;
        
        const recommendations = $('#pagesRecommendations');
        recommendations.innerHTML = '';
        
        if (stats.recommendations?.length > 0) {
            recommendations.innerHTML = stats.recommendations.map(rec => `
                <div class="recommendation-item ${rec.priority === 'high' ? 'danger' : 'warning'}">
                    <i class="fas ${rec.priority === 'high' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
                    <span>${rec.message}</span>
                </div>
            `).join('');
        }
        
        $('#topPagesSection').style.display = 'block';
    }

    // Competitors
    if (data.competitors) {
        const keywordPhrase = data.keyword || '';
        const safeKeyword = String(keywordPhrase).replace(/'/g, "\\'");
        $('#competitorCount').textContent = data.competitors.length;
        const tbody = $('#competitorsTable tbody');
        tbody.innerHTML = data.competitors.map((comp) => `
            <tr>
                <td>${comp.position || '-'}</td>
                <td><a href="${comp.url || '#'}" target="_blank" rel="noopener" class="domain-link">${comp.domain || ''}</a></td>
                <td>${truncate(comp.title || '', 50)}</td>
                <td>
                    <button class="btn btn-sm btn-outline" onclick="analyzeCompetitor('${comp.url || ''}', '${safeKeyword}', ${comp.position || 0})">
                        <i class="fas fa-chart-bar"></i> Analyze
                    </button>
                </td>
            </tr>
        `).join('');
    }

    // Related searches
    const allRelated = data.relatedKeywords || [];
    // Deduplicate by keyword
    const uniqueRelated = [];
    const seen = new Set();
    for (const item of allRelated) {
        if (item.keyword && !seen.has(item.keyword.toLowerCase())) {
            seen.add(item.keyword.toLowerCase());
            uniqueRelated.push(item);
        }
    }
    
    PG.related.data = uniqueRelated;
    PG.related.total = uniqueRelated.length;
    PG.related.page = 1;
    
    $('#relatedCount').textContent = uniqueRelated.length;
    const bulkActions = $('#researchBulkActions');
    if (bulkActions) bulkActions.style.display = uniqueRelated.length ? 'flex' : 'none';
    renderRelatedKeywordsTable(1);
    updateRelatedKeywordSelectionUi();
}

function renderRelatedKeywordsTable(page = 1) {
    PG.related.page = page;
    const container = $('#relatedSearchesTable tbody');
    if (!container) return;
    
    const start = (page - 1) * PG.related.perPage;
    const end = start + PG.related.perPage;
    const chunk = PG.related.data.slice(start, end);
    
    const intentColors = {
        informational: '#3b82f6',
        navigational: '#8b5cf6',
        commercial: '#f59e0b',
        transactional: '#10b981'
    };
    
    if (chunk.length === 0) {
        container.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No related keywords found</td></tr>';
        const paginationContainer = $('#relatedSearchesPagination');
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }
    
    container.innerHTML = chunk.map(kw => {
        const safeKeyword = String(kw.keyword).replace(/'/g, "\\'");
        const volStr = formatNumber(kw.volume);
        const cpcStr = kw.cpc ? `$${Number(kw.cpc).toFixed(2)}` : '$0.00';
        
        // difficulty progress bar
        const diffColor = kw.difficulty > 60 ? '#ef4444' : (kw.difficulty > 35 ? '#f59e0b' : '#10b981');
        const diffHtml = `
            <div style="display:flex;align-items:center;gap:8px;">
                <div class="progress-bar" style="flex:1;height:6px;background:#f3f4f6;border-radius:3px;overflow:hidden;margin-bottom:0;">
                    <div class="progress" style="width:${kw.difficulty}%;height:100%;background:${diffColor};border-radius:3px;"></div>
                </div>
                <span style="font-weight:600;font-size:0.85rem;min-width:28px;text-align:right;">${kw.difficulty}%</span>
            </div>
        `;
        
        // intent badge
        const intentStyle = `background:${intentColors[kw.intent] || '#6b7280'};color:#fff;font-size:0.75rem;padding:2px 8px;border-radius:12px;font-weight:600;display:inline-block;text-transform:capitalize;`;
        const intentHtml = `<span style="${intentStyle}">${kw.intent || 'unknown'}</span>`;
        
        return `
            <tr>
                <td>
                    <input type="checkbox" class="related-keyword-check" data-keyword="${escapeHtml(kw.keyword)}" ${selectedRelatedKeywordKeys.has(keywordSelectionKey(kw.keyword)) ? 'checked' : ''}>
                </td>
                <td><strong>${escapeHtml(kw.keyword)}</strong></td>
                <td>${volStr}</td>
                <td>${cpcStr}</td>
                <td>${diffHtml}</td>
                <td>${intentHtml}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="searchRelated('${safeKeyword}')">
                        <i class="fas fa-search"></i> Analyze
                    </button>
                </td>
            </tr>
        `;
    }).join('');
    
    renderPagination('relatedSearchesPagination', PG.related, renderRelatedKeywordsTable);
    $$('.related-keyword-check').forEach(input => {
        input.addEventListener('change', () => toggleRelatedKeywordSelection(input.dataset.keyword, input.checked));
    });
    updateRelatedKeywordSelectionUi();
}

function getSelectedRelatedKeywords() {
    return PG.related.data.filter(item => selectedRelatedKeywordKeys.has(keywordSelectionKey(item.keyword)));
}

function getRelatedKeywordPayload({ selectedOnly = true } = {}) {
    const source = selectedOnly ? getSelectedRelatedKeywords() : PG.related.data;
    return source.map(item => ({
        keyword: item.keyword,
        volume: Number(item.volume || 0),
        competition: item.competition || 'unknown',
        cpc: Number(item.cpc || 0),
        difficulty: Number(item.difficulty || 0),
        intent: item.intent || 'informational',
        priorityScore: Number(item.opportunityScore || item.priorityScore || 0),
    }));
}

function toggleRelatedKeywordSelection(keyword, checked) {
    const key = keywordSelectionKey(keyword);
    if (!key) return;
    if (checked) selectedRelatedKeywordKeys.add(key);
    else selectedRelatedKeywordKeys.delete(key);
    updateRelatedKeywordSelectionUi();
}

function toggleVisibleRelatedKeywords(checked) {
    const start = (PG.related.page - 1) * PG.related.perPage;
    const end = start + PG.related.perPage;
    PG.related.data.slice(start, end).forEach(item => {
        const key = keywordSelectionKey(item.keyword);
        if (checked) selectedRelatedKeywordKeys.add(key);
        else selectedRelatedKeywordKeys.delete(key);
    });
    renderRelatedKeywordsTable(PG.related.page);
}

function selectAllRelatedKeywords() {
    PG.related.data.forEach(item => selectedRelatedKeywordKeys.add(keywordSelectionKey(item.keyword)));
    renderRelatedKeywordsTable(PG.related.page);
}

function clearRelatedKeywordSelection() {
    selectedRelatedKeywordKeys.clear();
    renderRelatedKeywordsTable(PG.related.page);
}

function updateRelatedKeywordSelectionUi() {
    const count = selectedRelatedKeywordKeys.size;
    const countEl = $('#selectedKeywordCount');
    if (countEl) countEl.textContent = `${count} selected`;

    const start = (PG.related.page - 1) * PG.related.perPage;
    const end = start + PG.related.perPage;
    const visible = PG.related.data.slice(start, end);
    const allVisibleSelected = visible.length > 0 && visible.every(item => selectedRelatedKeywordKeys.has(keywordSelectionKey(item.keyword)));
    const visibleToggle = $('#selectVisibleKeywords');
    if (visibleToggle) visibleToggle.checked = allVisibleSelected;
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadTextFile(filename, content, type = 'text/csv;charset=utf-8;') {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function exportRelatedKeywordsCsv() {
    const keywords = getRelatedKeywordPayload({ selectedOnly: selectedRelatedKeywordKeys.size > 0 });
    if (!keywords.length) {
        showError('No related keywords to export.');
        return;
    }

    const header = ['Keyword', 'Search Volume', 'CPC', 'Difficulty', 'Intent', 'Competition'];
    const rows = keywords.map(item => [item.keyword, item.volume, item.cpc, item.difficulty, item.intent, item.competition]);
    const csv = [header, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
    const base = keywordSelectionKey(currentKeyword?.keyword || $('#keywordInput')?.value || 'keyword-research').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'keyword-research';
    downloadTextFile(`${base}-keywords.csv`, csv);
    showSuccess(`Exported ${keywords.length} keyword${keywords.length === 1 ? '' : 's'} to CSV.`);
}

async function runSelectedKeywordProjectAction(options = {}) {
    const projectId = $('#researchProjectSelect')?.value || '';
    if (!projectId) {
        showError('Choose a project before saving selected keywords.');
        return null;
    }

    const keywords = getRelatedKeywordPayload({ selectedOnly: true });
    if (!keywords.length) {
        showError('Select at least one related keyword first.');
        return null;
    }

    const data = await api('/api/keywords/project-bulk', {
        method: 'POST',
        body: JSON.stringify({
            projectId,
            location: latestResearchLocation || getResearchLocationInput(),
            keywords,
            ...options,
        }),
    });

    if (!data.success && !data.ok) {
        showError(data.error || 'Keyword action failed.');
        return null;
    }

    return data;
}

async function saveSelectedKeywordsToProject() {
    try {
        const data = await runSelectedKeywordProjectAction({ saveKeywords: true, createTasks: false, createBriefs: false });
        if (data) showSuccess(`Saved ${data.linkedKeywords || 0} keyword${data.linkedKeywords === 1 ? '' : 's'} to project.`);
    } catch (err) {
        console.error('Save selected keywords failed:', err);
    }
}

async function createTasksFromSelectedKeywords() {
    try {
        const data = await runSelectedKeywordProjectAction({ saveKeywords: true, createTasks: true, createBriefs: false });
        if (data) showSuccess(`Created ${data.tasksCreated || 0} SEO task${data.tasksCreated === 1 ? '' : 's'} and saved ${data.linkedKeywords || 0} keyword${data.linkedKeywords === 1 ? '' : 's'}.`);
    } catch (err) {
        console.error('Create tasks from selected keywords failed:', err);
    }
}

async function createBriefsFromSelectedKeywords() {
    try {
        const data = await runSelectedKeywordProjectAction({ saveKeywords: true, createTasks: false, createBriefs: true, briefLimit: 3 });
        if (data) {
            const warning = data.briefErrors?.length ? ` ${data.briefErrors.length} brief failed.` : '';
            showSuccess(`Created ${data.briefsCreated || 0} content brief${data.briefsCreated === 1 ? '' : 's'} and saved ${data.linkedKeywords || 0} keyword${data.linkedKeywords === 1 ? '' : 's'}.${warning}`);
        }
    } catch (err) {
        console.error('Create briefs from selected keywords failed:', err);
    }
}

function searchRelated(keyword) {
    $('#keywordInput').value = keyword;
    $('#researchBtn').click();
}

// ─── Analyze Competitor ───
async function analyzeCompetitor(url, keyword, position) {
    const modal = $('#competitorAnalysisModal');
    const content = $('#competitorAnalysisContent');

    // Show modal immediately with loading state
    content.innerHTML = `
        <div class="modal-loading">
            <div class="spinner-small"></div>
            <p>Analyzing page content...</p>
        </div>
    `;
    modal.classList.add('active');

    try {
        const data = await fetch(`${API_BASE}/api/competitors/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, keyword }),
        });
        const result = await data.json();

        if (!result.success) {
            throw new Error(result.error || 'Analysis failed');
        }

        showCompetitorAnalysis(result.analysis, position);
    } catch (err) {
        console.error('Analysis failed:', err);
        content.innerHTML = `
            <div class="modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Analysis Failed</h4>
                <p>${err.message || 'Could not analyze this page. The site may be blocking automated requests.'}</p>
            </div>
        `;
    }
}

function showCompetitorAnalysis(analysis, position) {
    const content = $('#competitorAnalysisContent');

    // Keyword density color class
    const density = analysis.content.keywordAnalysis.density;
    let densityClass = 'density-low';
    if (density >= 1) densityClass = 'density-good';
    else if (density >= 0.5) densityClass = 'density-ok';

    // Word count progress (target ~1500 words)
    const wordPct = Math.min(100, Math.round((analysis.content.wordCount / 1500) * 100));

    // DA label
    const daValue = analysis.domainAuthority;
    const isEstimatedDA = daValue <= 50;

    // SEO data
    const seo = analysis.seo || {};
    const headings = seo.headings || { h1: 0, h2: 0, h3: 0 };
    const images = seo.images || 0;
    const imagesWithAlt = seo.imagesWithAlt || 0;

    // Individual keyword word counts
    const wordCounts = analysis.content.keywordAnalysis.wordCounts || {};
    const keywordWordsHtml = Object.entries(wordCounts).map(([word, count]) => 
        `<span class="keyword-word"><span class="word">${word}</span><span class="count">(${count})</span></span>`
    ).join('');

    // Schema details
    const schemaDetails = seo.schemaDetails || {};
    const pageType = seo.pageType || {};
    const schemaSuggestions = seo.schemaSuggestions || [];
    const schemaTypesHtml = schemaDetails.detectedTypes?.length > 0 
        ? schemaDetails.detectedTypes.map(t => `<span class="schema-type">${t}</span>`).join('')
        : '<span class="no-schema">None detected</span>';
    const schemaErrorsHtml = schemaDetails.errors?.length > 0 
        ? schemaDetails.errors.map(e => `<div class="schema-error">${e.message}</div>`).join('')
        : '';

    content.innerHTML = `
        <div class="analysis-detail">
            <div class="modal-domain-header">
                ${position ? `<span class="rank-badge">#${position}</span>` : ''}
                <h4>${analysis.domain}</h4>
            </div>
            <p class="url"><a href="${analysis.url}" target="_blank" rel="noopener">${analysis.url}</a></p>

            <!-- Stats Grid -->
            <div class="stats-grid">
                <div class="stat-box">
                    <span class="label">Domain Authority</span>
                    <span class="value ${isEstimatedDA ? 'estimated' : ''}">${daValue}</span>
                    ${isEstimatedDA ? '<span class="sublabel">estimated</span>' : ''}
                </div>
                <div class="stat-box">
                    <span class="label">Word Count</span>
                    <span class="value">${formatNumber(analysis.content.wordCount)}</span>
                    <div class="word-count-bar"><div class="fill" style="width: ${wordPct}%"></div></div>
                </div>
                <div class="stat-box">
                    <span class="label">Keyword Density</span>
                    <span class="value ${densityClass}">${density}%</span>
                </div>
                <div class="stat-box">
                    <span class="label">Keyword Matches</span>
                    <span class="value">${analysis.content.keywordAnalysis.exactMatches}</span>
                </div>
            </div>

            <!-- Individual Keyword Word Counts -->
            ${Object.keys(wordCounts).length > 0 ? `
                <div class="keyword-words-section">
                    <h5 class="section-title"><i class="fas fa-search"></i> Keyword Word Breakdown</h5>
                    <div class="keyword-words">${keywordWordsHtml}</div>
                </div>
            ` : ''}

            <!-- H1 Preview -->
            ${seo.hasH1 && seo.h1Text ? `
                <h5 class="section-title"><i class="fas fa-heading"></i> H1 Tag</h5>
                <div class="h1-preview">${truncate(seo.h1Text, 120)}</div>
            ` : ''}

            <!-- Meta Description Preview -->
            ${seo.hasMetaDescription && seo.metaDescription ? `
                <h5 class="section-title"><i class="fas fa-align-left"></i> Meta Description</h5>
                <div class="meta-preview">${truncate(seo.metaDescription, 200)}</div>
            ` : ''}

            <!-- SEO Checklist -->
            <h5 class="section-title"><i class="fas fa-clipboard-check"></i> SEO Elements</h5>
            <div class="seo-checks">
                <div class="check ${seo.hasH1 ? 'pass' : 'fail'}">
                    <i class="fas ${seo.hasH1 ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                    H1 Tag
                    ${seo.hasH1 && seo.h1Text ? `<span class="check-detail">${truncate(seo.h1Text, 40)}</span>` : ''}
                </div>
                <div class="check ${seo.hasMetaDescription ? 'pass' : 'fail'}">
                    <i class="fas ${seo.hasMetaDescription ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                    Meta Description
                </div>
                <div class="check ${seo.hasSchema ? 'pass' : 'fail'}">
                    <i class="fas ${seo.hasSchema ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                    Schema Markup
                    ${seo.hasSchema ? `<span class="schema-count">(${schemaDetails.count || 1})</span>` : ''}
                </div>
                ${pageType.primary ? `
                    <div class="check pass">
                        <i class="fas fa-file-alt"></i>
                        Page Type: <span class="page-type">${pageType.primary}</span>
                    </div>
                ` : ''}
            </div>

            <!-- Schema Details -->
            ${seo.hasSchema || pageType.primary ? `
                <h5 class="section-title"><i class="fas fa-code"></i> Schema & Page Type</h5>
                <div class="schema-details">
                    <div class="schema-row">
                        <span class="schema-label">Detected Types:</span>
                        <div class="schema-types">${schemaTypesHtml}</div>
                    </div>
                    ${pageType.all && pageType.all.length > 1 ? `
                        <div class="schema-row">
                            <span class="schema-label">Possible Types:</span>
                            <div class="schema-types">${pageType.all.map(t => `<span class="schema-type secondary">${t}</span>`).join('')}</div>
                        </div>
                    ` : ''}
                    ${schemaErrorsHtml ? `
                        <div class="schema-errors">
                            <span class="schema-label error">Errors:</span>
                            ${schemaErrorsHtml}
                        </div>
                    ` : ''}
                </div>
            ` : ''}

            <!-- Schema Suggestions -->
            ${schemaSuggestions.length > 0 ? `
                <h5 class="section-title"><i class="fas fa-lightbulb"></i> Schema Suggestions</h5>
                <div class="schema-suggestions">
                    ${schemaSuggestions.map(s => `
                        <div class="suggestion ${s.priority === 'HIGH' ? 'high' : s.priority === 'CRITICAL' ? 'critical' : ''}">
                            <span class="suggestion-type">${s.type}</span>
                            <span class="suggestion-priority ${s.priority.toLowerCase()}">${s.priority}</span>
                            <p class="suggestion-reason">${s.reason}</p>
                            ${s.fields ? `<p class="suggestion-fields">Fields: ${s.fields.join(', ')}</p>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Heading Structure -->
            <h5 class="section-title"><i class="fas fa-list-ol"></i> Heading Structure</h5>
            <div class="heading-structure">
                <div class="heading-item">
                    <span class="heading-tag">H1</span>
                    <span class="heading-count">${headings.h1 || 0}</span>
                </div>
                <div class="heading-item">
                    <span class="heading-tag">H2</span>
                    <span class="heading-count">${headings.h2 || 0}</span>
                </div>
                <div class="heading-item">
                    <span class="heading-tag">H3</span>
                    <span class="heading-count">${headings.h3 || 0}</span>
                </div>
            </div>

            <!-- Images -->
            ${images > 0 ? `
                <h5 class="section-title"><i class="fas fa-image"></i> Images</h5>
                <div class="image-stat">
                    <i class="fas fa-image"></i>
                    <span class="img-ratio">${imagesWithAlt}/${images}</span>
                    images have alt text
                </div>
            ` : ''}

            <!-- Links -->
            <h5 class="section-title"><i class="fas fa-link"></i> Links</h5>
            <div class="link-stats">
                <div class="link-item">
                    <span class="link-count">${seo.internalLinks || 0}</span>
                    <span class="link-label">Internal</span>
                </div>
                <div class="link-item">
                    <span class="link-count">${seo.externalLinks || 0}</span>
                    <span class="link-label">External</span>
                </div>
            </div>
        </div>
    `;
}

// Close modal
$$('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
        btn.closest('.modal').classList.remove('active');
    });
});

// ─── Competitors Page ─── (paginated via /api/competitors/top)
async function loadTopCompetitors(page = 1) {
    PG.competitors.page = page;
    const offset = (page - 1) * PG.competitors.perPage;
    try {
        const projectId = document.getElementById('competitorProjectSelect')?.value || '';
        const endpoint = projectId
            ? `/api/projects/${encodeURIComponent(projectId)}/competitors?limit=${PG.competitors.perPage}&offset=${offset}`
            : `/api/competitors/top?limit=${PG.competitors.perPage}&offset=${offset}`;
        const data = await api(endpoint);
        PG.competitors.total = data.total || 0;
        renderTopCompetitors(data.competitors || []);
        renderPagination('topCompetitorsPagination', PG.competitors, loadTopCompetitors);
    } catch (err) {
        console.error('Failed to load competitors:', err);
    }
}

function renderTopCompetitors(competitors) {
    const tbody = $('#topCompetitorsTable tbody');
    if (!competitors.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No competitors found</td></tr>';
        return;
    }

    tbody.innerHTML = competitors.map(comp => `
        <tr>
            <td class="domain">${comp.domain}</td>
            <td>${comp.keyword_overlap || comp.keyword_count || 0}</td>
            <td>#${Math.round(comp.avg_position)}</td>
            <td>#${comp.best_position}</td>
            <td>
                <button class="btn btn-sm btn-outline" onclick="viewCompetitorDetail('${comp.domain}')">
                    <i class="fas fa-eye"></i> View
                </button>
            </td>
        </tr>
    `).join('');
}

async function viewCompetitorDetail(domain) {
    // Use the competitor analysis modal for displaying details
    const modal = $('#competitorAnalysisModal');
    const content = $('#competitorAnalysisContent');
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) modalTitle.textContent = `📊 Competitor: ${domain}`;

    // Show modal immediately with loading
    content.innerHTML = `
        <div class="modal-loading">
            <div class="spinner-small"></div>
            <p>Loading competitor data...</p>
        </div>
    `;
    modal.classList.add('active');

    try {
        const response = await fetch(`${API_BASE}/api/competitors/${domain}`);
        const data = await response.json();

        if (data.error) throw new Error(data.error);

        const rankings = data.rankings || [];

        content.innerHTML = `
            <div class="analysis-detail">
                <div class="modal-domain-header">
                    <h4>${domain}</h4>
                </div>
                <div class="stats-grid" style="grid-template-columns: 1fr 1fr; gap:14px; margin-bottom:20px;">
                    <div class="stat-box">
                        <span class="label">Domain Authority</span>
                        <span class="value">${data.domainAuthority}</span>
                        <span class="sublabel">estimated</span>
                    </div>
                    <div class="stat-box">
                        <span class="label">Total Keywords</span>
                        <span class="value">${data.totalKeywords}</span>
                        <span class="sublabel">ranked for</span>
                    </div>
                </div>

                <h5 class="section-title"><i class="fas fa-list-ol"></i> Keyword Rankings</h5>
                ${rankings.length > 0 ? `
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Keyword</th>
                                <th>#</th>
                                <th>Volume</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rankings.map(r => `
                                <tr>
                                    <td><strong>${r.keyword}</strong></td>
                                    <td><span class="badge badge-${r.rank_position <= 3 ? 'low' : r.rank_position <= 10 ? 'medium' : 'high'}">#${r.rank_position}</span></td>
                                    <td>${formatNumber(r.search_volume)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="text-center text-muted">No tracked keywords yet. Research keywords to see rankings here.</p>'}
            </div>
        `;
    } catch (err) {
        console.error('Failed to load competitor detail:', err);
        content.innerHTML = `
            <div class="modal-error">
                <i class="fas fa-exclamation-triangle"></i>
                <h4>Failed to Load</h4>
                <p>${err.message || 'Could not load competitor details.'}</p>
            </div>
        `;
    }
}


// ─── Analysis Page ───
const cleanDomain = (input) => {
    try {
        if (!input) return '';
        if (input.includes('://')) {
            return new URL(input).hostname.replace('www.', '');
        }
        if (input.includes('/')) {
            return input.split('/')[0].replace('www.', '');
        }
        return input.replace('www.', '');
    } catch (e) {
        return input;
    }
};

// ─── Compare & Analyze: button + progressive loading ───
const PROGRESS_STEPS = [
    'Fetching domain authority…',
    'Pulling SERP positions…',
    'Crawling your page…',
    'Crawling competitor page…',
    'Computing SEO scores…',
    'Asking the AI expert…',
];

$('#analyzeBtn')?.addEventListener('click', async () => {
    const btn = $('#analyzeBtn');
    const progress = $('#analysisProgress');
    const progressText = progress?.querySelector('.progress-text');
    const myDomainRaw = $('#myDomainInput').value.trim();
    const competitorDomainRaw = $('#competitorDomainInput').value.trim();
    const keyword = $('#analysisKeywordInput').value.trim();
    const myUrl = $('#myUrlInput').value.trim();
    const competitorUrl = $('#competitorUrlInput').value.trim();

    if (!myDomainRaw || !competitorDomainRaw || !keyword) {
        showError('Please fill in all required fields');
        return;
    }

    // Auto-clean domains
    const myDomain = cleanDomain(myDomainRaw);
    const competitorDomain = cleanDomain(competitorDomainRaw);
    $('#myDomainInput').value = myDomain;
    $('#competitorDomainInput').value = competitorDomain;

    // Loading state + disable double-submit
    if (btn) {
        btn.disabled = true;
        btn.classList.add('is-loading');
    }
    if (progress) {
        progress.hidden = false;
    }

    let stepIndex = 0;
    const tick = () => {
        if (progressText) {
            progressText.textContent = PROGRESS_STEPS[stepIndex % PROGRESS_STEPS.length];
        }
        stepIndex++;
    };
    tick();
    const tickInterval = setInterval(tick, 2200);

    try {
        const data = await api('/api/analysis/compare', {
            method: 'POST',
            body: JSON.stringify({ myDomain, competitorDomain, keyword, myUrl, competitorUrl, includePageSpeed: !!$('#analysisIncludePageSpeed')?.checked }),
        });
        if (progressText) progressText.textContent = 'Rendering results…';
        renderAnalysisResults(data.comparison);
        // Scroll the results into view so the user sees the hero card.
        $('#analysisResults')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error('Analysis failed:', err);
        showError(err?.message || 'Analysis failed');
    } finally {
        clearInterval(tickInterval);
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('is-loading');
        }
        if (progress) progress.hidden = true;
    }
});

// ─── Helpers for rendering ───
function fmtNumber(n) {
    if (n === null || n === undefined || n === '') return '–';
    if (typeof n === 'number') return Number.isInteger(n) ? n.toString() : n.toFixed(2).replace(/\.?0+$/, '');
    return n;
}

function fmtPercent(n) {
    if (n === null || n === undefined) return '–';
    return `${Number(n).toFixed(2).replace(/\.?0+$/, '')}%`;
}

function clampPct(value, max) {
    if (!max || value == null) return 0;
    return Math.max(0, Math.min(100, (Number(value) / Number(max)) * 100));
}

function winnerSide(mine, theirs) {
    if (mine == null || theirs == null) return 'tie';
    if (Number(mine) > Number(theirs)) return 'mine';
    if (Number(mine) < Number(theirs)) return 'competitor';
    return 'tie';
}

function verdictClass(verdict) {
    const v = String(verdict || '').toLowerCase();
    if (v.includes('dominat')) return 'dominating';
    if (v.includes('behind') || v.includes('risk') || v.includes('crush')) return 'behind';
    return 'competitive';
}

function overallTone(score) {
    if (score == null) return 'neutral';
    if (score >= 67) return 'good';
    if (score >= 40) return 'mid';
    return 'bad';
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showSuccess('Copied to clipboard');
    } catch (err) {
        // Fallback: temporary textarea
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showSuccess('Copied to clipboard'); }
        catch { showError('Could not copy. Select and copy manually.'); }
        document.body.removeChild(ta);
    }
}

// ─── Render: AI Expert Insight (HERO) ───
function renderAIInsight(comparison) {
    const wrap = $('#aiInsight');
    if (!wrap) return;
    const ai = comparison.aiAnalysis;
    if (!ai) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }

    const aiScore = Number(ai.aiScore ?? ai.score ?? 0);
    const tone = overallTone(aiScore);
    const verdictCls = verdictClass(ai.verdict);

    // Winning factor = first HIGH-impact difference
    const diffs = comparison.keyDifferences || [];
    const winMine = diffs.find(d => d.winner === 'mine' && d.impact === 'HIGH');
    const winComp = diffs.find(d => d.winner === 'competitor' && d.impact === 'HIGH');
    const topFactor = (aiScore >= 50 ? winMine : winComp) || diffs[0];

    wrap.innerHTML = `
        <div class="ai-expert-box ai-tone-${tone}">
            <div class="ai-header">
                <div class="ai-title">
                    <i class="fas fa-robot"></i> AI Expert Insight
                    <span class="ai-verdict ${verdictCls}">${escapeHtml(ai.verdict || 'Verdict')}</span>
                </div>
                <div class="ai-score-badge">
                    <span class="label">Expert Score</span>
                    <span class="value">${escapeHtml(String(aiScore))}</span>
                    <span class="suffix">/100</span>
                </div>
            </div>
            ${topFactor ? `
                <div class="ai-winning-factor ${topFactor.winner === 'mine' ? 'is-mine' : 'is-competitor'}">
                    <i class="fas ${topFactor.winner === 'mine' ? 'fa-trophy' : 'fa-bolt'}"></i>
                    <div>
                        <div class="ai-factor-label">${topFactor.winner === 'mine' ? 'Your biggest advantage' : 'Competitor\'s biggest advantage'}</div>
                        <div class="ai-factor-name">${escapeHtml(topFactor.factor)} — ${escapeHtml(topFactor.gap || '')}</div>
                    </div>
                </div>
            ` : ''}
            <div class="ai-summary"><strong>Strategy:</strong> ${escapeHtml(ai.strategicSummary || '')}</div>
            <div class="ai-observation"><strong>Observation:</strong> ${escapeHtml(ai.keyObservation || '')}</div>
        </div>
    `;
    wrap.style.display = 'block';
}

// ─── Render: Side-by-Side Metrics Grid ───
function renderComparisonGrid(comparison) {
    const grid = $('#comparisonGrid');
    const scores = comparison.scores || {};
    const seo = scores.seo?.scores || {};
    const content = scores.content || {};
    const serp = comparison.serp || {};

    // Build metric rows. Each: {label, mine, theirs, max, format, winner}
    const mySeoScore = Number(seo.mine || 0);
    const compSeoScore = Number(seo.competitor || 0);
    const mySeoChecks = scores.seo?.checks || {};
    const compSeoChecks = scores.seo?.checks || {};

    const rows = [
        {
            label: 'OpenPageRank',
            icon: 'fa-globe',
            mine: scores.domainAuthority?.mine,
            theirs: scores.domainAuthority?.competitor,
            max: 100,
            format: 'number',
            hint: 'Domain authority (higher = more trust)',
        },
        {
            label: 'SEO Score',
            icon: 'fa-gauge-high',
            mine: mySeoScore,
            theirs: compSeoScore,
            max: 100,
            format: 'number',
            hint: 'On-page SEO (H1, meta, schema, links, images)',
        },
        {
            label: 'Word Count',
            icon: 'fa-align-left',
            mine: content.wordCount?.mine,
            theirs: content.wordCount?.competitor,
            max: Math.max(content.wordCount?.mine || 0, content.wordCount?.competitor || 0, 1500),
            format: 'number',
            hint: 'Total words on the target page',
        },
        {
            label: 'Keyword Density',
            icon: 'fa-percent',
            mine: content.keywordDensity?.mine,
            theirs: content.keywordDensity?.competitor,
            max: 3,
            format: 'percent',
            hint: 'Sweet spot 1–2%',
        },
        {
            label: 'Internal Links',
            icon: 'fa-link',
            mine: mySeoChecks.internalLinks?.mine,
            theirs: compSeoChecks.internalLinks?.competitor,
            max: Math.max(mySeoChecks.internalLinks?.mine || 0, compSeoChecks.internalLinks?.competitor || 0, 30),
            format: 'number',
            hint: 'Helps distribute page authority',
        },
        {
            label: 'Images w/ Alt',
            icon: 'fa-image',
            mine: mySeoChecks.imagesWithAlt?.mine,
            theirs: compSeoChecks.imagesWithAlt?.competitor,
            max: Math.max(mySeoChecks.imagesWithAlt?.mine || 0, compSeoChecks.imagesWithAlt?.competitor || 0, 10),
            format: 'number',
            hint: 'Accessibility + image SEO',
        },
    ];

    const overall = Number(comparison.overallScore ?? 0);
    const pill = $('#overallScorePill');
    if (pill) {
        pill.hidden = false;
        pill.classList.remove('tone-good', 'tone-mid', 'tone-bad');
        pill.classList.add(`tone-${overallTone(overall)}`);
        const val = $('#overallScoreValue');
        if (val) val.textContent = fmtNumber(overall);
    }

    const serpMine = serp.mine?.position;
    const serpComp = serp.competitor?.position;
    const serpRow = `
        <div class="serp-positions">
            <div class="serp-side">
                <div class="serp-label">${escapeHtml(comparison.myDomain || 'You')}</div>
                <div class="serp-pos ${serpMine ? `pos-${serpMine <= 3 ? 'top' : serpMine <= 10 ? 'mid' : 'low'}` : 'pos-none'}">
                    ${serpMine ? `#${serpMine}` : 'Not ranking'}
                </div>
                ${serpMine && serp.mine.url ? `<a class="serp-link" href="${escapeAttr(serp.mine.url)}" target="_blank" rel="noopener">${escapeHtml(truncate(serp.mine.title || serp.mine.url, 50))}</a>` : '<div class="serp-link muted">No SERP match found</div>'}
            </div>
            <div class="serp-side">
                <div class="serp-label">${escapeHtml(comparison.competitorDomain || 'Competitor')}</div>
                <div class="serp-pos ${serpComp ? `pos-${serpComp <= 3 ? 'top' : serpComp <= 10 ? 'mid' : 'low'}` : 'pos-none'}">
                    ${serpComp ? `#${serpComp}` : 'Not ranking'}
                </div>
                ${serpComp && serp.competitor.url ? `<a class="serp-link" href="${escapeAttr(serp.competitor.url)}" target="_blank" rel="noopener">${escapeHtml(truncate(serp.competitor.title || serp.competitor.url, 50))}</a>` : '<div class="serp-link muted">No SERP match found</div>'}
            </div>
        </div>
    `;

    const rowHtml = rows.map(r => {
        const mine = r.mine == null ? null : Number(r.mine);
        const theirs = r.theirs == null ? null : Number(r.theirs);
        const w = winnerSide(mine, theirs);
        const mineStr = mine == null ? '–' : (r.format === 'percent' ? fmtPercent(mine) : fmtNumber(mine));
        const theirsStr = theirs == null ? '–' : (r.format === 'percent' ? fmtPercent(theirs) : fmtNumber(theirs));
        const minePct = clampPct(mine, r.max);
        const theirsPct = clampPct(theirs, r.max);
        return `
            <div class="metric-row winner-${w}">
                <div class="metric-label">
                    <i class="fas ${r.icon}"></i>
                    <div>
                        <div class="metric-name">${escapeHtml(r.label)}</div>
                        <div class="metric-hint">${escapeHtml(r.hint)}</div>
                    </div>
                </div>
                <div class="metric-side metric-mine">
                    <div class="metric-value">${escapeHtml(mineStr)} ${w === 'mine' ? '<i class="fas fa-check winner-check"></i>' : ''}</div>
                    <div class="metric-bar"><span class="bar-mine" style="width:${minePct}%"></span></div>
                </div>
                <div class="metric-side metric-comp">
                    <div class="metric-value">${escapeHtml(theirsStr)} ${w === 'competitor' ? '<i class="fas fa-check winner-check"></i>' : ''}</div>
                    <div class="metric-bar"><span class="bar-comp" style="width:${theirsPct}%"></span></div>
                </div>
            </div>
        `;
    }).join('');

    grid.innerHTML = `
        <div class="metric-head">
            <div class="metric-label-spacer"></div>
            <div class="metric-side-head metric-mine">${escapeHtml(comparison.myDomain || 'You')}</div>
            <div class="metric-side-head metric-comp">${escapeHtml(comparison.competitorDomain || 'Competitor')}</div>
        </div>
        ${rowHtml}
        <div class="serp-section">
            <div class="serp-section-title"><i class="fas fa-search"></i> Google SERP position for <strong>${escapeHtml(comparison.keyword || '')}</strong></div>
            ${serpRow}
        </div>
    `;
}

// ─── Render: Key Comparative Differences ───
function renderDifferences(comparison) {
    const reasonsList = $('#reasonsList');
    reasonsList.innerHTML = (comparison.keyDifferences || []).map(diff => `
        <div class="reason-item winner-${diff.winner}">
            <div class="factor">
                ${escapeHtml(diff.factor)}
                <span class="winner-badge ${diff.winner}">${diff.winner === 'mine' ? '✅ Your Advantage' : '⚠️ Competitor Advantage'}</span>
                <span class="impact-pill impact-${String(diff.impact || 'low').toLowerCase()}">${escapeHtml(diff.impact || 'LOW')}</span>
            </div>
            <div class="explanation">${escapeHtml(diff.explanation || '')}</div>
            <div class="gap">${escapeHtml(diff.gap || '')}</div>
        </div>
    `).join('') || '<p class="text-muted">No significant differences found.</p>';
}

// ─── Render: Suggestions (grouped by category, with Copy action) ───
function renderSuggestions(comparison) {
    const list = $('#suggestionsList');
    const allSuggestions = comparison.suggestions || [];

    $('#suggestionsCount').textContent = `${allSuggestions.length} item${allSuggestions.length === 1 ? '' : 's'}`;

    if (!allSuggestions.length) {
        list.innerHTML = '<p class="text-muted">No suggestions available — the two pages are evenly matched.</p>';
        return;
    }

    // Group by category
    const groups = {};
    allSuggestions.forEach((sug, idx) => {
        const cat = sug.category || 'Other';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push({ ...sug, _index: idx });
    });

    const categoryOrder = ['Content', 'SEO', 'Keywords', 'Technical SEO', 'Link Building', 'Authority', 'Benchmark', 'Other'];
    const sortedCategories = Object.keys(groups).sort((a, b) => {
        const ai = categoryOrder.indexOf(a);
        const bi = categoryOrder.indexOf(b);
        if (ai === -1 && bi === -1) return a.localeCompare(b);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
    });

    const categoryIcon = (cat) => {
        const map = {
            'Content': 'fa-pen-fancy',
            'SEO': 'fa-magnifying-glass',
            'Keywords': 'fa-key',
            'Technical SEO': 'fa-code',
            'Link Building': 'fa-link',
            'Authority': 'fa-shield-halved',
            'Benchmark': 'fa-bullseye',
            'Other': 'fa-lightbulb',
        };
        return map[cat] || 'fa-lightbulb';
    };

    const renderSuggestion = (sug) => {
        const priority = String(sug.priority || 'LOW').toLowerCase();
        const details = Array.isArray(sug.details) ? sug.details : [];
        const meta = [
            sug.effort ? `Effort: ${sug.effort}` : '',
            sug.timeline ? `Timeline: ${sug.timeline}` : '',
        ].filter(Boolean);

        const copyText = [
            `[${sug.priority || 'LOW'}] ${sug.action || ''}`,
            sug.why ? `Why: ${sug.why}` : '',
            sug.metric ? `Trigger: ${sug.metric}` : '',
            sug.nextStep ? `Next step: ${sug.nextStep}` : '',
            details.length ? `\nDetails:\n- ${details.join('\n- ')}` : '',
        ].filter(Boolean).join('\n');

        return `
            <div class="suggestion-item priority-${priority}" data-suggestion-idx="${sug._index}">
                <div class="suggestion-header">
                    <span class="priority badge badge-${priority}">${escapeHtml(sug.priority || 'LOW')}</span>
                    ${sug.priorityScore ? `<span class="suggestion-score">Impact ${escapeHtml(String(sug.priorityScore))}/3</span>` : ''}
                    <button class="copy-btn" type="button" data-copy="${escapeAttr(copyText)}" title="Copy this action">
                        <i class="fas fa-copy"></i> Copy
                    </button>
                </div>
                <div class="action">${escapeHtml(sug.action || 'Review this opportunity')}</div>
                ${meta.length ? `<div class="suggestion-meta">${meta.map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div>` : ''}
                ${sug.metric ? `<div class="suggestion-metric"><strong>Trigger:</strong> ${escapeHtml(sug.metric)}</div>` : ''}
                ${sug.why ? `<div class="suggestion-why"><strong>Why:</strong> ${escapeHtml(sug.why)}</div>` : ''}
                ${details.length ? `
                    <ul class="details">
                        ${details.map(d => `<li>${escapeHtml(d)}</li>`).join('')}
                    </ul>
                ` : ''}
                ${sug.nextStep ? `<div class="next-step"><strong>Next step:</strong> ${escapeHtml(sug.nextStep)}</div>` : ''}
                <div class="impact">Impact: ${escapeHtml(sug.estimatedImpact || 'Improves SEO quality')}</div>
            </div>
        `;
    };

    list.innerHTML = sortedCategories.map(cat => {
        const items = groups[cat];
        const highCount = items.filter(i => String(i.priority || '').toUpperCase() === 'HIGH').length;
        return `
            <details class="suggestion-group" open>
                <summary>
                    <i class="fas ${categoryIcon(cat)}"></i>
                    <span class="group-name">${escapeHtml(cat)}</span>
                    <span class="group-count">${items.length}${highCount ? ` · <strong>${highCount} high</strong>` : ''}</span>
                </summary>
                <div class="group-items">${items.map(renderSuggestion).join('')}</div>
            </details>
        `;
    }).join('');

    // Wire up copy buttons (event delegation, single listener).
    list.onclick = (e) => {
        const btn = e.target.closest('.copy-btn');
        if (!btn) return;
        const text = btn.getAttribute('data-copy') || '';
        copyToClipboard(text);
    };
}

// ─── Master render ───
function renderAnalysisResults(comparison) {
    $('#analysisResults').style.display = 'block';
    renderAIInsight(comparison);
    renderComparisonGrid(comparison);
    renderDifferences(comparison);
    renderSuggestions(comparison);
    renderPhase2Metrics(comparison);
}

// ─── Phase 2: Enhanced Analysis Metrics ───
function renderPhase2Metrics(comparison) {
    const container = $('#analysisResults');
    if (!container) return;

    // Remove any previously injected Phase 2 sections
    container.querySelectorAll('.phase2-section').forEach(el => el.remove());

    const sections = [];

    // Confidence & Score Breakdown
    if (comparison.confidence != null) {
        sections.push(renderConfidenceSection(comparison));
    }

    // Entity Coverage
    const entity = comparison.scores?.entityCoverage;
    if (entity) {
        sections.push(renderEntityCoverageSection(entity));
    }

    // Schema Validation
    const schema = comparison.scores?.schemaValidation;
    if (schema) {
        sections.push(renderSchemaValidationSection(schema));
    }

    // E-E-A-T Signals
    const eat = comparison.scores?.eatSignals;
    if (eat) {
        sections.push(renderEEATSection(eat));
    }

    // PageSpeed / CWV
    const ps = comparison.scores?.pageSpeed;
    if (ps) {
        sections.push(renderPageSpeedSection(ps));
    }

    // Top-10 Benchmarks
    const benchmarks = comparison.benchmarks;
    if (benchmarks) {
        sections.push(renderBenchmarksSection(benchmarks, comparison));
    }

    // Inject all sections after suggestions
    const suggestionsCard = container.querySelector('.suggestions');
    if (suggestionsCard && sections.length) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = sections.join('');
        suggestionsCard.after(wrapper);
    }
}

function renderConfidenceSection(comp) {
    const score = comp.overallScore || 0;
    const confidence = comp.confidence || 0;
    const breakdown = comp.scoreBreakdown || {};
    const tone = overallTone(score);

    const factorRows = [
        ['Domain Authority', breakdown.domainAuthority, 'DA points'],
        ['Content Length', breakdown.contentLength, 'words'],
        ['SEO Score', breakdown.seoScore, 'pts'],
        ['Entity Coverage', breakdown.entityCoverage, '%'],
        ['Schema Types', breakdown.schemaCount, 'types'],
        ['E-E-A-T Score', breakdown.eatScore, '/100'],
        ['PageSpeed', breakdown.pageSpeed, '/100'],
    ].filter(([, v]) => v != null)
     .map(([label, value, unit]) => {
         const color = value > 0 ? 'var(--secondary)' : value < 0 ? 'var(--danger)' : 'var(--text-muted)';
         const sign = value > 0 ? '+' : '';
         return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border);">
             <span style="font-size:13px;color:var(--text);">${label}</span>
             <span style="font-size:13px;font-weight:600;color:${color};">${sign}${value} ${unit}</span>
         </div>`;
     }).join('');

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-brain"></i> Weighted Score & Confidence</h3>
        </div>
        <div class="card-body">
            <div style="display:flex;gap:24px;align-items:center;margin-bottom:16px;">
                <div style="text-align:center;">
                    <div style="font-size:2.5rem;font-weight:800;color:var(--${tone === 'good' ? 'secondary' : tone === 'bad' ? 'danger' : 'brand'});">${score}</div>
                    <div style="font-size:12px;color:var(--text-muted);">Overall Score</div>
                </div>
                <div style="flex:1;">
                    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                        <span style="font-size:12px;color:var(--text-muted);min-width:80px;">Confidence</span>
                        <div style="flex:1;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
                            <div style="width:${confidence}%;height:100%;background:${confidence >= 60 ? 'var(--secondary)' : confidence >= 30 ? 'var(--brand)' : 'var(--danger)'};border-radius:4px;"></div>
                        </div>
                        <span style="font-size:12px;font-weight:600;">${confidence}%</span>
                    </div>
                    <p style="font-size:12px;color:var(--text-muted);margin:0;">
                        ${confidence >= 60 ? 'High confidence — score based on multiple data signals.' 
                          : confidence >= 30 ? 'Moderate confidence — add page URLs for deeper analysis.' 
                          : 'Low confidence — provide both page URLs to get reliable scores.'}
                    </p>
                </div>
            </div>
            ${factorRows ? `<div style="border-top:1px solid var(--border);padding-top:12px;">
                <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Score Breakdown (you vs competitor)</h4>
                ${factorRows}
            </div>` : ''}
        </div>
    </div>`;
}

function renderEntityCoverageSection(entity) {
    const coveragePct = entity.coveragePct || 0;
    const barColor = coveragePct >= 70 ? 'var(--secondary)' : coveragePct >= 40 ? 'var(--brand)' : 'var(--danger)';

    const missingTags = (entity.missingFromMine || []).slice(0, 8)
        .map(e => `<span class="tag tag-outline" style="font-size:11px;">${escapeHtml(e.word)}</span>`).join(' ');

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-tags"></i> Entity & Topic Coverage</h3>
            <span class="header-hint">Keywords and topics your competitor covers that you don't</span>
        </div>
        <div class="card-body">
            <div style="display:flex;gap:20px;margin-bottom:16px;">
                <div style="flex:1;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Your entities</div>
                    <div style="font-size:1.5rem;font-weight:700;">${entity.myEntityCount || 0}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Competitor entities</div>
                    <div style="font-size:1.5rem;font-weight:700;">${entity.competitorEntityCount || 0}</div>
                </div>
                <div style="flex:1;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Shared</div>
                    <div style="font-size:1.5rem;font-weight:700;">${entity.sharedCount || 0}</div>
                </div>
                <div style="flex:2;">
                    <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px;">Coverage</div>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;height:10px;background:var(--border);border-radius:5px;overflow:hidden;">
                            <div style="width:${coveragePct}%;height:100%;background:${barColor};border-radius:5px;"></div>
                        </div>
                        <span style="font-size:14px;font-weight:700;">${coveragePct}%</span>
                    </div>
                </div>
            </div>
            ${missingTags ? `<div style="border-top:1px solid var(--border);padding-top:12px;">
                <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Topics missing from your page</h4>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">${missingTags}</div>
            </div>` : ''}
        </div>
    </div>`;
}

function renderSchemaValidationSection(schema) {
    const myTypes = schema.mine?.types || [];
    const compTypes = schema.competitor?.types || [];
    const gapTypes = schema.schemaGap || [];

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-code"></i> Schema & Structured Data</h3>
        </div>
        <div class="card-body">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                <div>
                    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">YOUR SCHEMA</div>
                    ${myTypes.length ? myTypes.map(t => `<span class="tag" style="margin:2px;">${escapeHtml(t)}</span>`).join(' ')
                      : '<span style="color:var(--text-muted);font-size:13px;">No schema detected</span>'}
                    <div style="margin-top:6px;font-size:12px;color:${schema.mine?.isValid ? 'var(--secondary)' : 'var(--danger)'};">
                        ${schema.mine?.isValid ? 'Valid' : schema.mine?.errors?.length ? `${schema.mine.errors.length} error(s)` : 'Unknown'}
                    </div>
                </div>
                <div>
                    <div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:8px;">COMPETITOR SCHEMA</div>
                    ${compTypes.length ? compTypes.map(t => `<span class="tag" style="margin:2px;">${escapeHtml(t)}</span>`).join(' ')
                      : '<span style="color:var(--text-muted);font-size:13px;">No schema detected</span>'}
                    <div style="margin-top:6px;font-size:12px;color:${schema.competitor?.isValid ? 'var(--secondary)' : 'var(--danger)'};">
                        ${schema.competitor?.isValid ? 'Valid' : 'Has errors'}
                    </div>
                </div>
            </div>
            ${gapTypes.length ? `<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:12px;">
                <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text-muted);">Schema types to add</h4>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${gapTypes.map(t => `<span class="tag tag-outline" style="border-color:var(--danger);color:var(--danger);">${escapeHtml(t)}</span>`).join('')}
                </div>
            </div>` : ''}
        </div>
    </div>`;
}

function renderEEATSection(eat) {
    const mine = eat.mine || {};
    const comp = eat.competitor || {};
    const scoreColor = (v) => v ? 'var(--secondary)' : 'var(--danger)';

    const signals = [
        ['H1 Tag', mine.hasH1, comp.hasH1],
        ['Meta Description', mine.hasMetaDescription, comp.hasMetaDescription],
        ['Author Info', mine.hasAuthor, comp.hasAuthor],
        ['Schema Markup', mine.hasSchema, comp.hasSchema],
        ['Breadcrumbs', mine.hasBreadcrumb, comp.hasBreadcrumb],
        ['FAQ Section', mine.hasFaq, comp.hasFaq],
    ];

    const rows = signals.map(([label, my, co]) => `
        <tr>
            <td style="font-size:13px;">${label}</td>
            <td style="text-align:center;color:${scoreColor(my)};">${my ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>'}</td>
            <td style="text-align:center;color:${scoreColor(co)};">${co ? '<i class="fas fa-check"></i>' : '<i class="fas fa-times"></i>'}</td>
        </tr>
    `).join('');

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-shield-halved"></i> E-E-A-T Signals</h3>
            <span class="header-hint">Experience, Expertise, Authoritativeness, Trustworthiness</span>
        </div>
        <div class="card-body">
            <div style="display:flex;gap:20px;margin-bottom:16px;">
                <div style="text-align:center;">
                    <div style="font-size:1.8rem;font-weight:700;">${mine.score || 0}</div>
                    <div style="font-size:12px;color:var(--text-muted);">Your E-E-A-T</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:1.8rem;font-weight:700;">${comp.score || 0}</div>
                    <div style="font-size:12px;color:var(--text-muted);">Competitor</div>
                </div>
            </div>
            <table class="data-table" style="width:100%;">
                <thead><tr><th>Signal</th><th style="text-align:center;">You</th><th style="text-align:center;">Competitor</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function renderPageSpeedSection(ps) {
    const mine = ps.mine || {};
    const comp = ps.competitor || {};
    const diffs = ps.differences || {};

    const scoreColor = (v) => v == null ? 'var(--text-muted)' : v >= 90 ? 'var(--secondary)' : v >= 50 ? 'var(--brand)' : 'var(--danger)';

    const fmtMs = (v) => v ? `${(v / 1000).toFixed(1)}s` : '-';
    const fmtCls = (v) => v != null ? v.toFixed(3) : '-';

    const metrics = [
        ['Performance', mine.performance, comp.performance, '/100', v => v ?? '-'],
        ['LCP', mine.lcp, comp.lcp, '', fmtMs],
        ['CLS', mine.cls, comp.cls, '', fmtCls],
        ['INP', mine.inp, comp.inp, 'ms', v => v ?? '-'],
    ];

    const rows = metrics.map(([label, my, co, unit, fmt]) => {
        const w = diffs[label.toLowerCase()]?.winner;
        const myStyle = w === 'mine' ? 'font-weight:700;color:var(--secondary)' : '';
        const coStyle = w === 'competitor' ? 'font-weight:700;color:var(--secondary)' : '';
        return `<tr>
            <td style="font-size:13px;">${label}</td>
            <td style="text-align:center;font-size:14px;${myStyle}">${fmt(my)}${unit}</td>
            <td style="text-align:center;font-size:14px;${coStyle}">${fmt(co)}${unit}</td>
        </tr>`;
    }).join('');

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-gauge-high"></i> PageSpeed & Core Web Vitals</h3>
        </div>
        <div class="card-body">
            <table class="data-table" style="width:100%;">
                <thead><tr><th>Metric</th><th style="text-align:center;">You</th><th style="text-align:center;">Competitor</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;
}

function renderBenchmarksSection(benchmarks, comparison) {
    const myPage = comparison.myPage || {};
    const wc = benchmarks.wordCount || {};
    const da = benchmarks.domainAuthority || {};
    const il = benchmarks.internalLinks || {};

    const compareRow = (label, myVal, avg, unit) => {
        const diff = (myVal || 0) - (avg || 0);
        const color = diff >= 0 ? 'var(--secondary)' : 'var(--danger)';
        const sign = diff >= 0 ? '+' : '';
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border);">
            <span style="font-size:13px;color:var(--text);">${label}</span>
            <span style="font-size:13px;">
                <strong>${(myVal || 0).toLocaleString()}</strong> ${unit}
                <span style="color:${color};margin-left:8px;font-weight:600;">(${sign}${Math.round(diff)} vs avg)</span>
            </span>
        </div>`;
    };

    return `<div class="card phase2-section" style="margin-top:20px;">
        <div class="card-header">
            <h3><i class="fas fa-chart-bar"></i> Top-${benchmarks.count || 10} Competitor Benchmarks</h3>
            <span class="header-hint">How you compare to the average of the top-ranking pages</span>
        </div>
        <div class="card-body">
            ${compareRow('Word Count', myPage.wordCount, wc.average, 'words')}
            ${compareRow('Domain Authority', comparison.scores?.domainAuthority?.mine, da.average, 'DA')}
            ${compareRow('Internal Links', myPage.internalLinks, il.average, 'links')}
            <div style="margin-top:12px;padding:10px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--text-muted);">
                <strong>Benchmark data:</strong> Based on ${benchmarks.count || 0} top-ranking competitors.
                Median word count: ${wc.median || 0} | Median DA: ${da.median || 0}
            </div>
        </div>
    </div>`;
}


let rankSetupChecklistContext = null;

async function loadProjectOptions(selectId, { includeAllLabel = 'All projects' } = {}) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    try {
        const data = await api('/api/projects');
        const projects = data.projects || [];
        const current = select.value;
        select.innerHTML = `<option value="">${includeAllLabel}</option>` + projects.map(project => `
            <option value="${escapeHtml(project.id)}" data-domain="${escapeHtml(project.tracking_domain || project.website_url || '')}">${escapeHtml(project.client_name)} · ${escapeHtml(project.name)}</option>
        `).join('');
        if (current && projects.some(project => String(project.id) === String(current))) select.value = current;
        return projects;
    } catch (err) {
        console.error('Failed to load project options:', err);
        return [];
    }
}

async function initRankTrackingPage() {
    await loadProjectOptions('rankProjectSelect');
    await loadTrackedDomains();
    await loadRankSetupChecklist();
}

async function loadCompetitorProjectFilters() {
    await loadProjectOptions('competitorProjectSelect');
}

async function loadAlertProjectFilters() {
    await loadProjectOptions('alertProjectSelect');
}

async function handleRankProjectChange() {
    const selected = document.getElementById('rankProjectSelect');
    const btn = document.getElementById('checkProjectRankingsBtn');
    if (btn) btn.disabled = !selected?.value;
    await loadCurrentRankings(1);
    await loadRankSetupChecklist();
}

async function loadRankSetupChecklist() {
    const projectId = document.getElementById('rankProjectSelect')?.value || '';
    const container = document.getElementById('rankSetupChecklist');
    if (!container) return;
    if (!projectId) {
        container.innerHTML = '<p class="text-muted">Select a project to see the guided SEO launch checklist.</p>';
        return;
    }
    try {
        const data = await api(`/api/projects/${encodeURIComponent(projectId)}/setup-checklist`);
        const items = data.checklist || [];
        rankSetupChecklistContext = { projectId: data.projectId, clientId: data.clientId, domain: data.domain, checklist: items };
        const tone = status => status === 'complete' ? 'success' : status === 'required' ? 'danger' : 'warning';
        container.innerHTML = `
            <div class="card" style="background:var(--bg);">
                <div class="card-body">
                    <div style="font-weight:700;margin-bottom:10px;">Guided project launch checklist</div>
                    <div style="display:grid;gap:8px;">
                        ${items.map(item => `
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;border-bottom:1px solid var(--border);padding:8px 0;">
                                <div>
                                    <strong>${escapeHtml(item.label)}</strong>
                                    <div class="text-muted" style="font-size:.8rem;">${escapeHtml(item.action)}</div>
                                </div>
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                                    <span class="badge badge-${tone(item.status)}">${escapeHtml(item.status)}</span>
                                    ${item.actionPage ? `<button class="btn btn-sm btn-outline" type="button" onclick="runProjectSetupAction('${escapeHtml(item.id)}')">${escapeHtml(item.actionLabel || 'Open')}</button>` : ''}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>`;
    } catch (err) {
        container.innerHTML = `<p class="text-muted">Could not load checklist: ${escapeHtml(err.message)}</p>`;
    }
}

async function checkSelectedProjectRankings() {
    const projectId = document.getElementById('rankProjectSelect')?.value || '';
    if (!projectId) return showError('Select a project first.');
    try {
        showLoading();
        const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/rankings/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        hideLoading();
        if (!res.ok || data.error) throw new Error(data.error || 'Rank check failed');
        showSuccess(`Project rank check complete: ${data.succeeded || 0} checked`);
        await loadCurrentRankings(1);
        await loadRankSetupChecklist();
        await refreshAlertBadge();
    } catch (err) {
        hideLoading();
        showError(err.message);
    }
}


function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setSelectValue(selector, value, { dispatch = true, attempts = 12 } = {}) {
    if (!value) return false;
    for (let i = 0; i < attempts; i++) {
        const select = document.querySelector(selector);
        if (select && Array.from(select.options || []).some(option => String(option.value) === String(value))) {
            select.value = value;
            if (dispatch) select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        await delay(120);
    }
    return false;
}

function currentProjectSetupContext() {
    const selected = document.getElementById('rankProjectSelect');
    const option = selected?.options?.[selected.selectedIndex];
    return {
        projectId: rankSetupChecklistContext?.projectId || selected?.value || '',
        clientId: rankSetupChecklistContext?.clientId || '',
        domain: rankSetupChecklistContext?.domain || option?.dataset?.domain || '',
        checklist: rankSetupChecklistContext?.checklist || [],
    };
}

async function openProjectSetupChecklist(project) {
    const projectId = project?.id || project?.projectId || '';
    if (!projectId) return;
    navigateTo('tracking');
    await initRankTrackingPage();
    const select = document.getElementById('rankProjectSelect');
    if (select) {
        select.value = projectId;
        await handleRankProjectChange();
    }
}

async function runProjectSetupAction(actionId) {
    const ctx = currentProjectSetupContext();
    const item = (ctx.checklist || []).find(entry => entry.id === actionId) || {};
    const projectId = ctx.projectId;
    const clientId = ctx.clientId;
    const domain = ctx.domain;

    if (!projectId) return showError('Select a project first.');
    if (item.actionType === 'run-rank-check') return checkSelectedProjectRankings();

    switch (item.actionPage) {
        case 'research':
            navigateTo('research');
            if (typeof loadResearchProjects === 'function') await loadResearchProjects();
            await setSelectValue('#researchProjectSelect', projectId, { dispatch: false });
            break;
        case 'onpage':
            navigateTo('onpage');
            if (typeof initOnPageProjects === 'function') await initOnPageProjects();
            await setSelectValue('#onpage-project-select', projectId);
            if (domain && !document.getElementById('onpage-url-input')?.value) document.getElementById('onpage-url-input').value = domain.startsWith('http') ? domain : `https://${domain}`;
            break;
        case 'technical':
            navigateTo('technical');
            if (domain) document.getElementById('technical-site-input').value = domain.startsWith('http') ? domain : `https://${domain}`;
            if (document.getElementById('technical-check-security-headers')) document.getElementById('technical-check-security-headers').checked = true;
            break;
        case 'page-speed':
            navigateTo('page-speed');
            if (typeof loadPageSpeedClients === 'function') await loadPageSpeedClients();
            await setSelectValue('#pagespeed-client-select', clientId);
            if (domain) document.getElementById('pagespeed-url-input').value = domain.startsWith('http') ? domain : `https://${domain}`;
            break;
        case 'search-visibility':
            navigateTo('search-visibility');
            if (typeof initSearchVisibilityPage === 'function') await initSearchVisibilityPage();
            if (await setSelectValue('#svClientSelect', clientId)) {
                if (typeof loadSearchVisibilityData === 'function') await loadSearchVisibilityData();
                await setSelectValue('#svProjectSelect', projectId, { dispatch: false });
            }
            if (item.actionType === 'gsc' && domain && document.getElementById('svGscSiteUrl')) document.getElementById('svGscSiteUrl').value = domain.startsWith('http') ? domain : `https://${domain}`;
            break;
        case 'competitors':
            navigateTo('competitors');
            await loadCompetitorProjectFilters();
            await setSelectValue('#competitorProjectSelect', projectId, { dispatch: false });
            await loadTopCompetitors(1);
            break;
        case 'tasks':
            navigateTo('tasks');
            if (typeof initTasksPage === 'function') initTasksPage();
            if (await setSelectValue('#taskClientSelect', clientId)) {
                await delay(250);
                await setSelectValue('#taskProjectSelect', projectId);
            }
            break;
        case 'clients':
            navigateTo('clients');
            if (clientId) await setSelectValue('#projectClientSelect', clientId);
            break;
        default:
            if (item.actionPage) navigateTo(item.actionPage);
    }
}

// ─── Rank Tracking ─── (uses new POST /api/domains)
$('#trackDomainBtn')?.addEventListener('click', async () => {
    const domain = $('#trackDomainInput').value.trim();
    if (!domain) {
        showError('Please enter a domain to track');
        return;
    }

    try {
        const result = await fetch(`${API_BASE}/api/domains`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, projectId: document.getElementById('rankProjectSelect')?.value || undefined }),
        });
        const data = await result.json();
        if (data.error) throw new Error(data.error);
        $('#trackDomainInput').value = '';
        loadTrackedDomains();
        showSuccess(`Now tracking ${domain}`);
    } catch (err) {
        showError(`Failed to add domain: ${err.message}`);
        console.error('Failed to track domain:', err);
    }
});

async function loadTrackedDomains() {
    try {
        // Use new GET /api/domains endpoint
        const res = await fetch(`${API_BASE}/api/domains`);
        const data = await res.json();
        const domains = data.domains || [];
        renderTrackedDomains(domains);

        // Populate domain filter dropdown
        populateRankDomainFilter(domains);
        const btn = document.getElementById('checkProjectRankingsBtn');
        if (btn) btn.disabled = !document.getElementById('rankProjectSelect')?.value;

        // Load current rankings (deduplicated) for all domains
        loadCurrentRankings(1);
    } catch (err) {
        console.error('Failed to load tracked domains:', err);
    }
}

// ─── Populate Domain Filter for Rank Table ───
function populateRankDomainFilter(domains) {
    const sel = $('#rankDomainFilter');
    if (!sel) return;
    sel.innerHTML = '<option value="">All Domains</option>' +
        domains.map(d => `<option value="${d.domain}">${d.domain}</option>`).join('');
}

// ─── Current Rankings (deduplicated, paginated) ───
async function loadCurrentRankings(page = 1) {
    PG.history.page = page;
    const offset = (page - 1) * PG.history.perPage;
    const domainFilter = $('#rankDomainFilter')?.value || '';
    const projectFilter = $('#rankProjectSelect')?.value || '';
    const domainParam = domainFilter ? `&domain=${encodeURIComponent(domainFilter)}` : '';
    const projectParam = projectFilter ? `&projectId=${encodeURIComponent(projectFilter)}` : '';
    try {
        const res = await fetch(`${API_BASE}/api/rankings/current?limit=${PG.history.perPage}${domainParam}${projectParam}&offset=${offset}`);
        const data = await res.json();
        PG.history.total = data.total || 0;
        renderCurrentRankings(data.rankings || []);
        renderPagination('rankHistoryPagination', PG.history, loadCurrentRankings);
    } catch (err) {
        console.error('Failed to load current rankings:', err);
    }
}

// kept for backward compat (alerts page history still uses this)
async function loadRankHistory(page = 1) {
    return loadCurrentRankings(page);
}

function renderTrackedDomains(domains) {
    const tbody = $('#trackedDomainsTable tbody');
    if (!domains.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No domains tracked yet. Add your first domain above.</td></tr>';
        return;
    }

    tbody.innerHTML = domains.map(d => `
        <tr>
            <td class="domain"><strong>${d.domain}</strong></td>
            <td>${d.keyword_count || 0}</td>
            <td>
                <span style="color:var(--secondary);font-weight:600;">
                    <i class="fas fa-arrow-up"></i> ${d.improved_count || 0}
                </span>
            </td>
            <td>
                <span style="color:var(--danger);font-weight:600;">
                    <i class="fas fa-arrow-down"></i> ${d.dropped_count || 0}
                </span>
            </td>
            <td style="display:flex;gap:6px;">
                <button class="btn btn-sm btn-outline" onclick="viewDomainRankings('${d.domain}')" title="View Rankings">
                    <i class="fas fa-chart-bar"></i>
                </button>
                <button class="btn btn-sm btn-outline" onclick="checkDomainRankings('${d.domain}')" title="Check Rankings">
                    <i class="fas fa-sync"></i>
                </button>
                <button class="btn btn-sm btn-outline text-danger" onclick="deleteTrackedDomain('${d.domain}')" title="Delete Domain">
                    <i class="fas fa-trash"></i>
                </button>
            </td>
        </tr>
    `).join('');
}


function renderCurrentRankings(rankings) {
    const tbody = $('#rankHistoryTable tbody');
    if (!rankings.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No rankings yet. Select a project and run a rank check.</td></tr>';
        return;
    }

    tbody.innerHTML = rankings.map(r => `
        <tr>
            <td>
                <strong>${r.keyword}</strong>
                ${r.location ? `<div class="text-muted" style="font-size:0.75rem;"><i class="fas fa-map-marker-alt" style="font-size:0.7rem;"></i> ${r.location}</div>` : ''}
            </td>
            <td class="domain">
                <a href="https://${r.domain}" target="_blank" rel="noopener" class="domain-link">${r.domain}</a>
            </td>
            <td>${r.project_name ? escapeHtml(r.project_name) : '<span class="text-muted">Legacy</span>'}</td>
            <td>
                ${r.rank_position > 0
                    ? `<span class="badge badge-${r.rank_position <= 3 ? 'low' : r.rank_position <= 10 ? 'medium' : 'high'}">#${r.rank_position}</span>`
                    : '<span class="text-muted">-</span>'}
            </td>
            <td>${formatTimeAgo(r.checked_at)}</td>
        </tr>
    `).join('');
}

// backward compat alias
function renderRankHistory(history) { renderCurrentRankings(history); }

async function checkDomainRankings(domain) {
    try {
        showLoading();
        showSuccess(`Checking rankings for ${domain}... (this may take a while)`);
        const result = await fetch(`${API_BASE}/api/rankings/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ domain, projectId: document.getElementById('rankProjectSelect')?.value || undefined }),
        });
        const data = await result.json();
        hideLoading();
        if (data.error) {
            showError(data.error);
        } else {
            showSuccess(`Rank check complete for ${domain}`);
            loadTrackedDomains();
        }
    } catch (err) {
        hideLoading();
        console.error('Rank check failed:', err);
        showError('Rank check failed. Please try again.');
    }
}

// ─── View Domain Rankings (uses new GET /api/rankings/:domain) ───
async function viewDomainRankings(domain) {
    const modal = $('#competitorAnalysisModal');
    const content = $('#competitorAnalysisContent');
    const modalTitle = modal.querySelector('.modal-header h3');
    if (modalTitle) modalTitle.textContent = `📈 Rankings: ${domain}`;

    content.innerHTML = `<div class="modal-loading"><div class="spinner-small"></div><p>Loading rankings...</p></div>`;
    modal.classList.add('active');

    try {
        const res = await fetch(`${API_BASE}/api/rankings/${encodeURIComponent(domain)}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const rankings = data.rankings || [];

        content.innerHTML = `
            <div class="analysis-detail">
                <div class="modal-domain-header"><h4>${domain}</h4></div>
                <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:20px;">
                    <div class="stat-box">
                        <span class="label">Keywords Tracked</span>
                        <span class="value">${rankings.length}</span>
                    </div>
                    <div class="stat-box">
                        <span class="label">Currently Ranking</span>
                        <span class="value">${rankings.filter(r => r.rank_position > 0).length}</span>
                    </div>
                </div>
                <h5 class="section-title"><i class="fas fa-chart-bar"></i> Current Rankings</h5>
                ${rankings.length > 0 ? `
                    <table class="data-table">
                        <thead><tr><th>Keyword</th><th>Position</th><th>Volume</th></tr></thead>
                        <tbody>
                            ${rankings.map(r => `
                                <tr>
                                    <td><strong>${r.keyword}</strong></td>
                                    <td><span class="badge badge-${r.rank_position <= 3 ? 'low' : r.rank_position <= 10 ? 'medium' : 'high'}">#${r.rank_position}</span></td>
                                    <td>${formatNumber(r.search_volume)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="text-center text-muted">No rankings yet. Click "Check" to run a rank check.</p>'}
            </div>
        `;
    } catch (err) {
        content.innerHTML = `<div class="modal-error"><i class="fas fa-exclamation-triangle"></i><h4>Failed to Load</h4><p>${err.message}</p></div>`;
    }
}

// ─── Alerts Page (paginated) ───
async function loadAlerts(page = 1) {
    PG.alerts.page = page;
    const offset = (page - 1) * PG.alerts.perPage;
    try {
        const activeFilter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
        const unreadParam = activeFilter === 'unread' ? '&unreadOnly=true' : '';
        const typeParam = (activeFilter !== 'all' && activeFilter !== 'unread') ? `&type=${activeFilter}` : '';
        const projectId = document.getElementById('alertProjectSelect')?.value || '';
        const projectParam = projectId ? `&projectId=${encodeURIComponent(projectId)}` : '';

        const res = await fetch(`${API_BASE}/api/alerts?limit=${PG.alerts.perPage}&offset=${offset}${unreadParam}${typeParam}${projectParam}`);
        const data = await res.json();
        PG.alerts.total = data.total || 0;

        renderAlerts(data.alerts || [], activeFilter);
        renderPagination('alertsPagination', PG.alerts, loadAlerts);

        // Update badge from fresh data
        const badge = $('#alertBadge');
        if (badge) {
            badge.textContent = data.unreadCount || 0;
            badge.style.display = data.unreadCount > 0 ? 'inline' : 'none';
        }
    } catch (err) {
        console.error('Failed to load alerts:', err);
    }
}


function renderAlerts(alerts, activeFilter = 'all') {
    const container = $('#alertsListFull');
    if (!alerts.length) {
        const msg = activeFilter === 'all' ? 'No alerts yet. Alerts will appear here when rank changes are detected.' : `No ${activeFilter.replace('_', ' ')} alerts.`;
        container.innerHTML = `<p class="text-center text-muted" style="padding:40px 0">${msg}</p>`;
        return;
    }

    // Client-side type filter for types not supported server-side
    const filtered = activeFilter === 'all' || activeFilter === 'unread'
        ? alerts
        : alerts.filter(a => a.alert_type === activeFilter);

    container.innerHTML = filtered.map(alert => `
        <div class="alert-item ${alert.is_read ? '' : 'unread'}" data-type="${alert.alert_type}">
            <div class="alert-icon ${getAlertIconClass(alert.alert_type)}">
                <i class="fas ${getAlertIcon(alert.alert_type)}"></i>
            </div>
            <div class="alert-content">
                <div class="alert-message">${alert.message}</div>
                <div class="alert-meta">
                    <span class="alert-time">${formatTimeAgo(alert.created_at)}</span>
                    ${alert.keyword ? `<span class="alert-keyword">📍 ${alert.keyword}</span>` : ''}
                    ${alert.domain ? `<span class="alert-domain">${alert.domain}</span>` : ''}
                    ${alert.project_name ? `<span class="alert-domain">${escapeHtml(alert.project_name)}</span>` : ''}
                    ${alert.severity ? `<span class="badge">${escapeHtml(alert.severity)}</span>` : ''}
                </div>
            </div>
            ${!alert.is_read ? `
                <button class="btn btn-sm btn-outline" onclick="markAlertRead(${alert.id})" title="Mark as read">
                    <i class="fas fa-check"></i>
                </button>
            ` : ''}
        </div>
    `).join('');
}

// Filter alerts — reload from server
$$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        $$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadAlerts(1); // Reload from page 1 with new filter
    });
});


async function markAlertRead(id) {
    try {
        await fetch(`${API_BASE}/api/alerts/${id}/read`, { method: 'PUT' });
        loadAlerts(PG.alerts.page); // Stay on current page
        refreshAlertBadge();
    } catch (err) {
        console.error('Failed to mark alert:', err);
    }
}

$('#markAllReadBtn')?.addEventListener('click', async () => {
    try {
        await fetch(`${API_BASE}/api/alerts/read-all`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        loadAlerts(1);
        refreshAlertBadge();
        showSuccess('All alerts marked as read');
    } catch (err) {
        console.error('Failed to mark alerts:', err);
    }
});

// ─── Pagination Helper ───
function renderPagination(containerId, pg, loadFn) {
    const container = $(`#${containerId}`);
    if (!container) return;
    
    const totalPages = Math.ceil(pg.total / pg.perPage) || 1;
    
    if (!pg.total) {
        container.innerHTML = '';
        return;
    }

    const startItem = (pg.page - 1) * pg.perPage + 1;
    const endItem = Math.min(pg.page * pg.perPage, pg.total);

    // Always show first, last, and 2 pages around current
    const range = new Set([1, totalPages]);
    for (let i = Math.max(1, pg.page - 2); i <= Math.min(totalPages, pg.page + 2); i++) range.add(i);
    const sorted = [...range].sort((a, b) => a - b);

    let html = `<div class="pagination">`;
    html += `<span class="pg-info">${startItem}–${endItem} of ${pg.total}</span>`;

    // Prev button
    html += `<button class="pg-btn" data-page="${pg.page - 1}" ${pg.page === 1 ? 'disabled' : ''}>
        <i class="fas fa-chevron-left"></i>
    </button>`;

    let prev = 0;
    for (const p of sorted) {
        if (prev && p > prev + 1) html += `<span class="pg-ellipsis">…</span>`;
        html += `<button class="pg-btn ${p === pg.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
        prev = p;
    }

    // Next button
    html += `<button class="pg-btn" data-page="${pg.page + 1}" ${pg.page === totalPages ? 'disabled' : ''}>
        <i class="fas fa-chevron-right"></i>
    </button>`;

    html += `</div>`;
    container.innerHTML = html;

    // Add click handlers using event delegation
    container.onclick = (e) => {
        const btn = e.target.closest('.pg-btn[data-page]');
        if (btn && !btn.disabled) {
            const newPage = parseInt(btn.dataset.page);
            loadFn(newPage);
        }
    };
}

// ─── Helpers ───
function formatNumber(num) {
    if (!num) return '0';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function formatTimeAgo(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.slice(0, len) + '...' : str;
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function capitalize(value) {
    const text = String(value || '');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function getAlertIcon(type) {
    const icons = {
        rank_drop: 'fa-arrow-down',
        rank_improvement: 'fa-arrow-up',
        new_ranking: 'fa-star',
        lost_ranking: 'fa-times-circle',
    };
    return icons[type] || 'fa-bell';
}

function getAlertIconClass(type) {
    const classes = {
        rank_drop: 'drop',
        rank_improvement: 'up',
        new_ranking: 'new',
        lost_ranking: 'drop',
    };
    return classes[type] || '';
}

function getChangeClass(direction) {
    const classes = {
        up: 'low',
        down: 'high',
        same: 'medium',
        new: 'low',
        lost: 'high',
    };
    return classes[direction] || 'medium';
}

function getChangeIcon(direction) {
    const icons = {
        up: '↑',
        down: '↓',
        same: '→',
        new: '★',
        lost: '✗',
    };
    return icons[direction] || '→';
}

function showLoading() {
    $('#loadingOverlay')?.classList.add('active');
}

function hideLoading() {
    $('#loadingOverlay')?.classList.remove('active');
}

function showError(message) {
    showToast(message, 'error');
}

function showSuccess(message) {
    showToast(message, 'success');
}

function showToast(message, type = 'info') {
    const container = $('#toastContainer');
    if (!container) return;

    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        info: 'fa-info-circle',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${message}</span>`;

    container.appendChild(toast);

    // Auto remove after 4s
    const timer = setTimeout(() => removeToast(toast), 4000);

    // Click to dismiss early
    toast.addEventListener('click', () => {
        clearTimeout(timer);
        removeToast(toast);
    });
}

function removeToast(toast) {
    toast.classList.add('removing');
    toast.addEventListener('animationend', () => toast.remove());
}

async function deleteTrackedDomain(domain) {
    if (!confirm(`Are you sure you want to stop tracking ${domain}? This will delete all ranking history for this domain.`)) {
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/domains?domain=${encodeURIComponent(domain)}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        
        if (data.success) {
            showSuccess(data.message);
            loadTrackedDomains();
        } else {
            showError(data.error || 'Failed to delete domain');
        }
    } catch (err) {
        console.error('Failed to delete domain:', err);
        showError('Network error while deleting domain');
    }
}

// ─── SEO Client Workspace ───
$('#saveClientBtn')?.addEventListener('click', saveSeoClient);
$('#saveProjectBtn')?.addEventListener('click', saveSeoProject);
$('#refreshClientsBtn')?.addEventListener('click', loadClientWorkspace);
$('#projectClientSelect')?.addEventListener('change', () => loadClientProjects($('#projectClientSelect').value));

async function loadClientWorkspace() {
    await loadSeoClients();
    await loadResearchProjects();
}

async function loadSeoClients() {
    try {
        const data = await api('/api/clients');
        seoClientsCache = data.clients || [];
        renderSeoClients(seoClientsCache);
        populateClientSelect();

        const selectedClientId = $('#projectClientSelect')?.value || seoClientsCache[0]?.id || '';
        if (selectedClientId) {
            $('#projectClientSelect').value = selectedClientId;
            await loadClientProjects(selectedClientId);
        }
    } catch (err) {
        console.error('Failed to load clients:', err);
        const list = $('#clientsList');
        if (list) list.innerHTML = '<p class="text-muted">Could not load clients.</p>';
    }
}

function populateClientSelect() {
    const select = $('#projectClientSelect');
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="">Choose a client</option>' + seoClientsCache.map(client => `
        <option value="${client.id}">${escapeHtml(client.name)}</option>
    `).join('');

    if (current && seoClientsCache.some(client => client.id === current)) {
        select.value = current;
    }
}

function renderSeoClients(clients) {
    const container = $('#clientsList');
    if (!container) return;

    if (!clients.length) {
        container.innerHTML = '<p class="text-center text-muted">No clients yet. Add your first SEO client above.</p>';
        return;
    }

    container.innerHTML = clients.map(client => {
        const locations = Array.isArray(client.target_locations) ? client.target_locations : [];
        const competitors = Array.isArray(client.competitors) ? client.competitors : [];
        const services = Array.isArray(client.services) ? client.services : [];
        return `
            <div class="client-card" data-client-id="${client.id}">
                <div class="client-card-main">
                    <div>
                        <h4>${escapeHtml(client.name)}</h4>
                        <p>${escapeHtml(client.industry || 'No industry set')} ${client.website_url ? `· <a href="${escapeHtml(client.website_url)}" target="_blank" rel="noopener">${escapeHtml(client.website_url)}</a>` : ''}</p>
                    </div>
                    <div style="display:flex;gap:12px;align-items:center;">
                        <select class="form-control assign-client-select" data-client-id="${client.id}" style="font-size:12px;padding:7px 12px;max-width:160px;min-height:36px;">
                            <option value="">Unassigned</option>
                        </select>
                        <button class="btn btn-sm btn-primary client-select-btn" data-client-id="${client.id}" style="min-height:36px;">Use</button>
                    </div>
                </div>
                <div class="client-meta-grid">
                    <span><strong>${client.project_count || 0}</strong> projects</span>
                    <span><strong>${client.keyword_count || 0}</strong> keywords</span>
                    <span>${client.assigned_email ? `👤 ${escapeHtml(client.assigned_email)}` : escapeHtml(locations.slice(0, 3).join(', ') || 'No locations')}</span>
                </div>
                <div class="client-tags">
                    ${services.slice(0, 5).map(service => `<span class="tag tag-outline">${escapeHtml(service)}</span>`).join('')}
                    ${competitors.slice(0, 4).map(domain => `<span class="tag">${escapeHtml(domain)}</span>`).join('')}
                </div>
                ${client.goals ? `<p class="client-goals">${escapeHtml(truncate(client.goals, 180))}</p>` : ''}
            </div>
        `;
    }).join('');

    $$('.client-select-btn').forEach(button => {
        button.addEventListener('click', () => selectSeoClient(button.dataset.clientId));
    });

    // Populate assign dropdowns with agency members
    loadMembersForAssignment();
}

function selectSeoClient(clientId) {
    const client = seoClientsCache.find(item => item.id === clientId);
    if (!client) return;

    $('#clientIdInput').value = client.id;
    $('#clientNameInput').value = client.name || '';
    $('#clientWebsiteInput').value = client.website_url || '';
    $('#clientIndustryInput').value = client.industry || '';
    $('#clientLocationsInput').value = Array.isArray(client.target_locations) ? client.target_locations.join(', ') : '';
    $('#clientCompetitorsInput').value = Array.isArray(client.competitors) ? client.competitors.join(', ') : '';
    $('#clientServicesInput').value = Array.isArray(client.services) ? client.services.join(', ') : '';
    $('#clientAudienceInput').value = client.audience || '';
    $('#clientGoalsInput').value = client.goals || '';
    $('#projectClientSelect').value = client.id;
    loadClientProjects(client.id);
    showSuccess('Client loaded.');
}

// ─── Client Assignment ───
let agencyMembersCache = [];

async function loadMembersForAssignment() {
    try {
        if (!agencyMembersCache.length) {
            const data = await api('/api/clients/members');
            agencyMembersCache = data.members || [];
        }
        $$('.assign-client-select').forEach(select => {
            const clientId = select.dataset.clientId;
            const client = seoClientsCache.find(c => c.id === clientId);
            const currentAssigned = client?.assigned_to || '';

            // Only populate if not already populated
            if (select.options.length <= 1) {
                agencyMembersCache.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m.id;
                    opt.textContent = m.email;
                    if (m.id === currentAssigned) opt.selected = true;
                    select.appendChild(opt);
                });
            }

            // Remove old listener, add new one
            select.onchange = async () => {
                try {
                    await fetch(`/api/clients/${clientId}/assign`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: select.value || null }),
                    });
                    if (typeof showToast === 'function') showToast(select.value ? 'Client assigned' : 'Client unassigned', 'success');
                    loadSeoClients();
                } catch (err) {
                    if (typeof showToast === 'function') showToast(err.message, 'error');
                }
            };
        });
    } catch (err) {
        console.error('Failed to load members for assignment:', err);
    }
}

async function saveSeoClient() {
    const id = $('#clientIdInput')?.value || '';
    const name = $('#clientNameInput')?.value.trim() || '';
    if (!name) {
        showError('Client name is required.');
        return;
    }

    const payload = {
        name,
        websiteUrl: $('#clientWebsiteInput')?.value.trim() || '',
        industry: $('#clientIndustryInput')?.value.trim() || '',
        targetLocations: $('#clientLocationsInput')?.value.trim() || '',
        competitors: $('#clientCompetitorsInput')?.value.trim() || '',
        services: $('#clientServicesInput')?.value.trim() || '',
        audience: $('#clientAudienceInput')?.value.trim() || '',
        goals: $('#clientGoalsInput')?.value.trim() || '',
    };

    const endpoint = id ? `/api/clients/${id}` : '/api/clients';
    const method = id ? 'PUT' : 'POST';
    const data = await api(endpoint, { method, body: JSON.stringify(payload) });
    if (!data.success && !data.ok) {
        showError(data.error || 'Could not save client.');
        return;
    }

    $('#clientIdInput').value = data.client.id;
    showSuccess('Client saved.');
    await loadClientWorkspace();
}

async function saveSeoProject() {
    const clientId = $('#projectClientSelect')?.value || '';
    const name = $('#projectNameInput')?.value.trim() || '';

    if (!clientId) {
        showError('Choose a client first.');
        return;
    }
    if (!name) {
        showError('Project name is required.');
        return;
    }

    const payload = {
        name,
        projectType: $('#projectTypeInput')?.value || 'keyword-research',
        targetLocation: $('#projectLocationInput')?.value.trim() || '',
        goals: $('#projectGoalsInput')?.value.trim() || '',
    };

    const data = await api(`/api/clients/${clientId}/projects`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });

    if (!data.success && !data.ok) {
        showError(data.error || 'Could not save project.');
        return;
    }

    $('#projectNameInput').value = '';
    $('#projectGoalsInput').value = '';
    showSuccess('Project added. Opening setup checklist.');
    await loadClientProjects(clientId);
    await loadResearchProjects();
    await openProjectSetupChecklist(data.project);
}

async function loadClientProjects(clientId) {
    const container = $('#clientProjectsList');
    if (!container) return;

    if (!clientId) {
        container.innerHTML = '<p class="text-muted">Select a client to view projects.</p>';
        return;
    }

    try {
        const data = await api(`/api/clients/${clientId}/projects`);
        const projects = data.projects || [];

        if (!projects.length) {
            container.innerHTML = '<p class="text-muted">No projects yet for this client.</p>';
            return;
        }

        container.innerHTML = projects.map(project => `
            <div class="project-row">
                <div>
                    <strong>${escapeHtml(project.name)}</strong>
                    <div class="project-row-meta">${escapeHtml(project.project_type || 'keyword-research')} · ${escapeHtml(project.target_location || 'No location')} · ${project.keyword_count || 0} keywords</div>
                </div>
                <div class="project-score">
                    <span>${formatNumber(project.total_volume || 0)}</span>
                    <small>total volume</small>
                    <button class="btn btn-sm btn-outline pd-open-dashboard" data-project-id="${project.id}" style="margin-top:6px">
                        <i class="fas fa-tachometer-alt"></i> Dashboard
                    </button>
                </div>
            </div>
        `).join('');

        $$('.pd-open-dashboard').forEach(btn => {
            btn.addEventListener('click', () => openProjectDashboard(btn.dataset.projectId));
        });
    } catch (err) {
        console.error('Failed to load projects:', err);
        container.innerHTML = '<p class="text-muted">Could not load projects.</p>';
    }
}

async function loadResearchProjects() {
    const select = $('#researchProjectSelect');
    if (!select) return;

    try {
        const data = await api('/api/projects');
        seoProjectsCache = data.projects || [];
        const current = select.value;
        select.innerHTML = '<option value="">Do not attach to project</option>' + seoProjectsCache.map(project => `
            <option value="${project.id}">${escapeHtml(project.client_name)} · ${escapeHtml(project.name)}</option>
        `).join('');
        if (current && seoProjectsCache.some(project => project.id === current)) select.value = current;
    } catch (err) {
        console.error('Failed to load research projects:', err);
    }
}


// ─── Google Search Console Page ───
let gscClientsLoaded = false;
let gscClientConnections = [];

async function initGscPage() {
    await gscCheckStatus();
    await gscLoadClients();
    await gscLoadClientManager();
    await gscLoadSyncLog();
}

async function gscCheckStatus() {
    const warning = document.getElementById('gscSetupWarning');
    if (!warning) return;
    try {
        const res = await fetch('/api/gsc/status');
        const data = await res.json();
        warning.style.display = (data.success || data.ok) && data.configured ? 'none' : 'block';
    } catch (_) {
        warning.style.display = 'block';
    }
}

async function gscLoadClients() {
    const select = document.getElementById('gscClientSelect');
    if (!select) return;
    try {
        const res = await fetch('/api/gsc/clients');
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'Could not load GSC clients');
        gscClientConnections = data.clients || [];
        const previous = select.value;

        select.innerHTML = '<option value="">-- select a client --</option>' + gscClientConnections.map(client => `
            <option value="${escapeHtml(client.id)}" data-site="${escapeHtml(client.gsc_site_url || client.website_url || '')}">
                ${escapeHtml(client.name || client.company || 'Client')}${client.gsc_site_url ? ' - GSC connected' : ''}
            </option>
        `).join('');

        if (previous && gscClientConnections.some(client => String(client.id) === String(previous))) {
            select.value = previous;
        }

        if (!select.dataset.gscChangeBound) {
            select.addEventListener('change', () => {
                const option = select.options[select.selectedIndex];
                const input = document.getElementById('gscSiteUrlInput');
                if (input) input.value = option?.dataset?.site || '';
            });
            select.dataset.gscChangeBound = '1';
        }

        const selectedOption = select.options[select.selectedIndex];
        const input = document.getElementById('gscSiteUrlInput');
        if (input && selectedOption?.dataset?.site && !input.value) input.value = selectedOption.dataset.site;
        gscClientsLoaded = true;
    } catch (err) {
        showError(err.message || 'Could not load clients for GSC');
    }
}

async function gscLoadClientManager() {
    const container = document.getElementById('gscClientManagerList');
    if (!container) return;
    try {
        if (!gscClientsLoaded) await gscLoadClients();
        renderGscClientManager(gscClientConnections);
    } catch (err) {
        container.innerHTML = `<p style="color:#fca5a5;font-size:.85rem;margin:0;">${escapeHtml(err.message || 'Could not load client GSC connections')}</p>`;
    }
}

window.gscRefreshClientManager = async function gscRefreshClientManager() {
    gscClientsLoaded = false;
    await gscLoadClients();
    await gscLoadClientManager();
    await gscLoadSyncLog();
};

function renderGscClientManager(clients) {
    const container = document.getElementById('gscClientManagerList');
    if (!container) return;
    if (!clients.length) {
        container.innerHTML = '<p class="text-muted">No clients found. Add clients first, then connect each GSC property here.</p>';
        return;
    }

    const rows = clients.map(client => {
        const connected = Boolean(client.gsc_site_url);
        const syncText = client.last_synced_at ? new Date(client.last_synced_at).toLocaleDateString() : 'Not synced';
        return '<tr>' +
            '<td><strong>' + escapeHtml(client.name || client.company || 'Client') + '</strong><br><span class="text-muted" style="font-size:.78rem;display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(client.website_url || 'No website') + '</span></td>' +
            '<td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(client.gsc_site_url || '') + '">' + (connected ? escapeHtml(client.gsc_site_url) : '<span class="badge orange">Not connected</span>') + '</td>' +
            '<td>' + formatNumber(client.clicks || 0) + '</td>' +
            '<td>' + formatNumber(client.impressions || 0) + '</td>' +
            '<td><span class="text-muted">' + escapeHtml(syncText) + '</span></td>' +
            '<td style="text-align:right;white-space:nowrap;">' +
                '<button class="btn btn-sm btn-outline" onclick="gscSelectClient(\'' + escapeHtml(client.id) + '\')">Select</button> ' +
                '<button class="btn btn-sm btn-primary" onclick="gscSyncClient(\'' + escapeHtml(client.id) + '\')" ' + (connected ? '' : 'disabled') + '>Sync</button> ' +
                '<button class="btn btn-sm btn-outline" onclick="gscGenerateClientReport(\'' + escapeHtml(client.id) + '\')">Report</button> ' +
                '<button class="btn btn-sm btn-danger" onclick="gscDisconnect(\'' + escapeHtml(client.id) + '\')" ' + (connected ? '' : 'disabled') + '>Disconnect</button>' +
            '</td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div style="overflow:auto;"><table class="data-table premium" style="min-width:780px;"><thead><tr><th>Client</th><th>GSC Property</th><th>Clicks</th><th>Impressions</th><th>Last Sync</th><th style="text-align:right;">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}


async function gscLoadSyncLog(clientId = '') {
    const container = document.getElementById('gscSyncLogList');
    if (!container) return;
    try {
        const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}&limit=25` : '?limit=25';
        const res = await fetch(`/api/gsc/sync-log${qs}`);
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'Could not load GSC sync history');
        renderGscSyncLog(data.runs || []);
    } catch (err) {
        container.innerHTML = `<p style="color:#fca5a5;font-size:.85rem;margin:0;">${escapeHtml(err.message || 'Could not load sync history')}</p>`;
    }
}

function renderGscSyncLog(runs) {
    const container = document.getElementById('gscSyncLogList');
    if (!container) return;
    if (!runs.length) {
        container.innerHTML = '<p class="text-muted">No GSC syncs recorded yet. Run Sync or Sync All to create the first log.</p>';
        return;
    }

    const rows = runs.map(run => {
        const ok = run.status === 'success';
        const finished = run.finished_at ? new Date(run.finished_at).toLocaleString() : '-';
        const windowText = run.date_start && run.date_end ? run.date_start + ' to ' + run.date_end : '-';
        const error = run.error_message ? '<div class="text-danger" style="font-size:.76rem;margin-top:3px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(run.error_message) + '">' + escapeHtml(run.error_message) + '</div>' : '';
        return '<tr>' +
            '<td><strong>' + escapeHtml(run.client_name || 'Client') + '</strong><br><span class="text-muted" style="font-size:.76rem;max-width:240px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(run.site_url || '') + '">' + escapeHtml(run.site_url || '') + '</span></td>' +
            '<td style="text-transform:capitalize;">' + escapeHtml(run.sync_type || 'manual') + '</td>' +
            '<td><span class="badge ' + (ok ? 'green' : 'red') + '">' + (ok ? 'Success' : 'Failed') + '</span>' + error + '</td>' +
            '<td>' + formatNumber(run.rows_synced || 0) + '</td>' +
            '<td>' + escapeHtml(windowText) + '</td>' +
            '<td><span class="text-muted">' + escapeHtml(finished) + '</span></td>' +
        '</tr>';
    }).join('');

    container.innerHTML = '<div style="overflow:auto;"><table class="data-table premium" style="min-width:780px;"><thead><tr><th>Client</th><th>Type</th><th>Status</th><th>Rows</th><th>Window</th><th>Finished</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function gscSelectedClientId() {
    return document.getElementById('gscClientSelect')?.value || '';
}

window.gscSelectClient = async function gscSelectClient(clientId) {
    const select = document.getElementById('gscClientSelect');
    if (select) {
        select.value = clientId;
        const option = select.options[select.selectedIndex];
        const input = document.getElementById('gscSiteUrlInput');
        if (input) input.value = option?.dataset?.site || '';
    }
    await gscLoad();
    await gscLoadSyncLog(clientId);
};


window.gscGenerateClientReport = async function gscGenerateClientReport(clientId = '') {
    const targetClientId = clientId || gscSelectedClientId();
    if (!targetClientId) return showError('Select a client first.');

    const client = gscClientConnections.find(item => String(item.id) === String(targetClientId));
    navigateTo('reports');

    const select = document.getElementById('reportClientSelect');
    if (select) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            if (Array.from(select.options).some(option => String(option.value) === String(targetClientId))) break;
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        select.value = targetClientId;
        const domainInput = document.getElementById('reportDomain');
        if (domainInput && client?.website_url) {
            domainInput.value = client.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
        }
    }

    const titleInput = document.getElementById('reportTitle');
    if (titleInput && client) {
        const now = new Date();
        const month = now.toLocaleString('default', { month: 'long' });
        titleInput.value = `SEO Report - ${client.name || client.company || 'Client'} - ${month} ${now.getFullYear()}`;
    }

    if (typeof generateReport === 'function') {
        await generateReport();
    } else {
        showSuccess('Client selected in Reports. Click Generate Report.');
    }
};

window.gscConnect = async function gscConnect() {
    const clientId = gscSelectedClientId();
    const siteUrl = document.getElementById('gscSiteUrlInput')?.value.trim() || '';
    if (!clientId) return showError('Select a client first.');
    if (!siteUrl) return showError('Enter the exact GSC property URL, e.g. https://example.com/ or sc-domain:example.com');
    try {
        const res = await fetch('/api/gsc/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, siteUrl }),
        });
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'GSC connect failed');
        showSuccess('GSC property connected to this client.');
        await gscRefreshClientManager();
        await gscSyncClient(clientId);
    } catch (err) {
        showError(err.message || 'Could not connect GSC property');
    }
};


window.gscSyncAllClients = async function gscSyncAllClients() {
    if (!confirm('Sync GSC data for all connected clients now?')) return;
    try {
        const res = await fetch('/api/gsc/sync-all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: 30 }),
        });
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'Bulk GSC sync failed');
        const failedText = data.failed ? `, ${formatNumber(data.failed)} failed` : '';
        showSuccess(`GSC sync complete: ${formatNumber(data.synced || 0)} clients synced${failedText}.`);
        await gscRefreshClientManager();
        if (gscSelectedClientId()) await gscLoad();
    } catch (err) {
        showError(err.message || 'Could not sync all GSC clients');
    }
};

window.gscSync = async function gscSync() {
    const clientId = gscSelectedClientId();
    if (!clientId) return showError('Select a client first.');
    await gscSyncClient(clientId);
};

window.gscSyncClient = async function gscSyncClient(clientId) {
    if (!clientId) return showError('Select a client first.');
    try {
        const res = await fetch(`/api/gsc/sync/${encodeURIComponent(clientId)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ days: 30 }),
        });
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'GSC sync failed');
        showSuccess(`GSC synced: ${formatNumber(data.rows || 0)} rows.`);
        await gscRefreshClientManager();
        if (String(gscSelectedClientId()) === String(clientId)) await gscLoad();
    } catch (err) {
        showError(err.message || 'Could not sync GSC data');
    }
};

window.gscDisconnect = async function gscDisconnect(clientId) {
    if (!clientId) return showError('Select a client first.');
    if (!confirm('Disconnect this client from GSC and clear stored GSC data?')) return;
    try {
        const res = await fetch(`/api/gsc/disconnect/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!data.success && !data.ok) throw new Error(data.error || 'GSC disconnect failed');
        showSuccess('GSC disconnected for this client.');
        await gscRefreshClientManager();
        if (String(gscSelectedClientId()) === String(clientId)) {
            document.getElementById('gscSiteUrlInput').value = '';
            document.getElementById('gscOverviewCards').style.display = 'none';
        }
    } catch (err) {
        showError(err.message || 'Could not disconnect GSC');
    }
};

window.gscLoad = async function gscLoad() {
    const clientId = gscSelectedClientId();
    if (!clientId) return showError('Select a client first.');
    try {
        const [overview, queries, opportunities, lowCtr, pages] = await Promise.all([
            fetch(`/api/gsc/overview/${encodeURIComponent(clientId)}`).then(r => r.json()),
            fetch(`/api/gsc/top-queries/${encodeURIComponent(clientId)}?limit=10`).then(r => r.json()),
            fetch(`/api/gsc/opportunities/${encodeURIComponent(clientId)}?limit=10`).then(r => r.json()),
            fetch(`/api/gsc/low-ctr/${encodeURIComponent(clientId)}`).then(r => r.json()),
            fetch(`/api/gsc/top-pages/${encodeURIComponent(clientId)}?limit=10`).then(r => r.json()),
        ]);
        if (!overview.success && !overview.ok) throw new Error(overview.error || 'Could not load GSC overview');
        renderGscOverview(overview.data || {});
        renderGscRows('gscTopQueriesTable', queries.data || [], 'query');
        renderGscRows('gscOpportunitiesTable', opportunities.data || [], 'query');
        renderGscRows('gscLowCtrTable', lowCtr.data || [], 'page');
        renderGscRows('gscTopPagesTable', pages.data || [], 'page');
    } catch (err) {
        showError(err.message || 'Could not load GSC data');
    }
};

function renderGscOverview(data) {
    const cards = document.getElementById('gscOverviewCards');
    if (cards) cards.style.display = 'grid';
    const clicks = Number(data.total_clicks || 0);
    const impressions = Number(data.total_impressions || 0);
    document.getElementById('gscStatClicks').textContent = formatNumber(clicks);
    document.getElementById('gscStatImpressions').textContent = formatNumber(impressions);
    document.getElementById('gscStatCtr').textContent = `${Number(data.avg_ctr_pct || 0).toFixed(2)}%`;
    document.getElementById('gscStatPosition').textContent = Number(data.avg_position || 0).toFixed(1);
}

function renderGscRows(containerId, rows, keyName) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (!rows.length) {
        container.innerHTML = '<p class="text-muted">No data yet. Sync GSC first.</p>';
        return;
    }

    const tableRows = rows.map(row => '<tr>' +
        '<td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escapeHtml(row[keyName] || '') + '">' + escapeHtml(row[keyName] || '') + '</td>' +
        '<td>' + formatNumber(row.clicks || 0) + '</td>' +
        '<td>' + formatNumber(row.impressions || 0) + '</td>' +
        '<td>' + Number(row.ctr_pct || 0).toFixed(2) + '%</td>' +
        '<td>' + Number(row.avg_position || 0).toFixed(1) + '</td>' +
    '</tr>').join('');

    container.innerHTML = '<div style="overflow:auto;"><table class="data-table premium"><thead><tr><th>' + (keyName === 'page' ? 'Page' : 'Query') + '</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th>Pos.</th></tr></thead><tbody>' + tableRows + '</tbody></table></div>';
}

function initVoiceProfiles() {
    const profileSelect = $('#voiceProfileSelect');
    const saveBtn = $('#saveVoiceProfileBtn');
    const deleteBtn = $('#deleteVoiceProfileBtn');
    const voiceInput = $('#humanizerVoice');
    const audienceInput = $('#humanizerAudience');
    const sampleInput = $('#humanizerSample');

    if (!profileSelect || !saveBtn || !deleteBtn) return;

    function getProfiles() {
        try {
            return JSON.parse(localStorage.getItem('keyword_analyzer_voice_profiles') || '{}');
        } catch (e) {
            return {};
        }
    }

    function saveProfiles(profiles) {
        localStorage.setItem('keyword_analyzer_voice_profiles', JSON.stringify(profiles));
    }

    function renderProfileSelect() {
        const profiles = getProfiles();
        profileSelect.innerHTML = '<option value="">-- Select Saved Profile --</option>';
        Object.keys(profiles).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            profileSelect.appendChild(opt);
        });
    }

    saveBtn.addEventListener('click', () => {
        const voice = voiceInput.value.trim();
        const audience = audienceInput.value.trim();
        const sample = sampleInput ? sampleInput.value.trim() : '';
        if (!voice && !audience && !sample) {
            showError('Please fill in Brand Voice, Audience, or Writing Sample first.');
            return;
        }

        const name = prompt('Enter a name for this Voice Profile:');
        if (!name) return;
        const cleanName = name.trim();
        if (!cleanName) return;

        const profiles = getProfiles();
        profiles[cleanName] = { voice, audience, sample };
        saveProfiles(profiles);
        renderProfileSelect();
        profileSelect.value = cleanName;
        showSuccess(`Profile "${cleanName}" saved successfully.`);
    });

    deleteBtn.addEventListener('click', () => {
        const selected = profileSelect.value;
        if (!selected) {
            showError('Please select a profile to delete.');
            return;
        }
        if (!confirm(`Are you sure you want to delete profile "${selected}"?`)) return;

        const profiles = getProfiles();
        delete profiles[selected];
        saveProfiles(profiles);
        renderProfileSelect();
        showSuccess(`Profile "${selected}" deleted.`);
    });

    profileSelect.addEventListener('change', () => {
        const selected = profileSelect.value;
        if (!selected) {
            voiceInput.value = '';
            audienceInput.value = '';
            if (sampleInput) sampleInput.value = '';
            return;
        }

        const profiles = getProfiles();
        const prof = profiles[selected];
        if (prof) {
            voiceInput.value = prof.voice || '';
            audienceInput.value = prof.audience || '';
            if (sampleInput) sampleInput.value = prof.sample || '';
        }
    });

    renderProfileSelect();
}

function renderDiffView() {
    const original = $('#humanizerInput')?.value || '';
    const refined = $('#humanizerOutput')?.value || '';
    const diffContainer = $('#humanizerDiffContainer');
    if (!diffContainer) return;

    if (!original) {
        diffContainer.textContent = 'Paste original text first to view diff.';
        return;
    }

    const diff = Diff.diffWords(original, refined);
    let html = '';
    diff.forEach(part => {
        const colorClass = part.added ? 'diff-added' : part.removed ? 'diff-removed' : '';
        const tag = colorClass ? 'span' : 'span';
        const attrs = colorClass ? ` class="${colorClass}"` : '';
        const text = escapeHtml(part.value);
        html += `<${tag}${attrs}>${text}</${tag}>`;
    });
    diffContainer.innerHTML = html;
}

function initDiffModeToggler() {
    const btnEdit = $('#btnModeEdit');
    const btnDiff = $('#btnModeDiff');
    const output = $('#humanizerOutput');
    const diffContainer = $('#humanizerDiffContainer');

    if (!btnEdit || !btnDiff || !output || !diffContainer) return;

    btnEdit.addEventListener('click', () => {
        btnEdit.style.background = '#fff';
        btnEdit.style.color = '#111827';
        btnEdit.style.fontWeight = '600';
        btnEdit.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';

        btnDiff.style.background = 'transparent';
        btnDiff.style.color = '#4b5563';
        btnDiff.style.fontWeight = '500';
        btnDiff.style.boxShadow = 'none';

        output.style.display = 'block';
        diffContainer.style.display = 'none';
    });

    btnDiff.addEventListener('click', () => {
        btnDiff.style.background = '#fff';
        btnDiff.style.color = '#111827';
        btnDiff.style.fontWeight = '600';
        btnDiff.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';

        btnEdit.style.background = 'transparent';
        btnEdit.style.color = '#4b5563';
        btnEdit.style.fontWeight = '500';
        btnEdit.style.boxShadow = 'none';

        output.style.display = 'none';
        diffContainer.style.display = 'block';
        renderDiffView();
    });
}

function initToneAdjusters() {
    const adjustBtns = $$('.tone-adjust-btn');
    const output = $('#humanizerOutput');

    adjustBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            const text = output?.value.trim();
            const adjustment = btn.dataset.adj;
            if (!text || text.length < 10) {
                showError('Generate refined text first before adjusting tone.');
                return;
            }

            btn.disabled = true;
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Adjusting...';

            try {
                const data = await api('/api/content/humanize/adjust', {
                    method: 'POST',
                    body: JSON.stringify({ text, adjustment })
                });

                if (data.success && data.result?.refinedText) {
                    output.value = data.result.refinedText;
                    showSuccess('Tone adjusted successfully.');
                    if ($('#humanizerDiffContainer').style.display === 'block') {
                        renderDiffView();
                    }
                } else {
                    showError(data.error || 'Tone adjustment failed.');
                }
            } catch (err) {
                console.error(err);
                showError('Could not adjust tone right now.');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
            }
        });
    });
}
