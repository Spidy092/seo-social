/**
 * On-Page SEO Routes
 */

const { analyzeOnPage } = require('../services/onpageService');
const { resilientLlmRequest, extractJson } = require('../utils/aiHelper');
const { createLogger }  = require('../utils/logger');
const { requireAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:onpage');

async function onpageRoutes(fastify, options) {
    const { db } = options;

    // POST /api/onpage/analyze
    fastify.post('/api/onpage/analyze', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    url:       { type: 'string' },
                    html:      { type: 'string' },
                    keyword:   { type: 'string', default: '' },
                    projectId: { type: 'string', default: '' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { url, html, keyword = '', projectId = '' } = request.body;

            if (!url && !html) {
                return reply.code(400).send({ error: 'Provide a URL or paste HTML.' });
            }

            try {
                log.info({ url: url || 'html-paste', keyword }, 'on-page analysis started');
                const result = await analyzeOnPage(
                    url || html,
                    keyword,
                    !url
                );

                if (projectId) {
                    try {
                        await db.query(
                            `INSERT INTO onpage_audits (user_id, project_id, url, keyword, overall_score, summary, issues) 
                             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                            [ctx.userId, projectId, url || 'html-paste', keyword, result.score || 0, JSON.stringify(result.summary || {}), JSON.stringify(result.issues || [])]
                        );
                    } catch (saveErr) {
                        log.error({ err: saveErr.message }, 'failed to save onpage audit');
                    }
                }

                return { success: true, result };
            } catch (err) {
                log.error({ err: err.message }, 'on-page analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // GET /api/projects/:projectId/onpage-audits
    fastify.get('/api/projects/:projectId/onpage-audits', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { projectId } = request.params;
        
        try {
            const audits = await db.query(
                `SELECT id, url, keyword, overall_score, summary, created_at
                 FROM onpage_audits
                 WHERE project_id = $1 AND user_id = $2
                 ORDER BY created_at DESC LIMIT 15`,
                [projectId, ctx.userId]
            );
            return { success: true, audits: audits.rows };
        } catch (err) {
            log.error({ err: err.message }, 'Failed to fetch onpage audits');
            return reply.code(500).send({ error: 'Failed to fetch onpage audits' });
        }
    });

    // GET /api/projects/:projectId/suggested-urls
    fastify.get('/api/projects/:projectId/suggested-urls', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        const { projectId } = request.params;

        try {
            // First, get client_id and domain for this project
            const projectResult = await db.query(
                `SELECT p.client_id, c.website_url 
                 FROM seo_projects p 
                 JOIN seo_clients c ON p.client_id = c.id
                 WHERE p.id = $1 AND p.client_id IN (
                     SELECT id FROM seo_clients WHERE user_id = $2
                 )`,
                [projectId, ctx.userId]
            );

            if (!projectResult.rows.length) {
                return { success: true, urls: [] };
            }

            const { client_id, website_url } = projectResult.rows[0];
            const urls = new Set();
            if (website_url) urls.add(website_url);

            // Fetch from GSC
            const gscResult = await db.query(
                `SELECT DISTINCT page FROM gsc_search_analytics 
                 WHERE client_id = $1 AND page IS NOT NULL AND page != ''
                 ORDER BY page LIMIT 50`,
                [client_id]
            );
            gscResult.rows.forEach(r => urls.add(r.page));

            // Fetch from ranking_pages
            try {
                let domain = '';
                if (website_url) {
                    domain = new URL(website_url.startsWith('http') ? website_url : `https://${website_url}`).hostname.replace('www.', '');
                }
                if (domain) {
                    const rpResult = await db.query(
                        `SELECT DISTINCT url FROM ranking_pages WHERE domain LIKE $1 LIMIT 50`,
                        [`%${domain}%`]
                    );
                    rpResult.rows.forEach(r => urls.add(r.url));
                }
            } catch (e) {
                // ignore URL parsing error
            }

            return { success: true, urls: Array.from(urls).slice(0, 50) };

        } catch (err) {
            log.error({ err: err.message }, 'Failed to fetch suggested URLs');
            return reply.code(500).send({ error: 'Failed to fetch suggested URLs' });
        }
    });

    // POST /api/onpage/ai-fix
    fastify.post('/api/onpage/ai-fix', {
        schema: {
            body: {
                type: 'object',
                required: ['issue'],
                properties: {
                    issue:   { type: 'object' },
                    context: { type: 'object' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { issue, context = {} } = request.body;

            try {
                const text = await resilientLlmRequest({
                    prompt: buildFixPrompt(issue, context),
                    expectJson: true,
                    timeoutMs: 12000,
                    maxRetries: 1,
                    maxTokens: 450,
                });

                return { success: true, fix: normalizeFixResponse(extractJson(text), issue) };
            } catch (err) {
                log.error({ err: err.message }, 'AI fix generation failed');
                return reply.code(502).send({
                    success: false,
                    error: 'AI fix generation failed: ' + err.message,
                    fix: normalizeFixResponse({}, issue),
                });
            }
        },
    });
}

function normalizeFixResponse(response, issue) {
    return {
        explanation: String(response?.explanation || issue.desc || '').trim(),
        before: String(response?.before || issue.current || '').trim(),
        after: String(response?.after || issue.expected || '').trim(),
        fixCode: String(response?.fixCode || issue.fix || issue.expected || '').trim(),
    };
}

function buildFixPrompt(issue, context) {
    return `You are an expert SEO developer. Return ONLY valid JSON.

Create a concise, ready-to-use fix for this on-page SEO issue.

Issue: ${issue.name || 'SEO issue'}
Category: ${issue.category || 'unknown'}
Severity: ${issue.severity || 'unknown'}
Problem: ${issue.desc || 'not specified'}
Current: ${issue.current || 'not specified'}
Expected: ${issue.expected || 'not specified'}
Target keyword: ${context.keyword || 'not specified'}
Page URL: ${context.url || 'not specified'}
Page title: ${context.title || 'not specified'}

JSON shape:
{
  "explanation": "one short sentence",
  "before": "current problematic value",
  "after": "fixed value",
  "fixCode": "ready-to-paste HTML/code"
}`;
}

module.exports = onpageRoutes;
