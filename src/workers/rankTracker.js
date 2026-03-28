/**
 * 📊 Rank Tracker Worker
 * 
 * Periodically checks rankings for tracked domains and generates alerts
 * when positions change.
 */

const cron = require('node-cron');
const axios = require('axios');
const config = require('../config');
const { createLogger } = require('../utils/logger');
const keywordService = require('../services/keywordService');

const log = createLogger('rank-tracker');

// ─── Check Rankings for All Tracked Domains ───
async function checkAllRankings(db) {
    log.info('🔄 starting rank check for all tracked domains');

    try {
        // Get all tracked domains
        const domainsResult = await db.query('SELECT domain FROM my_domains');
        const domains = domainsResult.rows.map(r => r.domain);

        if (domains.length === 0) {
            log.info('no domains to track');
            return;
        }

        // Get all keywords
        const keywordsResult = await db.query('SELECT * FROM keywords');
        const keywords = keywordsResult.rows;

        log.info({ domains: domains.length, keywords: keywords.length }, 'checking rankings');

        for (const domain of domains) {
            for (const keyword of keywords) {
                try {
                    await checkDomainRanking(db, domain, keyword);
                    await new Promise(r => setTimeout(r, config.rankTracking.rateLimitDelay));
                } catch (err) {
                    log.error({ domain, keyword: keyword.keyword, err: err.message }, 'rank check failed');
                }
            }
        }

        log.info('✅ rank check complete');
    } catch (err) {
        log.error({ err: err.message }, 'rank check failed');
    }
}

// ─── Check Ranking for Single Domain/Keyword ───
async function checkDomainRanking(db, domain, keyword) {
    log.debug({ domain, keyword: keyword.keyword }, 'checking ranking');

    try {
        // Get SERP results
        const serpResults = await keywordService.getSERPResults(
            keyword.keyword,
            keyword.location || 'India',
            50
        );

        // Find domain in results (normalize both)
        const targetDomain = keywordService.extractDomain(domain);
        const result = serpResults.find(r => r.domain === targetDomain || r.domain.endsWith('.' + targetDomain));
        const newPosition = result ? result.position : 0;

        // Get previous ranking
        const prevResult = await db.query(
            'SELECT rank_position FROM domain_rankings WHERE domain = $1 AND keyword_id = $2',
            [domain, keyword.id]
        );

        const previousPosition = prevResult.rows.length > 0 ? prevResult.rows[0].rank_position : 0;

        // Determine change
        let changeDirection = 'same';
        if (previousPosition === 0 && newPosition > 0) {
            changeDirection = 'new';
        } else if (newPosition === 0 && previousPosition > 0) {
            changeDirection = 'lost';
        } else if (newPosition < previousPosition) {
            changeDirection = 'up';
        } else if (newPosition > previousPosition) {
            changeDirection = 'down';
        }

        // Update current ranking
        if (newPosition > 0) {
            await db.query(
                `INSERT INTO domain_rankings (domain, keyword_id, rank_position, url, checked_at)
                 VALUES ($1, $2, $3, $4, NOW())
                 ON CONFLICT (domain, keyword_id) DO UPDATE SET
                     rank_position = $3,
                     url = $4,
                     checked_at = NOW()`,
                [domain, keyword.id, newPosition, result?.url || '']
            );
        } else {
            // Remove if not ranking
            await db.query(
                'DELETE FROM domain_rankings WHERE domain = $1 AND keyword_id = $2',
                [domain, keyword.id]
            );
        }

        // Record history
        await db.query(
            `INSERT INTO rank_history (domain, keyword_id, rank_position, previous_rank, change_direction, checked_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [domain, keyword.id, newPosition, previousPosition, changeDirection]
        );

        // Generate alerts for significant changes
        if (changeDirection === 'down' && previousPosition > 0) {
            const dropAmount = newPosition - previousPosition;
            
            if (dropAmount >= config.rankTracking.rankDropThreshold) {
                // Significant drop - create alert
                await createAlert(db, {
                    domain,
                    keywordId: keyword.id,
                    alertType: 'rank_drop',
                    message: `🚨 Rank dropped for "${keyword.keyword}": #${previousPosition} → #${newPosition} (dropped ${dropAmount} positions)`,
                    oldValue: previousPosition.toString(),
                    newValue: newPosition.toString(),
                });

                // Send webhook notification if configured
                await sendWebhookNotification({
                    type: 'rank_drop',
                    domain,
                    keyword: keyword.keyword,
                    previousPosition,
                    newPosition,
                    dropAmount,
                });
            }
        } else if (changeDirection === 'up' && previousPosition > 0) {
            const gainAmount = previousPosition - newPosition;
            
            if (gainAmount >= config.rankTracking.rankImprovementThreshold) {
                // Significant improvement
                await createAlert(db, {
                    domain,
                    keywordId: keyword.id,
                    alertType: 'rank_improvement',
                    message: `🎉 Rank improved for "${keyword.keyword}": #${previousPosition} → #${newPosition} (gained ${gainAmount} positions)`,
                    oldValue: previousPosition.toString(),
                    newValue: newPosition.toString(),
                });
            }
        } else if (changeDirection === 'new') {
            // New ranking
            await createAlert(db, {
                domain,
                keywordId: keyword.id,
                alertType: 'new_ranking',
                message: `✨ Now ranking for "${keyword.keyword}": Position #${newPosition}`,
                oldValue: '0',
                newValue: newPosition.toString(),
            });
        } else if (changeDirection === 'lost') {
            // Lost ranking
            await createAlert(db, {
                domain,
                keywordId: keyword.id,
                alertType: 'lost_ranking',
                message: `❌ Lost ranking for "${keyword.keyword}" (was #${previousPosition})`,
                oldValue: previousPosition.toString(),
                newValue: '0',
            });
        }

        log.debug({ domain, keyword: keyword.keyword, newPosition, changeDirection }, 'rank check complete');
    } catch (err) {
        log.error({ domain, keyword: keyword.keyword, err: err.message }, 'rank check failed');
    }
}

// ─── Create Alert ───
async function createAlert(db, { domain, keywordId, alertType, message, oldValue, newValue }) {
    try {
        await db.query(
            `INSERT INTO alerts (domain, keyword_id, alert_type, message, old_value, new_value)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [domain, keywordId, alertType, message, oldValue, newValue]
        );

        log.info({ domain, alertType, message }, 'alert created');
    } catch (err) {
        log.error({ err: err.message }, 'failed to create alert');
    }
}

// ─── Send Webhook Notification ───
async function sendWebhookNotification(data) {
    if (!config.rankTracking.alertWebhook) {
        return;
    }

    try {
        const message = {
            text: data.message || `Rank change detected for ${data.domain}`,
            data,
        };

        await axios.post(config.rankTracking.alertWebhook, message, {
            timeout: config.rankTracking.webhookTimeout,
        });

        log.info('webhook notification sent');
    } catch (err) {
        log.error({ err: err.message }, 'webhook notification failed');
    }
}

// ─── Start Rank Tracker ───
function startRankTracker(db) {
    const { checkInterval } = config.rankTracking;
    const intervalHours = checkInterval / 3600;
    const intervalMinutes = checkInterval / 60;
    
    log.info({ intervalHours }, 'starting rank tracker');

    // Run immediately on startup (after 1 minute)
    setTimeout(() => {
        checkAllRankings(db).catch(err => {
            log.error({ err: err.message }, 'initial rank check failed');
        });
    }, 60000);

    // Schedule periodic checks using configured interval
    const cronExpression = getCronExpression(checkInterval);
    cron.schedule(cronExpression, () => {
        log.info('scheduled rank check starting');
        checkAllRankings(db).catch(err => {
            log.error({ err: err.message }, 'scheduled rank check failed');
        });
    });

    log.info(`✅ rank tracker started (every ${formatInterval(checkInterval)})`);
}

// ─── Generate Cron Expression from Interval ───
function getCronExpression(intervalSeconds) {
    const hours = Math.floor(intervalSeconds / 3600);
    
    if (hours === 1) {
        return '0 * * * *'; // Every hour
    } else if (hours >= 24) {
        return '0 3 * * *'; // Daily at 3 AM for 24+ hours
    } else if (hours >= 12) {
        return '0 */12 * * *'; // Every 12 hours
    } else if (hours >= 6) {
        return '0 */6 * * *'; // Every 6 hours
    } else if (hours >= 4) {
        return '0 */4 * * *'; // Every 4 hours
    } else if (hours >= 2) {
        return '0 */2 * * *'; // Every 2 hours
    } else {
        return '0 * * * *'; // Every hour as fallback
    }
}

// ─── Format Interval for Display ───
function formatInterval(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours >= 24 && hours % 24 === 0) {
        const days = hours / 24;
        return `${days} day${days > 1 ? 's' : ''}`;
    } else if (hours > 0 && minutes > 0) {
        return `${hours}h ${minutes}m`;
    } else if (hours > 0) {
        return `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
        return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    }
}

// ─── Manual Rank Check ───
async function manualRankCheck(db, domain) {
    log.info({ domain }, 'manual rank check');

    const keywordsResult = await db.query('SELECT * FROM keywords');
    const keywords = keywordsResult.rows;

    const results = [];

    for (const keyword of keywords) {
        try {
            // Use the standard check function which saves to DB
            const result = await checkDomainRanking(db, domain, keyword);
            results.push(result);

            // Rate limiting pause
            if (config.rankTracking?.rateLimitDelay) {
                await new Promise(r => setTimeout(r, config.rankTracking.rateLimitDelay));
            } else {
                await new Promise(r => setTimeout(r, 1000)); // default 1s
            }
        } catch (err) {
            log.error({ err: err.message, keyword: keyword.keyword }, 'manual check failed for keyword');
            results.push({
                keyword: keyword.keyword,
                error: err.message,
            });
        }
    }

    return results;
}

module.exports = {
    startRankTracker,
    checkAllRankings,
    manualRankCheck,
};
