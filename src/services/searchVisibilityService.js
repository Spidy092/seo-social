/**
 * Search Visibility Control Center service.
 *
 * Provides agency-safe helpers for URL Inspection, sitemap submission,
 * IndexNow notifications, and guarded Google Indexing API notifications.
 */

const axios = require('axios');
const { google } = require('googleapis');
const { createLogger } = require('../utils/logger');
const { readServiceAccountJson, hasServiceAccountJson } = require('../utils/googleServiceAccount');
const { normalizeDomain, normalizeUrl } = require('../utils/urlNormalize');
const { normalizeSiteUrl } = require('./gscService');

const log = createLogger('search-visibility-service');

const GOOGLE_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const GOOGLE_WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters';
const GOOGLE_INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing';
const INDEXNOW_ENDPOINT = process.env.INDEXNOW_ENDPOINT || 'https://api.indexnow.org/indexnow';

function getGoogleAuth(scopes, label = 'Search Visibility') {
    const credentials = readServiceAccountJson({
        fallbackEnv: 'GSC_SERVICE_ACCOUNT_JSON',
        label,
    });
    return new google.auth.GoogleAuth({ credentials, scopes });
}

function getSearchConsole(scopes = [GOOGLE_READONLY_SCOPE]) {
    return google.searchconsole({ version: 'v1', auth: getGoogleAuth(scopes, 'Search Console') });
}

function sanitizeLimit(value, fallback = 50, max = 200) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(1, Math.min(max, Math.round(n)));
}

function parseWebUrl(value, field = 'url') {
    const raw = String(value || '').trim();
    if (!raw) throw new Error(`${field} is required`);
    let parsed;
    try {
        parsed = new URL(raw);
    } catch (_) {
        throw new Error(`${field} must be a fully-qualified URL`);
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${field} must use http or https`);
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        /^127\./.test(hostname) ||
        /^10\./.test(hostname) ||
        /^192\.168\./.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
        hostname === '0.0.0.0' ||
        hostname === '::1'
    ) {
        throw new Error(`${field} cannot target localhost or private network hosts`);
    }
    parsed.hash = '';
    return parsed;
}

function stripWww(hostname) {
    return String(hostname || '').toLowerCase().replace(/^www\./, '');
}

function siteUrlAllows(siteUrl, url) {
    if (!siteUrl) return false;
    const cleanSiteUrl = String(siteUrl).trim();
    const target = typeof url === 'string' ? parseWebUrl(url) : url;
    const targetHost = stripWww(target.hostname);

    if (cleanSiteUrl.startsWith('sc-domain:')) {
        const domain = stripWww(cleanSiteUrl.replace(/^sc-domain:/, '').trim());
        return targetHost === domain || targetHost.endsWith(`.${domain}`);
    }

    try {
        const property = new URL(normalizeSiteUrl(cleanSiteUrl));
        const propertyHost = stripWww(property.hostname);
        if (targetHost !== propertyHost) return false;
        const prefixPath = property.pathname || '/';
        return prefixPath === '/' || target.pathname.startsWith(prefixPath);
    } catch (_) {
        return false;
    }
}

function clientAllowsUrl(client, url) {
    const parsed = typeof url === 'string' ? parseWebUrl(url) : url;
    if (siteUrlAllows(client.gsc_site_url, parsed)) return true;

    const clientDomain = normalizeDomain(client.website_url || '');
    if (!clientDomain) return false;
    const targetDomain = stripWww(parsed.hostname);
    return targetDomain === clientDomain || targetDomain.endsWith(`.${clientDomain}`);
}

async function getClientForAgency(db, clientId, agencyId) {
    const res = await db.query(
        `SELECT id, user_id, agency_id, name, website_url, gsc_site_url,
                ga4_property_id, ga4_property_name, ga4_connected_at,
                ga4_last_synced_at, indexnow_key, indexnow_key_location,
                indexnow_connected_at, updated_at
         FROM seo_clients
         WHERE id = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)
         LIMIT 1`,
        [clientId, agencyId || null]
    );
    return res.rows[0] || null;
}

async function recordIndexingAction(db, action) {
    const res = await db.query(
        `INSERT INTO indexing_actions
         (user_id, agency_id, client_id, provider, action_type, status, url,
          normalized_url, site_url, sitemap_url, page_type, request_payload,
          response_payload, recommendations, error_message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15)
         RETURNING *`,
        [
            action.userId || null,
            action.agencyId || null,
            action.clientId,
            action.provider,
            action.actionType,
            action.status,
            action.url || null,
            action.normalizedUrl || null,
            action.siteUrl || null,
            action.sitemapUrl || null,
            action.pageType || null,
            JSON.stringify(action.requestPayload || {}),
            JSON.stringify(action.responsePayload || {}),
            JSON.stringify(action.recommendations || []),
            action.errorMessage || null,
        ]
    );
    return res.rows[0];
}

function buildConnectionNextActions(client, configured) {
    const actions = [];
    if (!configured) actions.push('Add GOOGLE_SERVICE_ACCOUNT_JSON to enable Google Search Console and GA4 API calls.');
    if (!client.gsc_site_url) actions.push('Connect a Google Search Console property for URL inspection and sitemap tools.');
    if (!client.ga4_property_id) actions.push('Connect a numeric GA4 property ID to show behavior and conversions.');
    if (!client.indexnow_key) actions.push('Add and host an IndexNow key to notify participating search engines about changed URLs.');
    return actions;
}

async function getConnectionStatus(db, clientId, agencyId) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');

    const [latestGsc, latestGa4, latestAction] = await Promise.all([
        db.query(
            `SELECT MAX(finished_at) AS last_sync_at
             FROM gsc_sync_runs
             WHERE client_id = $1 AND status = 'success'`,
            [clientId]
        ),
        db.query(
            `SELECT MAX(finished_at) AS last_sync_at
             FROM ga4_sync_runs
             WHERE client_id = $1 AND status = 'success'`,
            [clientId]
        ),
        db.query(
            `SELECT MAX(created_at) AS last_action_at
             FROM indexing_actions
             WHERE client_id = $1`,
            [clientId]
        ),
    ]);

    const configured = hasServiceAccountJson('GSC_SERVICE_ACCOUNT_JSON');
    return {
        client: {
            id: client.id,
            name: client.name,
            websiteUrl: client.website_url,
            gscSiteUrl: client.gsc_site_url,
            ga4PropertyId: client.ga4_property_id,
            ga4PropertyName: client.ga4_property_name,
            indexNowKeyLocation: client.indexnow_key_location,
        },
        status: {
            gscConnected: Boolean(client.gsc_site_url),
            ga4Connected: Boolean(client.ga4_property_id),
            googleServiceAccountConfigured: configured,
            indexNowConfigured: Boolean(client.indexnow_key),
            lastGscSyncAt: latestGsc.rows[0]?.last_sync_at || null,
            lastGa4SyncAt: client.ga4_last_synced_at || latestGa4.rows[0]?.last_sync_at || null,
            lastSearchVisibilityActionAt: latestAction.rows[0]?.last_action_at || null,
        },
        nextActions: buildConnectionNextActions(client, configured),
    };
}

function buildUrlInspectionRecommendations(payload) {
    const result = payload?.inspectionResult || payload?.urlInspectionResult || payload || {};
    const index = result.indexStatusResult || {};
    const recommendations = [];

    const verdict = String(index.verdict || '').toUpperCase();
    const coverage = String(index.coverageState || '');
    const robots = String(index.robotsTxtState || '').toUpperCase();
    const indexing = String(index.indexingState || '').toUpperCase();
    const fetchState = String(index.pageFetchState || '').toUpperCase();
    const googleCanonical = index.googleCanonical || '';
    const userCanonical = index.userCanonical || '';
    const sitemap = Array.isArray(index.sitemap) ? index.sitemap : [];

    if (verdict && verdict !== 'PASS') {
        recommendations.push('Review index coverage status and fix crawlability or quality blockers before expecting search visibility.');
    }
    if (/not indexed|crawled/i.test(coverage) && /not indexed/i.test(coverage)) {
        recommendations.push('Improve content uniqueness, internal links, canonical clarity, and sitemap inclusion for this URL.');
    }
    if (robots === 'BLOCKED') {
        recommendations.push('Robots.txt appears to block Google. Update robots rules or remove this URL from index targets.');
    }
    if (indexing === 'BLOCKED_BY_NOINDEX') {
        recommendations.push('A noindex signal blocks indexing. Remove noindex if this page should rank.');
    }
    if (fetchState && !['SUCCESSFUL', 'PAGE_FETCH_STATE_UNSPECIFIED'].includes(fetchState)) {
        recommendations.push('Google had trouble fetching the page. Check server status, redirects, SSL, DNS, and timeouts.');
    }
    if (googleCanonical && userCanonical && googleCanonical !== userCanonical) {
        recommendations.push('Google selected a different canonical. Fix canonical tags, duplicate content signals, internal links, and sitemap URLs.');
    }
    if (!sitemap.length) {
        recommendations.push('The URL is not reported in a known sitemap. Add it to the sitemap and submit the sitemap if this page should rank.');
    }
    if (!recommendations.length) {
        recommendations.push('No obvious indexing blocker was returned. Monitor GSC performance and improve internal links/content quality if visibility remains low.');
    }
    return recommendations;
}

async function inspectUrl(db, { clientId, agencyId, userId, inspectionUrl, languageCode = 'en-US' }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    if (!client.gsc_site_url) throw new Error('Connect a GSC property before inspecting URLs');

    const parsed = parseWebUrl(inspectionUrl, 'inspectionUrl');
    if (!clientAllowsUrl(client, parsed) || !siteUrlAllows(client.gsc_site_url, parsed)) {
        const msg = 'Inspection URL must belong to the connected client and GSC property';
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console', actionType: 'url_inspection',
            status: 'blocked', url: parsed.href, normalizedUrl: normalizeUrl(parsed.href),
            siteUrl: client.gsc_site_url, requestPayload: { inspectionUrl: parsed.href, languageCode },
            errorMessage: msg,
        });
        throw new Error(msg);
    }

    const requestPayload = {
        inspectionUrl: parsed.href,
        siteUrl: normalizeSiteUrl(client.gsc_site_url),
        languageCode: languageCode || 'en-US',
    };

    try {
        const sc = getSearchConsole([GOOGLE_READONLY_SCOPE]);
        const res = await sc.urlInspection.index.inspect({ requestBody: requestPayload });
        const recommendations = buildUrlInspectionRecommendations(res.data);
        const action = await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console',
            actionType: 'url_inspection', status: 'success', url: parsed.href,
            normalizedUrl: normalizeUrl(parsed.href), siteUrl: client.gsc_site_url,
            requestPayload, responsePayload: res.data, recommendations,
        });
        return { result: res.data, recommendations, action };
    } catch (err) {
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console',
            actionType: 'url_inspection', status: 'failed', url: parsed.href,
            normalizedUrl: normalizeUrl(parsed.href), siteUrl: client.gsc_site_url,
            requestPayload, errorMessage: err.message,
        }).catch(recordErr => log.warn({ err: recordErr.message }, 'failed to record inspection failure'));
        throw err;
    }
}

async function listSitemaps(db, { clientId, agencyId }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    if (!client.gsc_site_url) throw new Error('Connect a GSC property before listing sitemaps');

    const sc = getSearchConsole([GOOGLE_READONLY_SCOPE]);
    const res = await sc.sitemaps.list({ siteUrl: normalizeSiteUrl(client.gsc_site_url) });
    const sitemaps = res.data.sitemap || [];
    return {
        siteUrl: client.gsc_site_url,
        sitemaps,
        summary: {
            total: sitemaps.length,
            warnings: sitemaps.reduce((sum, item) => sum + (Number(item.warnings) || 0), 0),
            errors: sitemaps.reduce((sum, item) => sum + (Number(item.errors) || 0), 0),
        },
    };
}

async function submitSitemap(db, { clientId, agencyId, userId, sitemapUrl }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    if (!client.gsc_site_url) throw new Error('Connect a GSC property before submitting sitemaps');

    const parsed = parseWebUrl(sitemapUrl, 'sitemapUrl');
    if (!clientAllowsUrl(client, parsed)) {
        const msg = 'Sitemap URL must belong to the selected client';
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console', actionType: 'sitemap_submit',
            status: 'blocked', sitemapUrl: parsed.href, siteUrl: client.gsc_site_url,
            requestPayload: { sitemapUrl: parsed.href }, errorMessage: msg,
        });
        throw new Error(msg);
    }

    const requestPayload = { siteUrl: normalizeSiteUrl(client.gsc_site_url), feedpath: parsed.href };
    try {
        const sc = getSearchConsole([GOOGLE_WEBMASTERS_SCOPE]);
        const res = await sc.sitemaps.submit({
            siteUrl: requestPayload.siteUrl,
            feedpath: requestPayload.feedpath,
        });
        const recommendations = [
            'Sitemap submitted. Monitor Search Console later; sitemap submission helps discovery but does not guarantee indexing.',
        ];
        const action = await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console',
            actionType: 'sitemap_submit', status: 'success', sitemapUrl: parsed.href,
            siteUrl: client.gsc_site_url, requestPayload,
            responsePayload: res.data || {}, recommendations,
        });
        return { success: true, response: res.data || {}, recommendations, action };
    } catch (err) {
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_search_console',
            actionType: 'sitemap_submit', status: 'failed', sitemapUrl: parsed.href,
            siteUrl: client.gsc_site_url, requestPayload, errorMessage: err.message,
        }).catch(recordErr => log.warn({ err: recordErr.message }, 'failed to record sitemap failure'));
        throw err;
    }
}

async function submitIndexNow(db, { clientId, agencyId, userId, urls = [] }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    if (!client.indexnow_key) throw new Error('Add an IndexNow key before submitting URLs');

    const urlList = (Array.isArray(urls) ? urls : [urls])
        .map(url => parseWebUrl(url, 'url').href)
        .filter(Boolean);
    if (!urlList.length) throw new Error('At least one URL is required');
    if (urlList.length > 10000) throw new Error('IndexNow supports up to 10,000 URLs per request');

    const first = parseWebUrl(urlList[0]);
    const host = first.hostname;
    for (const url of urlList) {
        const parsed = parseWebUrl(url);
        if (parsed.hostname !== host) throw new Error('All IndexNow URLs must use the same host');
        if (!clientAllowsUrl(client, parsed)) throw new Error('All IndexNow URLs must belong to the selected client');
    }

    const body = {
        host,
        key: client.indexnow_key,
        urlList,
    };
    if (client.indexnow_key_location) body.keyLocation = client.indexnow_key_location;

    try {
        const res = await axios.post(INDEXNOW_ENDPOINT, body, {
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            timeout: 15000,
            validateStatus: status => status >= 200 && status < 500,
        });
        const ok = [200, 202].includes(res.status);
        const recommendations = ok
            ? ['IndexNow notification received. This notifies participating search engines, not Google.']
            : [`IndexNow returned HTTP ${res.status}. Verify the key file, host ownership, and URL host.`];
        const action = await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'indexnow', actionType: 'indexnow_submit',
            status: ok ? 'success' : 'failed', url: urlList[0], normalizedUrl: normalizeUrl(urlList[0]),
            requestPayload: body, responsePayload: { status: res.status, data: res.data },
            recommendations, errorMessage: ok ? null : `IndexNow returned HTTP ${res.status}`,
        });
        if (!ok) throw new Error(`IndexNow returned HTTP ${res.status}`);
        return { success: true, status: res.status, recommendations, action };
    } catch (err) {
        if (!err.message.includes('IndexNow returned HTTP')) {
            await recordIndexingAction(db, {
                userId, agencyId, clientId, provider: 'indexnow', actionType: 'indexnow_submit',
                status: 'failed', url: urlList[0], normalizedUrl: normalizeUrl(urlList[0]),
                requestPayload: body, errorMessage: err.message,
            }).catch(recordErr => log.warn({ err: recordErr.message }, 'failed to record IndexNow failure'));
        }
        throw err;
    }
}

function normalizeIndexingType(value) {
    const type = String(value || '').trim().toUpperCase();
    if (!['URL_UPDATED', 'URL_DELETED'].includes(type)) {
        throw new Error('type must be URL_UPDATED or URL_DELETED');
    }
    return type;
}

function normalizePageType(value) {
    return String(value || '').trim().toLowerCase();
}

async function notifyGoogleIndexing(db, { clientId, agencyId, userId, url, type, pageType }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');

    const parsed = parseWebUrl(url);
    const cleanType = normalizeIndexingType(type);
    const cleanPageType = normalizePageType(pageType);
    const normalizedUrl = normalizeUrl(parsed.href);
    const requestPayload = { url: parsed.href, type: cleanType, pageType: cleanPageType };

    if (!clientAllowsUrl(client, parsed)) {
        const msg = 'URL must belong to the selected client';
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_indexing_api',
            actionType: 'blocked_google_indexing_request', status: 'blocked',
            url: parsed.href, normalizedUrl, pageType: cleanPageType,
            requestPayload, errorMessage: msg,
        });
        throw new Error(msg);
    }

    if (!['job_posting', 'broadcast_event_video'].includes(cleanPageType)) {
        const msg = 'Google Indexing API is only available for eligible JobPosting pages or livestream BroadcastEvent pages. For normal pages, use URL Inspection, sitemap submission, IndexNow, and GSC monitoring.';
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_indexing_api',
            actionType: 'blocked_google_indexing_request', status: 'blocked',
            url: parsed.href, normalizedUrl, pageType: cleanPageType,
            requestPayload, recommendations: ['Use URL Inspection, sitemap submission, IndexNow, and GSC monitoring for normal pages.'],
            errorMessage: msg,
        });
        throw new Error(msg);
    }

    try {
        const auth = getGoogleAuth([GOOGLE_INDEXING_SCOPE], 'Google Indexing API');
        const authClient = await auth.getClient();
        const res = await authClient.request({
            url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
            method: 'POST',
            data: { url: parsed.href, type: cleanType },
        });
        const recommendations = [
            'Google Indexing API notification accepted for an eligible page type. This is still not a ranking or indexing guarantee.',
        ];
        const action = await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_indexing_api',
            actionType: 'google_indexing_publish', status: 'success',
            url: parsed.href, normalizedUrl, pageType: cleanPageType,
            requestPayload, responsePayload: res.data || {}, recommendations,
        });
        return { success: true, response: res.data || {}, recommendations, action };
    } catch (err) {
        await recordIndexingAction(db, {
            userId, agencyId, clientId, provider: 'google_indexing_api',
            actionType: 'google_indexing_publish', status: 'failed',
            url: parsed.href, normalizedUrl, pageType: cleanPageType,
            requestPayload, errorMessage: err.message,
        }).catch(recordErr => log.warn({ err: recordErr.message }, 'failed to record Google Indexing failure'));
        throw err;
    }
}


function clientDomain(client) {
    return normalizeDomain(client.website_url || client.gsc_site_url || '');
}

function alertTypeForAction(action) {
    if (action.status === 'blocked' && action.action_type === 'blocked_google_indexing_request') return 'google_indexing_api_blocked';
    if (action.status === 'failed' && action.action_type === 'indexnow_submit') return 'indexnow_failed';
    if (action.status === 'failed' && action.action_type === 'sitemap_submit') return 'sitemap_submit_failed';
    if (action.action_type === 'url_inspection') {
        const recs = Array.isArray(action.recommendations) ? action.recommendations.join(' ').toLowerCase() : '';
        if (recs.includes('robots')) return 'robots_blocked';
        if (recs.includes('noindex')) return 'noindex_detected';
        if (recs.includes('canonical')) return 'canonical_mismatch';
        if (recs.includes('fetch')) return 'page_fetch_failed';
        if (recs.includes('sitemap')) return 'sitemap_missing';
        if (recs.includes('not indexed') || recs.includes('coverage')) return 'url_not_indexed';
    }
    return null;
}

async function ensureTrackedDomain(db, agencyId, domain) {
    if (!domain) return;
    await db.query(
        'INSERT INTO my_domains (agency_id, domain) VALUES ($1, $2) ON CONFLICT (agency_id, domain) DO NOTHING',
        [agencyId || null, domain]
    );
}

async function createAlertsFromActions(db, { clientId, agencyId, limit = 20 }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    const domain = clientDomain(client);
    if (!domain) throw new Error('Client website URL is required to create alerts');
    await ensureTrackedDomain(db, agencyId, domain);

    const actions = await getActions(db, { clientId, agencyId, limit });
    const inserted = [];
    for (const action of actions) {
        const alertType = alertTypeForAction(action);
        if (!alertType) continue;

        const target = action.url || action.sitemap_url || action.normalized_url || domain;
        const recs = Array.isArray(action.recommendations) ? action.recommendations : [];
        const message = alertType.replace(/_/g, ' ') + ' on ' + target + '. ' + (recs[0] || action.error_message || 'Review this search visibility action.');
        const existing = await db.query(
            "SELECT id FROM alerts WHERE domain = $1 AND alert_type = $2 AND message = $3 AND created_at > NOW() - INTERVAL '7 days' LIMIT 1",
            [domain, alertType, message]
        );
        if (existing.rows.length) continue;

        const res = await db.query(
            'INSERT INTO alerts (domain, keyword_id, alert_type, message, old_value, new_value) VALUES ($1, NULL, $2, $3, $4, $5) RETURNING *',
            [domain, alertType, message, action.status, action.action_type]
        );
        inserted.push(res.rows[0]);
    }
    return inserted;
}


function taskMetaForAction(action) {
    const alertType = alertTypeForAction(action);
    if (!alertType) return null;
    const target = action.url || action.sitemap_url || action.normalized_url || 'search visibility issue';
    const recs = Array.isArray(action.recommendations) ? action.recommendations : [];
    const recommendation = recs[0] || action.error_message || 'Review this search visibility issue and apply the recommended fix.';
    const titles = {
        url_not_indexed: 'Fix indexing issue',
        canonical_mismatch: 'Fix canonical mismatch',
        robots_blocked: 'Fix robots.txt indexing block',
        noindex_detected: 'Remove noindex from ranking target',
        sitemap_missing: 'Add URL to sitemap',
        page_fetch_failed: 'Fix Google page fetch issue',
        google_indexing_api_blocked: 'Use safe discovery flow instead of Google Indexing API',
        indexnow_failed: 'Fix IndexNow notification setup',
        sitemap_submit_failed: 'Fix sitemap submission setup',
    };
    return {
        type: alertType,
        target,
        title: (titles[alertType] || 'Fix search visibility issue') + ': ' + target,
        description: recommendation + '\n\nSource action: ' + action.action_type + ' (' + action.status + ').',
        priority: ['robots_blocked', 'noindex_detected', 'page_fetch_failed', 'canonical_mismatch'].includes(alertType) ? 'high' : 'medium',
    };
}

async function createTasksFromActions(db, { clientId, agencyId, userId, projectId, limit = 20 }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');
    if (!projectId) throw new Error('projectId is required');

    const actions = await getActions(db, { clientId, agencyId, limit });
    const inserted = [];
    for (const action of actions) {
        const meta = taskMetaForAction(action);
        if (!meta) continue;

        const existing = await db.query(
            'SELECT id FROM seo_tasks WHERE project_id = $1 AND LOWER(title) = LOWER($2) LIMIT 1',
            [projectId, meta.title]
        );
        if (existing.rows.length) continue;

        const res = await db.query(
            'INSERT INTO seo_tasks (user_id, agency_id, client_id, project_id, title, description, category, impact, effort, priority, status, ai_notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *',
            [
                userId || null,
                agencyId || null,
                clientId,
                projectId,
                meta.title,
                meta.description,
                'technical',
                'high',
                'medium',
                meta.priority,
                'todo',
                JSON.stringify({
                    source: 'search-visibility',
                    actionId: action.id,
                    actionType: action.action_type,
                    provider: action.provider,
                    status: action.status,
                    url: action.url || action.sitemap_url || null,
                    issueType: meta.type,
                }),
            ]
        );
        inserted.push(res.rows[0]);
    }
    return inserted;
}

async function getActions(db, { clientId, agencyId, limit = 50, provider, actionType, status }) {
    const client = await getClientForAgency(db, clientId, agencyId);
    if (!client) throw new Error('Client not found or access denied');

    const params = [clientId];
    const filters = ['client_id = $1'];
    if (provider) {
        params.push(provider);
        filters.push(`provider = $${params.length}`);
    }
    if (actionType) {
        params.push(actionType);
        filters.push(`action_type = $${params.length}`);
    }
    if (status) {
        params.push(status);
        filters.push(`status = $${params.length}`);
    }
    params.push(sanitizeLimit(limit));

    const res = await db.query(
        `SELECT id, user_id, agency_id, client_id, provider, action_type, status,
                url, normalized_url, site_url, sitemap_url, page_type,
                response_payload, recommendations, error_message, created_at
         FROM indexing_actions
         WHERE ${filters.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
    );
    return res.rows;
}

module.exports = {
    getConnectionStatus,
    inspectUrl,
    listSitemaps,
    submitSitemap,
    submitIndexNow,
    notifyGoogleIndexing,
    getActions,
    createAlertsFromActions,
    createTasksFromActions,
    recordIndexingAction,
    buildUrlInspectionRecommendations,
    parseWebUrl,
    siteUrlAllows,
    clientAllowsUrl,
};
