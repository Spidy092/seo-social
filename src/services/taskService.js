/**
 * 🛠️ SEO Task Service — Agency-scoped
 * 
 * Handles manual CRUD operations and AI-driven automated SEO task prioritization.
 */

const db = require('../db');
const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { createLogger } = require('../utils/logger');

const log = createLogger('task-service');

/**
 * Get the agency_id for a user from their agency membership.
 */
async function getUserAgencyId(userId) {
    if (!userId) return null;
    const res = await db.query(
        `SELECT agency_id FROM agency_members WHERE user_id = $1 ORDER BY joined_at ASC LIMIT 1`,
        [userId]
    );
    return res.rows[0]?.agency_id || null;
}

/**
 * Gathers relevant SEO data for a project/client to serve as context for the AI.
 */
async function gatherProjectContext(projectId, userId) {
    // 1. Get project and client info
    const projectRes = await db.query(
        `SELECT p.*, c.agency_id, c.name as client_name, c.website_url, c.industry, c.target_locations, c.competitors, c.services, c.goals
         FROM seo_projects p
         JOIN seo_clients c ON c.id = p.client_id
         WHERE p.id = $1`,
        [projectId]
    );

    const project = projectRes.rows[0];
    if (!project) return null;

    const domain = project.website_url ? new URL(project.website_url).hostname.replace('www.', '') : '';

    // 2. Get latest rankings and movement
    const rankingsRes = await db.query(
        `SELECT k.keyword, k.location, k.search_volume, k.difficulty, pk.intent, pk.priority_score, pk.notes
         FROM seo_project_keywords pk
         JOIN keywords k ON k.id = pk.keyword_id
         WHERE pk.project_id = $1
         ORDER BY pk.priority_score DESC, k.search_volume DESC`,
        [projectId]
    );

    // 3. Get recent rank drops
    const dropsRes = await db.query(
        `SELECT k.keyword, rh.previous_rank, rh.rank_position
         FROM rank_history rh
         JOIN keywords k ON rh.keyword_id = k.id
         WHERE rh.domain = $1
           AND rh.checked_at > NOW() - INTERVAL '30 days'
           AND rh.rank_position > rh.previous_rank
         LIMIT 10`,
        [domain]
    );

    // 4. Get latest technical audit failed rules
    const technicalRes = await db.query(
        `SELECT ta.overall_score, ta.pages_crawled, ta.summary, ta.issues
         FROM technical_audits ta
         WHERE ta.agency_id = $1 OR ta.site_url ILIKE $2
         ORDER BY ta.created_at DESC
         LIMIT 1`,
        [project.agency_id, `%${domain}%`]
    );

    // 5. Get recent alert triggers
    const alertsRes = await db.query(
        `SELECT a.alert_type, a.message, a.created_at
         FROM alerts a
         WHERE a.domain = $1
         ORDER BY a.created_at DESC
         LIMIT 10`,
        [domain]
    );

    return {
        project,
        domain,
        rankings: rankingsRes.rows,
        drops: dropsRes.rows,
        technical: technicalRes.rows[0] || null,
        alerts: alertsRes.rows,
    };
}

function normalizeGeneratedTasks(value) {
    const rawTasks = Array.isArray(value)
        ? value
        : Array.isArray(value?.tasks)
            ? value.tasks
            : Array.isArray(value?.seoTasks)
                ? value.seoTasks
                : Array.isArray(value?.items)
                    ? value.items
                    : [];

    return rawTasks
        .map(task => ({
            title: String(task?.title || '').trim(),
            description: String(task?.description || '').trim(),
            category: ['on-page', 'technical', 'content', 'link-building', 'local-seo', 'general'].includes(task?.category) ? task.category : 'general',
            impact: ['high', 'medium', 'low'].includes(task?.impact) ? task.impact : 'medium',
            effort: ['high', 'medium', 'low'].includes(task?.effort) ? task.effort : 'medium',
            priority: ['critical', 'high', 'medium', 'low'].includes(task?.priority) ? task.priority : 'medium',
        }))
        .filter(task => task.title)
        .slice(0, 8);
}

function buildFallbackGeneratedTasks(context) {
    const { project, rankings, drops, technical, alerts } = context;
    const services = normalizeTaskArray(project.services);
    const locations = normalizeTaskArray(project.target_locations);
    const primaryKeyword = rankings[0]?.keyword || services[0] || project.industry || 'primary service';
    const location = rankings[0]?.location || locations[0] || project.target_location || 'target location';
    const tasks = [];

    if (technical?.overall_score !== undefined) {
        tasks.push({
            title: `Review technical audit issues for ${project.client_name}`,
            description: `Use the latest technical audit to fix the highest-impact crawl, indexability, metadata, and performance issues. Current overall score: ${technical.overall_score}.`,
            category: 'technical',
            impact: 'high',
            effort: 'medium',
            priority: technical.overall_score < 70 ? 'critical' : 'high',
        });
    }

    if (drops[0]) {
        tasks.push({
            title: `Diagnose ranking drop for "${drops[0].keyword}"`,
            description: `Compare SERP changes, content freshness, title/meta CTR, internal links, and competitor pages for the keyword that moved from position ${drops[0].previous_rank} to ${drops[0].rank_position}.`,
            category: 'on-page',
            impact: 'high',
            effort: 'medium',
            priority: 'critical',
        });
    }

    tasks.push(
        {
            title: `Optimize priority page targeting "${primaryKeyword}"`,
            description: `Improve title tag, meta description, H1, intro copy, entity coverage, FAQ section, and internal links for "${primaryKeyword}" in ${location}.`,
            category: 'on-page',
            impact: 'high',
            effort: 'medium',
            priority: 'high',
        },
        {
            title: `Create supporting content cluster for "${primaryKeyword}"`,
            description: `Plan 3 supporting articles or service sections that answer buyer questions, cover related entities, and internally link back to the main money page.`,
            category: 'content',
            impact: 'medium',
            effort: 'medium',
            priority: 'medium',
        },
        {
            title: `Strengthen internal links to key ${project.industry || 'service'} pages`,
            description: `Add contextual internal links from relevant existing pages using natural anchors tied to services, locations, and priority keywords.`,
            category: 'on-page',
            impact: 'medium',
            effort: 'low',
            priority: 'medium',
        }
    );

    if (alerts[0]) {
        tasks.push({
            title: 'Review recent SEO alerts',
            description: `Investigate recent alert: "${alerts[0].message}". Confirm whether action is needed and update the project task list accordingly.`,
            category: 'general',
            impact: 'medium',
            effort: 'low',
            priority: 'medium',
        });
    }

    return tasks.slice(0, 6);
}

/**
 * Automatically generates a prioritized list of tasks using AI.
 */
async function autoGenerateTasks(projectId, userId) {
    log.info({ projectId, userId }, 'starting auto SEO task generation');

    const context = await gatherProjectContext(projectId, userId);
    if (!context) {
        throw new Error('Project context not found');
    }

    const { project, domain, rankings, drops, technical, alerts } = context;

    // Prepare content for prompt
    const clientGoals = project.goals || 'Improve search visibility and acquire organic leads';
    const targetLocations = Array.isArray(project.target_locations) ? project.target_locations.join(', ') : '';
    const clientServices = Array.isArray(project.services) ? project.services.join(', ') : '';
    
    // Construct prompt
    const prompt = `
        You are an elite SEO Director. Based on the following performance data and business context for the site "${domain}" (Client name: ${project.client_name}), generate exactly 5 to 8 highly specific, actionable, and prioritized SEO tasks.

        Do NOT output generic advice like "optimize website" or "build backlinks".
        Generate tasks like:
        - "Fix meta description missing on /services/implants" (Technical/On-page)
        - "Create an 800-word service page targeting '${clientServices.split(',')[0] || 'specific service'}' for ${targetLocations.split(',')[0] || 'Koramangala'}" (Content/Local SEO)
        - "Optimize page title for ${rankings[0]?.keyword || 'primary keyword'} to improve CTR" (On-page)
        - "Diagnose recent ranking drop for keyword '${drops[0]?.keyword || 'dropped keyword'}' from position ${drops[0]?.previous_rank || 5} to ${drops[0]?.rank_position || 15}" (Rank Drop)

        BUSINESS CONTEXT:
        - Industry: ${project.industry || 'Unknown'}
        - Target Locations: ${targetLocations || 'Global'}
        - Key Services: ${clientServices || 'SEO optimization'}
        - Strategic Goals: ${clientGoals}

        SEO DATA:
        - Keywords Tracked: ${rankings.length}
        - Keyword Sample: ${JSON.stringify(rankings.slice(0, 10).map(r => ({ kw: r.keyword, location: r.location, vol: r.search_volume, difficulty: r.difficulty, intent: r.intent, priority: r.priority_score })))}
        - Recent Keyword Drops: ${JSON.stringify(drops)}
        - Recent SEO Alerts: ${JSON.stringify(alerts.slice(0, 5).map(a => a.message))}
        - Technical Audit Summary: ${technical ? JSON.stringify({ score: technical.overall_score, pages: technical.pages_crawled, summary: technical.summary, issues: normalizeTaskArray(technical.issues).slice(0, 5) }) : 'No recent audit'}

        For each task, return:
        1. "title": A concise, action-oriented title (e.g. "Create FAQ Schema for /dental-implants").
        2. "description": A detailed explanation of why it is needed and how to execute it.
        3. "category": One of: "on-page", "technical", "content", "link-building", "local-seo", "general".
        4. "impact": "high", "medium", or "low".
        5. "effort": "high", "medium", or "low".
        6. "priority": "critical", "high", "medium", or "low".

        Return ONLY valid JSON in this object shape:
        {
          "tasks": [
            {
              "title": "...",
              "description": "...",
              "category": "...",
              "impact": "...",
              "effort": "...",
              "priority": "..."
            }
          ]
        }
    `;

    let tasks = [];
    try {
        const responseContent = await resilientLlmRequest({
            prompt,
            expectJson: true,
            timeoutMs: 18000,
            maxRetries: 1,
            providerOrder: ['OpenRouter'],
            allowFallback: false,
            maxTokens: 1200,
        });

        tasks = normalizeGeneratedTasks(extractJson(responseContent));
    } catch (err) {
        log.warn({ err: err.message, projectId }, 'AI task generation failed; using context fallback');
    }

    if (!tasks.length) {
        log.warn({ projectId }, 'AI response did not contain usable tasks; using context fallback');
        tasks = buildFallbackGeneratedTasks(context);
    }

    if (!tasks.length) {
        throw new Error('Could not generate any usable tasks from project context');
    }

    try {
        // Insert into database, avoiding duplicate titles for the same project
        const insertedTasks = [];
        for (const t of tasks) {
            const title = t.title;
            if (!title) continue;

            // Check if similar task already exists for this project
            const check = await db.query(
                `SELECT id FROM seo_tasks WHERE project_id = $1 AND LOWER(title) = LOWER($2)`,
                [projectId, title]
            );

            if (check.rows.length === 0) {
                const insertRes = await db.query(
                    `INSERT INTO seo_tasks (user_id, agency_id, client_id, project_id, title, description, category, impact, effort, priority, status)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'todo')
                     RETURNING *`,
                    [
                        userId,
                        project.agency_id,
                        project.client_id,
                        projectId,
                        title,
                        t.description || '',
                        t.category || 'general',
                        t.impact || 'medium',
                        t.effort || 'medium',
                        t.priority || 'medium'
                    ]
                );
                insertedTasks.push(insertRes.rows[0]);
            }
        }

        log.info({ projectId, count: insertedTasks.length }, 'successfully auto-generated tasks');
        return insertedTasks;
    } catch (err) {
        log.error({ err: err.message, projectId }, 'failed to save auto-generated tasks');
        throw err;
    }
}

async function getTaskContext(taskId, userId) {
    const agencyId = await getUserAgencyId(userId);
    const taskRes = await db.query(
        `SELECT t.*, p.name AS project_name, p.project_type, p.target_location, p.goals AS project_goals,
                c.name AS client_name, c.website_url, c.industry, c.target_locations, c.competitors, c.services, c.goals AS client_goals,
                c.agency_id
         FROM seo_tasks t
         JOIN seo_projects p ON p.id = t.project_id
         JOIN seo_clients c ON c.id = p.client_id
         WHERE t.id = $1 AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)
         LIMIT 1`,
        [taskId, agencyId]
    );

    const task = taskRes.rows[0];
    if (!task) return null;

    const keywordRes = await db.query(
        `SELECT k.keyword, k.location, k.search_volume, k.difficulty, pk.intent, pk.priority_score, pk.notes
         FROM seo_project_keywords pk
         JOIN keywords k ON k.id = pk.keyword_id
         WHERE pk.project_id = $1
         ORDER BY pk.priority_score DESC, k.search_volume DESC
         LIMIT 12`,
        [task.project_id]
    );

    let technical = null;
    try {
        const domain = task.website_url ? new URL(task.website_url).hostname.replace(/^www\./, '') : '';
        const technicalRes = await db.query(
            `SELECT site_url, overall_score, summary, issues, created_at
             FROM technical_audits
             WHERE (agency_id = $1 OR agency_id IS NULL OR $1 IS NULL) OR site_url ILIKE $2
             ORDER BY created_at DESC
             LIMIT 1`,
            [agencyId, domain ? `%${domain}%` : '']
        );
        technical = technicalRes.rows[0] || null;
    } catch (err) {
        log.debug({ err: err.message, taskId }, 'technical context lookup skipped');
    }

    return { task, keywords: keywordRes.rows, technical };
}

function normalizeTaskArray(value) {
    return Array.isArray(value) ? value : []; 
}

function buildTaskAssistantPrompt(context, mode = 'full') {
    const { task, keywords, technical } = context;
    const services = normalizeTaskArray(task.services).join(', ');
    const locations = normalizeTaskArray(task.target_locations).join(', ');
    const competitors = normalizeTaskArray(task.competitors).join(', ');
    const keywordContext = keywords.slice(0, 10).map(k => ({ keyword: k.keyword, location: k.location, volume: k.search_volume, difficulty: k.difficulty, intent: k.intent }));
    const technicalContext = technical ? { siteUrl: technical.site_url, score: technical.overall_score, summary: technical.summary, issues: normalizeTaskArray(technical.issues).slice(0, 6) } : null;

    return `You are a senior SEO strategist and SEO engineer helping execute one task.

Return ONLY valid JSON. Be specific, practical, and concise. Do not invent crawl data, rankings, URLs, or business facts.

Task:
- Title: ${task.title}
- Description: ${task.description || 'none'}
- Category: ${task.category}
- Priority: ${task.priority}
- Impact: ${task.impact}
- Effort: ${task.effort}

Client/project context:
- Client: ${task.client_name}
- Website: ${task.website_url || 'not set'}
- Industry: ${task.industry || 'not set'}
- Services: ${services || 'not set'}
- Target locations: ${locations || task.target_location || 'not set'}
- Known competitors: ${competitors || 'not set'}
- Project: ${task.project_name} (${task.project_type || 'general'})
- Project goals: ${task.project_goals || task.client_goals || 'not set'}

Priority keywords:
${JSON.stringify(keywordContext, null, 2)}

Latest technical context:
${technicalContext ? JSON.stringify(technicalContext, null, 2) : 'No technical audit available.'}

Mode: ${mode}

Return this JSON shape:
{
  "summary": "2 sentence plain-English explanation of what to do and why it matters",
  "steps": ["specific implementation step"],
  "checklist": ["acceptance check that proves the task is done"],
  "implementationNotes": "concrete SEO/developer guidance with examples when useful",
  "risks": ["risk or caveat to watch"],
  "suggestedUpdate": {
    "title": "optional clearer task title",
    "description": "expanded task description ready to save",
    "category": "on-page|technical|content|link-building|local-seo|general",
    "priority": "critical|high|medium|low",
    "impact": "high|medium|low",
    "effort": "high|medium|low"
  }
}`;
}

function normalizeTaskAssistantResponse(response, task) {
    const safeList = (value) => Array.isArray(value) ? value.map(item => String(item || '').trim()).filter(Boolean).slice(0, 8) : [];
    const update = response?.suggestedUpdate || {};
    const categories = ['on-page', 'technical', 'content', 'link-building', 'local-seo', 'general'];
    const priorities = ['critical', 'high', 'medium', 'low'];
    const levels = ['high', 'medium', 'low'];

    return {
        summary: String(response?.summary || task.description || 'No AI summary returned.').trim(),
        steps: safeList(response?.steps),
        checklist: safeList(response?.checklist),
        implementationNotes: String(response?.implementationNotes || '').trim(),
        risks: safeList(response?.risks),
        suggestedUpdate: {
            title: String(update.title || task.title || '').trim(),
            description: String(update.description || task.description || '').trim(),
            category: categories.includes(update.category) ? update.category : task.category,
            priority: priorities.includes(update.priority) ? update.priority : task.priority,
            impact: levels.includes(update.impact) ? update.impact : task.impact,
            effort: levels.includes(update.effort) ? update.effort : task.effort,
        },
    };
}

async function generateTaskAssistant(taskId, userId, mode = 'full') {
    const context = await getTaskContext(taskId, userId);
    if (!context) {
        throw new Error('Task not found or access denied');
    }

    const responseContent = await resilientLlmRequest({
        prompt: buildTaskAssistantPrompt(context, mode),
        expectJson: true,
        timeoutMs: 18000,
        maxRetries: 1,
        providerOrder: ['OpenRouter'],
        allowFallback: false,
        maxTokens: 900,
    });

    return normalizeTaskAssistantResponse(extractJson(responseContent), context.task);
}

/**
 * Retrieve all tasks for a project (agency-scoped).
 */
async function getTasks(projectId, userId) {
    const agencyId = await getUserAgencyId(userId);
    const res = await db.query(
        `SELECT t.*, u.email AS assigned_email FROM seo_tasks t
         JOIN seo_projects p ON p.id = t.project_id
         JOIN seo_clients c ON c.id = p.client_id
         LEFT JOIN users u ON u.id = t.assigned_to
         WHERE t.project_id = $1
           AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)
         ORDER BY 
            CASE t.priority 
                WHEN 'critical' THEN 1 
                WHEN 'high' THEN 2 
                WHEN 'medium' THEN 3 
                WHEN 'low' THEN 4 
                ELSE 5 
            END ASC,
            t.created_at DESC`,
        [projectId, agencyId]
    );
    return res.rows;
}

/**
 * Add a custom task manually (agency-scoped).
 */
async function createTask(taskData, userId) {
    const { projectId, clientId, title, description, category, impact, effort, priority, status, assignedTo } = taskData;
    const agencyId = await getUserAgencyId(userId);
    
    // Fallback client_id lookup if not provided
    let cid = clientId;
    if (!cid && projectId) {
        const proj = await db.query(`SELECT client_id FROM seo_projects WHERE id = $1`, [projectId]);
        if (proj.rows[0]) cid = proj.rows[0].client_id;
    }

    const res = await db.query(
        `INSERT INTO seo_tasks (user_id, agency_id, client_id, project_id, title, description, category, impact, effort, priority, status, assigned_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [
            userId,
            agencyId,
            cid,
            projectId,
            title,
            description || '',
            category || 'general',
            impact || 'medium',
            effort || 'medium',
            priority || 'medium',
            status || 'todo',
            assignedTo || null
        ]
    );
    return res.rows[0];
}

/**
 * Update a task (agency-scoped).
 */
async function updateTask(taskId, taskData, userId) {
    const agencyId = await getUserAgencyId(userId);
    const fields = [];
    const values = [];
    let idx = 1;

    // Updatable fields
    const allowed = ['title', 'description', 'category', 'impact', 'effort', 'priority', 'status', 'ai_notes', 'assigned_to'];
    for (const key of allowed) {
        if (taskData[key] !== undefined) {
            fields.push(`${key} = $${idx}`);
            values.push(taskData[key]);
            idx++;
        }
    }

    if (fields.length === 0) return null;

    values.push(taskId);
    values.push(agencyId);

    const query = `
        UPDATE seo_tasks 
        SET ${fields.join(', ')}, updated_at = NOW()
        WHERE id = $${idx}
          AND (
              agency_id = $${idx + 1}
              OR agency_id IS NULL
              OR $${idx + 1} IS NULL
          )
        RETURNING *`;

    const res = await db.query(query, values);
    return res.rows[0] || null;
}

/**
 * Delete a task (agency-scoped).
 */
async function deleteTask(taskId, userId) {
    const agencyId = await getUserAgencyId(userId);
    const res = await db.query(
        `DELETE FROM seo_tasks t
         USING seo_projects p, seo_clients c
         WHERE t.project_id = p.id AND p.client_id = c.id
           AND t.id = $1
           AND (c.agency_id = $2 OR c.agency_id IS NULL OR $2 IS NULL)
         RETURNING t.*`,
        [taskId, agencyId]
    );
    return res.rows[0] || null;
}

module.exports = {
    autoGenerateTasks,
    generateTaskAssistant,
    getTasks,
    createTask,
    updateTask,
    deleteTask,
};
