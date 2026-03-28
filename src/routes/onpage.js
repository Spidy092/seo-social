/**
 * 🔍 On-Page SEO Routes
 */

const { analyzeOnPage } = require('../services/onpageService');
const { createLogger }  = require('../utils/logger');
const axios = require('axios');
const log = createLogger('routes:onpage');

async function onpageRoutes(fastify, options) {

    // ── POST /api/onpage/analyze ──────────────────────────────────────────────
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

    // ── POST /api/onpage/ai-fix ───────────────────────────────────────────────
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
            const { issue, context = {} } = request.body;

            try {
                // MIGRATION: Change from Anthropic to OpenRouter
                const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                    model: 'anthropic/claude-3.5-sonnet',
                    messages: [{
                        role: 'user',
                        content: buildFixPrompt(issue, context),
                    }],
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                        'HTTP-Referer': 'http://localhost:4000',
                        'X-Title': 'Keyword Analyzer',
                    },
                    timeout: 30000,
                });

                const data = response.data;
                const text = data.choices?.[0]?.message?.content || '';

                let parsed;
                try {
                    const clean = text.replace(/```json|```/g, '').trim();
                    parsed = JSON.parse(clean);
                } catch {
                    parsed = { explanation: text, fixCode: issue.fix, before: issue.current, after: '' };
                }

                return { success: true, fix: parsed };
            } catch (err) {
                log.error({ err: err.message }, 'AI fix generation failed');
                // Fallback to the pre-built fix from the audit
                return {
                    success: true,
                    fix: {
                        explanation: issue.desc,
                        fixCode: issue.fix,
                        before: issue.current,
                        after: issue.expected,
                    },
                };
            }
        },
    });
}

function buildFixPrompt(issue, context) {
    return `You are an expert SEO developer. A page has this SEO issue:

Issue: ${issue.name}
Category: ${issue.category}
Severity: ${issue.severity}
Problem: ${issue.desc}
Current value: ${issue.current}
Expected: ${issue.expected}
Target keyword: ${context.keyword || 'not specified'}
Page URL: ${context.url || 'not specified'}
Page title: ${context.title || 'not specified'}

Write a specific, actionable fix for THIS page. Be concrete — use the actual keyword, URL, and page details above.

Return ONLY valid JSON (no markdown, no explanation outside JSON):
{
  "explanation": "One clear sentence explaining why this matters for SEO",
  "before": "The current problematic code or value",
  "after": "The exact fixed code or value",
  "fixCode": "The complete ready-to-paste HTML/code snippet"
}`;
}

module.exports = onpageRoutes;
