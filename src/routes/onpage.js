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
                    url:     { type: 'string' },
                    html:    { type: 'string' },
                    keyword: { type: 'string', default: '' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const { url, html, keyword = '' } = request.body;

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
                return { success: true, result };
            } catch (err) {
                log.error({ err: err.message }, 'on-page analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
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
