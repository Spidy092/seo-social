/**
 * 🤖 Autopilot Service
 *
 * Chains the existing research/analysis/AI building blocks into one
 * autonomous flow: SERP research -> competitor discovery -> page analysis
 * -> AI-scored comparison -> prioritized action plan -> (optional) tasks.
 *
 * Each step reuses the same services the manual pages already call
 * (keywordService, analysisService, taskService) so results stay consistent
 * with the rest of the app.
 */

const keywordService = require('./keywordService');
const analysisService = require('./analysisService');
const taskService = require('./taskService');
const { extractDomain } = require('../utils/domainUtils');
const { createLogger } = require('../utils/logger');

const log = createLogger('autopilot-service');

const PRIORITY_MAP = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

function mapSuggestionToTask(suggestion, projectId, clientId) {
    return {
        projectId,
        clientId,
        title: suggestion.action,
        description: [
            suggestion.why,
            ...(suggestion.details || []),
            suggestion.estimatedImpact ? `Expected impact: ${suggestion.estimatedImpact}` : null,
        ].filter(Boolean).join('\n'),
        category: (suggestion.category || 'general').toLowerCase(),
        impact: (suggestion.estimatedImpact || 'medium').toLowerCase().includes('high') ? 'high' : 'medium',
        effort: (suggestion.effort || 'medium').toLowerCase(),
        priority: PRIORITY_MAP[suggestion.priority] || 'medium',
        status: 'todo',
    };
}

/**
 * Run the full autonomous research + analysis + action-plan pipeline.
 *
 * @param {Object} params
 * @param {string} params.keyword
 * @param {string} params.myDomain
 * @param {string} [params.location='India']
 * @param {string} [params.projectId] - if set (and autoCreateTasks), tasks get attached to this project
 * @param {string} [params.clientId]
 * @param {boolean} [params.autoCreateTasks=false]
 * @param {number} [params.maxTasks=5]
 * @param {string} params.userId
 * @param {Function} [params.onStep] - optional callback(stepName, detail) for progress reporting
 */
async function runAutopilot({
    keyword,
    myDomain,
    location = 'India',
    projectId = null,
    clientId = null,
    autoCreateTasks = false,
    maxTasks = 5,
    userId,
    onStep = () => {},
}) {
    const myCleanDomain = extractDomain(myDomain);

    // ─── Step 1: Research the keyword's SERP ───
    onStep('research', `Researching "${keyword}" in ${location}`);
    const serpResults = await keywordService.getSERPResults(keyword, location, 20);

    // ─── Step 2: Discover competitors + locate my own ranking ───
    onStep('competitors', 'Discovering ranking competitors');
    const myResult = serpResults.find(r => r.domain?.includes(myCleanDomain));
    const competitors = serpResults.filter(r => !r.domain?.includes(myCleanDomain));
    const topCompetitor = competitors[0] || null;

    if (!topCompetitor) {
        throw new Error(`No competitor pages found ranking for "${keyword}" in ${location}.`);
    }

    // ─── Step 3: Analyze pages (mine, if ranking, + top competitor) ───
    onStep('page-analysis', `Analyzing ${topCompetitor.domain} and your page`);
    const [myPageData, competitorPageData] = await Promise.all([
        myResult ? keywordService.analyzePageContent(myResult.url, keyword).catch(() => null) : Promise.resolve(null),
        keywordService.analyzePageContent(topCompetitor.url, keyword).catch(() => null),
    ]);

    // ─── Step 4: Compare domains (this also runs the AI expert analysis) ───
    onStep('compare', `Comparing ${myCleanDomain || myDomain} vs ${topCompetitor.domain}`);
    const comparison = await analysisService.compareDomains(
        myDomain,
        topCompetitor.domain,
        keyword,
        myPageData,
        competitorPageData,
    );

    // ─── Step 5: Related keyword opportunities (non-fatal) ───
    onStep('opportunities', 'Finding related keyword opportunities');
    let relatedKeywords = [];
    try {
        const suggestions = await keywordService.getKeywordSuggestions(keyword, location, false);
        relatedKeywords = (suggestions || []).slice(0, 8);
    } catch (err) {
        log.warn({ err: err.message }, 'related keyword lookup failed (non-fatal)');
    }

    // ─── Step 6: Build the prioritized action plan ───
    onStep('action-plan', 'Building the prioritized action plan');
    const actionPlan = [...(comparison.suggestions || [])]
        .sort((a, b) => (b.priorityScore || 0) - (a.priorityScore || 0))
        .slice(0, maxTasks);

    // ─── Step 7: Optionally turn the top actions into tasks ───
    let createdTasks = [];
    if (autoCreateTasks && projectId) {
        onStep('tasks', `Creating ${actionPlan.length} tasks`);
        for (const suggestion of actionPlan) {
            try {
                const task = await taskService.createTask(
                    mapSuggestionToTask(suggestion, projectId, clientId),
                    userId,
                );
                createdTasks.push(task);
            } catch (err) {
                log.warn({ err: err.message }, 'failed to auto-create task from suggestion (non-fatal)');
            }
        }
    }

    onStep('done', 'Autopilot run complete');

    return {
        keyword,
        myDomain,
        location,
        myPosition: myResult ? myResult.position : null,
        topCompetitor: {
            domain: topCompetitor.domain,
            url: topCompetitor.url,
            position: topCompetitor.position,
            title: topCompetitor.title,
        },
        comparison,
        actionPlan,
        relatedKeywords,
        tasksCreated: createdTasks,
    };
}

module.exports = {
    runAutopilot,
};
