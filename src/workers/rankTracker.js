/**
 * Project-scoped rank tracker worker.
 *
 * Checks only keywords linked to SEO projects and writes agency/client/project
 * context into ranking history and alerts. Legacy domain checks are retained as
 * a compatibility wrapper around matching project domains.
 */

const cron = require('node-cron');
const axios = require('axios');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const keywordService = require('../services/keywordService');
const { extractDomain } = require('../utils/domainUtils');

const log = createLogger('rank-tracker');
const PAGE_SIZE = 100;

function normalizeDomain(input) {
    if (!input) return '';
    return extractDomain(input);
}

function rankSeverity(changeDirection, previousPosition, newPosition) {
    if (changeDirection === 'lost') return 'critical';
    if (changeDirection === 'new') return newPosition <= 10 ? 'high' : 'medium';
    if (changeDirection === 'down') {
        const drop = newPosition - previousPosition;
        if (drop >= 10 || newPosition > 20) return 'critical';
        if (drop >= config.rankTracking.rankDropThreshold) return 'high';
        return 'medium';
    }
    if (changeDirection === 'up') {
        if (newPosition <= 3) return 'high';
        if (newPosition <= 10) return 'medium';
    }
    return 'low';
}

function shouldAlert(changeDirection, previousPosition, newPosition) {
    if (changeDirection === 'new' || changeDirection === 'lost') return true;
    if (changeDirection === 'down' && previousPosition > 0) {
        return newPosition - previousPosition >= config.rankTracking.rankDropThreshold;
    }
    if (changeDirection === 'up' && previousPosition > 0) {
        return previousPosition - newPosition >= config.rankTracking.rankImprovementThreshold;
    }
    return false;
}

function alertTypeForChange(changeDirection) {
    if (changeDirection === 'down') return 'rank_drop';
    if (changeDirection === 'up') return 'rank_improvement';
    if (changeDirection === 'new') return 'new_ranking';
    if (changeDirection === 'lost') return 'lost_ranking';
    return 'rank_change';
}

function alertMessage({ keyword, previousPosition, newPosition, changeDirection }) {
    if (changeDirection === 'down') return `Rank dropped for "${keyword}": #${previousPosition} -> #${newPosition}`;
    if (changeDirection === 'up') return `Rank improved for "${keyword}": #${previousPosition} -> #${newPosition}`;
    if (changeDirection === 'new') return `Now ranking for "${keyword}": position #${newPosition}`;
    if (changeDirection === 'lost') return `Lost ranking for "${keyword}" (was #${previousPosition})`;
    return `Rank changed for "${keyword}"`;
}

async function getProjectsToTrack(db, { agencyId = null, projectId = null, domain = null } = {}) {
    const params = [];
    const filters = ["p.status = 'active'"];

    if (agencyId) {
        params.push(agencyId);
        filters.push(`(c.agency_id = $${params.length} OR c.agency_id IS NULL)`);
    }
    if (projectId) {
        params.push(projectId);
        filters.push(`p.id = $${params.length}`);
    }

    const result = await db.query(
        `SELECT p.id AS project_id, p.client_id, p.name AS project_name,
                p.tracking_domain, p.target_location, c.agency_id, c.name AS client_name,
                c.website_url
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE ${filters.join(' AND ')}
           AND EXISTS (SELECT 1 FROM seo_project_keywords spk WHERE spk.project_id = p.id)
         ORDER BY c.updated_at DESC, p.updated_at DESC`,
        params
    );

    const normalizedFilter = domain ? normalizeDomain(domain) : '';
    return result.rows
        .map(project => ({ ...project, domain: normalizeDomain(project.tracking_domain || project.website_url) }))
        .filter(project => project.domain)
        .filter(project => !normalizedFilter || project.domain === normalizedFilter);
}

async function getProjectKeywords(db, projectId, { limit = PAGE_SIZE, offset = 0 } = {}) {
    const result = await db.query(
        `SELECT k.*, spk.intent, spk.priority_score, spk.notes
         FROM seo_project_keywords spk
         JOIN keywords k ON k.id = spk.keyword_id
         WHERE spk.project_id = $1
         ORDER BY spk.priority_score DESC, k.search_volume DESC, k.id ASC
         LIMIT $2 OFFSET $3`,
        [projectId, limit, offset]
    );
    return result.rows;
}

async function checkAllRankings(db) {
    log.info('starting project-scoped rank check');
    const projects = await getProjectsToTrack(db);
    if (!projects.length) {
        log.info('no active projects with linked keywords to track');
        return { checkedProjects: 0, succeeded: 0, failed: 0 };
    }

    let totalSucceeded = 0;
    let totalFailed = 0;
    for (const project of projects) {
        const result = await checkProjectRankings(db, project.project_id, { project });
        totalSucceeded += result.succeeded;
        totalFailed += result.failed;
    }

    log.info({ projects: projects.length, succeeded: totalSucceeded, failed: totalFailed }, 'rank check complete');
    return { checkedProjects: projects.length, succeeded: totalSucceeded, failed: totalFailed };
}

async function checkProjectRankings(db, projectId, { agencyId = null, project: providedProject = null } = {}) {
    const project = providedProject || (await getProjectsToTrack(db, { agencyId, projectId }))[0];
    if (!project) throw new Error('Project not found, has no keywords, or has no tracking domain');

    const concurrency = config.rankTracking.batchConcurrency || 2;
    let offset = 0;
    let succeeded = 0;
    let failed = 0;
    const results = [];

    while (true) {
        const keywords = await getProjectKeywords(db, project.project_id, { limit: PAGE_SIZE, offset });
        if (!keywords.length) break;

        let index = 0;
        async function worker() {
            while (index < keywords.length) {
                const keyword = keywords[index++];
                try {
                    const result = await checkProjectKeywordRanking(db, project, keyword);
                    results.push(result);
                    succeeded++;
                } catch (err) {
                    failed++;
                    results.push({ keyword: keyword.keyword, error: err.message });
                    log.error({ projectId: project.project_id, keyword: keyword.keyword, err: err.message }, 'project rank check failed');
                }
                await new Promise(r => setTimeout(r, config.rankTracking.rateLimitDelay || 1000));
            }
        }

        await Promise.all(Array.from({ length: Math.min(concurrency, keywords.length) }, () => worker()));
        if (keywords.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
    }

    await db.query('UPDATE seo_projects SET updated_at = NOW() WHERE id = $1', [project.project_id]).catch(() => {});

    return { success: true, projectId: project.project_id, clientId: project.client_id, agencyId: project.agency_id, domain: project.domain, succeeded, failed, results };
}

async function checkProjectKeywordRanking(db, project, keyword) {
    const serpResults = await keywordService.getSERPResults(keyword.keyword, keyword.location || project.target_location || 'India', 50);
    const targetDomain = normalizeDomain(project.domain);
    const result = serpResults.find(r => {
        const resultDomain = normalizeDomain(r.domain || r.url || '');
        return resultDomain === targetDomain || resultDomain.endsWith('.' + targetDomain);
    });
    const newPosition = result ? result.position : 0;

    const prevResult = await db.query(
        `SELECT rank_position FROM domain_rankings WHERE project_id = $1 AND keyword_id = $2 LIMIT 1`,
        [project.project_id, keyword.id]
    );
    const previousPosition = prevResult.rows[0]?.rank_position || 0;

    let changeDirection = 'same';
    if (previousPosition === 0 && newPosition > 0) changeDirection = 'new';
    else if (newPosition === 0 && previousPosition > 0) changeDirection = 'lost';
    else if (newPosition > 0 && previousPosition > 0 && newPosition < previousPosition) changeDirection = 'up';
    else if (newPosition > 0 && previousPosition > 0 && newPosition > previousPosition) changeDirection = 'down';

    if (newPosition > 0) {
        await db.query(
            `INSERT INTO domain_rankings (agency_id, client_id, project_id, domain, keyword_id, rank_position, url, checked_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
             ON CONFLICT (project_id, keyword_id) DO UPDATE SET
                agency_id = EXCLUDED.agency_id,
                client_id = EXCLUDED.client_id,
                domain = EXCLUDED.domain,
                rank_position = EXCLUDED.rank_position,
                url = EXCLUDED.url,
                checked_at = NOW()`,
            [project.agency_id || null, project.client_id, project.project_id, targetDomain, keyword.id, newPosition, result?.url || '']
        );
    } else {
        await db.query('DELETE FROM domain_rankings WHERE project_id = $1 AND keyword_id = $2', [project.project_id, keyword.id]);
    }

    await db.query(
        `INSERT INTO rank_history (agency_id, client_id, project_id, domain, keyword_id, rank_position, previous_rank, change_direction, checked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
        [project.agency_id || null, project.client_id, project.project_id, targetDomain, keyword.id, newPosition, previousPosition, changeDirection]
    );

    if (shouldAlert(changeDirection, previousPosition, newPosition)) {
        await createAlert(db, {
            agencyId: project.agency_id || null,
            clientId: project.client_id,
            projectId: project.project_id,
            domain: targetDomain,
            keywordId: keyword.id,
            alertType: alertTypeForChange(changeDirection),
            severity: rankSeverity(changeDirection, previousPosition, newPosition),
            message: alertMessage({ keyword: keyword.keyword, previousPosition, newPosition, changeDirection }),
            oldValue: String(previousPosition),
            newValue: String(newPosition),
            metadata: { keyword: keyword.keyword, url: result?.url || null, previousRank: previousPosition, newRank: newPosition, movement: changeDirection },
        });
    }

    return { keywordId: keyword.id, keyword: keyword.keyword, previousPosition, newPosition, changeDirection, url: result?.url || null };
}

async function createAlert(db, { agencyId, clientId, projectId, domain, keywordId, alertType, severity, message, oldValue, newValue, metadata = {} }) {
    const existing = await db.query(
        `SELECT id FROM alerts
         WHERE project_id = $1 AND keyword_id = $2 AND alert_type = $3
           AND old_value IS NOT DISTINCT FROM $4
           AND new_value IS NOT DISTINCT FROM $5
           AND created_at > NOW() - INTERVAL '24 hours'
         LIMIT 1`,
        [projectId, keywordId, alertType, oldValue, newValue]
    );
    if (existing.rows.length) return existing.rows[0];

    const inserted = await db.query(
        `INSERT INTO alerts (agency_id, client_id, project_id, domain, keyword_id, alert_type, severity, message, old_value, new_value, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
         RETURNING id`,
        [agencyId, clientId, projectId, domain, keywordId, alertType, severity, message, oldValue, newValue, JSON.stringify(metadata)]
    );
    log.info({ projectId, domain, alertType, severity }, 'alert created');
    return inserted.rows[0];
}

async function sendWebhookNotification(data) {
    if (!config.rankTracking.alertWebhook) return;
    try {
        await axios.post(config.rankTracking.alertWebhook, { text: data.message || `Rank change detected for ${data.domain}`, data }, { timeout: config.rankTracking.webhookTimeout });
        log.info('webhook notification sent');
    } catch (err) {
        log.error({ err: err.message }, 'webhook notification failed');
    }
}

function startRankTracker(db) {
    const { checkInterval } = config.rankTracking;
    const intervalHours = checkInterval / 3600;
    log.info({ intervalHours }, 'starting rank tracker');
    setTimeout(() => checkAllRankings(db).catch(err => log.error({ err: err.message }, 'initial rank check failed')), 60000);
    const cronExpression = getCronExpression(checkInterval);
    const timezone = process.env.TZ || process.env.RANK_CHECK_TIMEZONE || undefined;
    cron.schedule(cronExpression, () => {
        log.info('scheduled rank check starting');
        checkAllRankings(db).catch(err => log.error({ err: err.message }, 'scheduled rank check failed'));
    }, timezone ? { timezone } : {});
    log.info(`rank tracker started (every ${formatInterval(checkInterval)}, cron: ${cronExpression}${timezone ? `, tz: ${timezone}` : ''})`);
}

function getCronExpression(intervalSeconds) {
    const totalMinutes = Math.round(intervalSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours >= 24) return `0 ${parseInt(process.env.RANK_CHECK_HOUR || '3', 10) % 24} * * *`;
    if (hours >= 1 && 24 % hours === 0 && minutes === 0) return `0 */${hours} * * *`;
    if (hours >= 1) return `*/${totalMinutes} * * * *`;
    return `*/${Math.max(1, minutes)} * * * *`;
}

function formatInterval(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24 && hours % 24 === 0) return `${hours / 24} day${hours / 24 > 1 ? 's' : ''}`;
    if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    return `${minutes} minute${minutes > 1 ? 's' : ''}`;
}

async function manualRankCheck(db, domain, options = {}) {
    const projects = await getProjectsToTrack(db, { ...options, domain });
    if (!projects.length) return [];
    const results = [];
    for (const project of projects) results.push(await checkProjectRankings(db, project.project_id, { project }));
    return results;
}

module.exports = { startRankTracker, checkAllRankings, checkProjectRankings, checkProjectKeywordRanking, getProjectsToTrack, manualRankCheck, createAlert };
