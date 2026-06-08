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

// ─── Initialize ───
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    
    // Check for hash on load for deep linking
    const hash = window.location.hash.substring(1);
    const validPages = ['dashboard', 'clients', 'project-dashboard', 'research', 'competitors', 'analysis', 'tracking', 'alerts', 'onpage', 'technical', 'humanizer', 'content-brief', 'social-upload', 'social-schedule', 'social-platforms', 'social-analytics', 'reports', 'tasks'];
    
    if (hash && validPages.includes(hash)) {
        navigateTo(hash);
    } else {
        navigateTo('dashboard');
    }

    refreshAlertBadge();
    setInterval(refreshAlertBadge, 30000);
});

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
            navigateTo(page);
        });
    });

    $$('.view-all').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateTo(page);
        });
    });

    // Menu toggle for mobile
    $('.menu-toggle')?.addEventListener('click', () => {
        $('.sidebar').classList.toggle('active');
    });

    // Logout button handler
    $$('.logout-button').forEach(btn => {
        btn.addEventListener('click', () => {
            window.location.href = '/logout';
        });
    });

    // Handle back/forward buttons
    window.addEventListener('hashchange', () => {
        const hash = window.location.hash.substring(1);
        if (hash && hash !== currentPage) {
            navigateTo(hash);
        }
    });
}

function navigateTo(page) {
    if (currentPage !== page) {
        currentPage = page;
        window.location.hash = page;
    }
    
    // Update nav
    $$('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === page);
    });

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
        technical: 'Technical SEO Audit',
        humanizer: 'Content Humanizer',
        
        'content-brief': 'Content Brief Generator',
        'social-upload': 'Upload Content',
        'social-schedule': 'Post Schedule',
        'social-platforms': 'Social Platforms',
        'social-analytics': 'Social Analytics',
        'reports': 'Agency-Ready Reports',
        'tasks': 'SEO Tasks Prioritization'
    };

    $('#pageTitle').textContent = titles[page] || page;

    // Load page data
    switch (page) {
        case 'dashboard': loadDashboard(); break;
        case 'clients': loadClientWorkspace(); break;
        case 'project-dashboard': initProjectDashboard(); break;
        case 'research': loadResearchProjects(); break;
        case 'competitors': loadTopCompetitors(); break;
        case 'tracking': loadTrackedDomains(); break;
        case 'alerts': loadAlerts(); break;
        case 'onpage': break;
        case 'page-optimization': initPageOptimization(); break;
        case 'technical': break;
        case 'humanizer': loadHumanizerHistory(); break;
        case 'reports': if (typeof loadSavedReports === 'function') loadSavedReports(); break;
        case 'tasks': if (typeof initTasksPage === 'function') initTasksPage(); break;
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
            }),
        });

        if (!data.success) {
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
    $('#humanizerOriginalScore').textContent = `${result.originalAnalysis?.estimatedHumanScore || 0}/100`;
    $('#humanizerRefinedScore').textContent = `${result.refinedAnalysis?.estimatedHumanScore || 0}/100`;
    $('#humanizerReadability').textContent = `${capitalize(result.refinedAnalysis?.readability?.label || 'unknown')} (${result.refinedAnalysis?.readability?.score || 0})`;
    $('#humanizerWarningsCount').textContent = result.verification?.warnings?.length || 0;
    $('#humanizerSummary').textContent = result.summary || '';
    $('#humanizerOutput').value = result.refinedText || '';

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

    } catch (err) {
        console.error('Dashboard load failed:', err);
        // Show error state
        $('#totalKeywords').textContent = '-';
        $('#activeAlerts').textContent = '-';
        $('#totalCompetitors').textContent = '-';
        $('#topRankings').textContent = '-';
        $('#totalClients').textContent = '-';
        $('#totalProjects').textContent = '-';
    }
}

function renderRecentKeywords(keywords) {
    const tbody = $('#recentKeywordsTable tbody');
    if (!keywords.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No keywords yet</td></tr>';
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

    if (!data.success) {
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
        const data = await api(`/api/competitors/top?limit=${PG.competitors.perPage}&offset=${offset}`);
        PG.competitors.total = data.total || 0;
        renderTopCompetitors(data.competitors || []);
        renderPagination('competitorsPagination', PG.competitors, loadTopCompetitors);
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
            <td>${comp.keyword_count}</td>
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
            body: JSON.stringify({ myDomain, competitorDomain, keyword, myUrl, competitorUrl }),
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
            body: JSON.stringify({ domain }),
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
    const domainParam = domainFilter ? `&domain=${encodeURIComponent(domainFilter)}` : '';
    try {
        const res = await fetch(`${API_BASE}/api/rankings/current?limit=${PG.history.perPage}${domainParam}&offset=${offset}`);
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
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No rankings yet. Add a domain and click "Check" to start tracking.</td></tr>';
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
            body: JSON.stringify({ domain }),
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

        const res = await fetch(`${API_BASE}/api/alerts?limit=${PG.alerts.perPage}&offset=${offset}${unreadParam}`);
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
                    <button class="btn btn-sm btn-outline client-select-btn" data-client-id="${client.id}">Use</button>
                </div>
                <div class="client-meta-grid">
                    <span><strong>${client.project_count || 0}</strong> projects</span>
                    <span><strong>${client.keyword_count || 0}</strong> keywords</span>
                    <span>${escapeHtml(locations.slice(0, 3).join(', ') || 'No locations')}</span>
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
    if (!data.success) {
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

    if (!data.success) {
        showError(data.error || 'Could not save project.');
        return;
    }

    $('#projectNameInput').value = '';
    $('#projectGoalsInput').value = '';
    showSuccess('Project added.');
    await loadClientProjects(clientId);
    await loadResearchProjects();
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
