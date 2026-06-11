const humanizerService = require('../services/humanizerService');
const contentBriefRoutes = require('./contentBriefs');
const { createLogger } = require('../utils/logger');
const { getAgencyContext, requireAgencyContext } = require('../utils/authHelper');

const log = createLogger('routes:content');

async function contentRoutes(fastify, options) {
    const { db } = options;

    async function saveRewriteHistory(userId, agencyId, payload, result) {
        if (!userId) return null;

        const historyResult = await db.query(
            `INSERT INTO content_rewrite_history (
                user_id, agency_id, input_text, output_text, mode, primary_keyword, related_keywords, tone, audience, brand_voice,
                preserve_keywords, preserve_html, max_change, summary, verification, sample
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING id, created_at`,
            [
                userId,
                agencyId,
                payload.text,
                result.refinedText,
                payload.mode || 'standard',
                payload.mode === 'seo-blog' ? (payload.primaryKeyword || null) : null,
                JSON.stringify(payload.mode === 'seo-blog' ? (result.relatedKeywords || []) : []),
                payload.tone || 'natural',
                payload.audience || null,
                payload.brandVoice || null,
                JSON.stringify(result.preservedKeywords || []),
                Boolean(payload.preserveHtml),
                payload.maxChange || 'balanced',
                result.summary || null,
                JSON.stringify(result.verification || {}),
                payload.sample || null,
            ]
        );

        return historyResult.rows[0] || null;
    }

    fastify.post('/api/content/humanize', {
        schema: {
            body: {
                type: 'object',
                required: ['text'],
                properties: {
                    text: { type: 'string', minLength: 30, maxLength: 12000 },
                    tone: { type: 'string', default: 'natural' },
                    mode: { type: 'string', enum: ['standard', 'seo-blog'], default: 'standard' },
                    primaryKeyword: { type: 'string', default: '' },
                    relatedKeywords: {
                        anyOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } },
                        ],
                    },
                    audience: { type: 'string', default: '' },
                    brandVoice: { type: 'string', default: '' },
                    preserveKeywords: {
                        anyOf: [
                            { type: 'string' },
                            { type: 'array', items: { type: 'string' } },
                        ],
                    },
                    preserveHtml: { type: 'boolean', default: false },
                    maxChange: { type: 'string', enum: ['light', 'balanced', 'strong'], default: 'balanced' },
                    sample: { type: 'string', default: '' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            try {
                const result = await humanizerService.humanizeContent(request.body);
                try {
                    const history = await saveRewriteHistory(ctx.userId, ctx.agencyId, request.body, result);
                    if (history) {
                        result.historyId = history.id;
                        result.savedAt = history.created_at;
                    }
                } catch (historyErr) {
                    log.warn({ err: historyErr.message }, 'failed to save content rewrite history');
                }

                return { success: true, result };
            } catch (err) {
                log.error({ err: err.message }, 'content humanizer failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    fastify.post('/api/content/humanize/adjust', {
        schema: {
            body: {
                type: 'object',
                required: ['text', 'adjustment'],
                properties: {
                    text: { type: 'string', minLength: 10 },
                    adjustment: { type: 'string', minLength: 3 }
                }
            }
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            try {
                const result = await humanizerService.adjustContentTone(request.body);
                return { success: true, result };
            } catch (err) {
                log.error({ err: err.message }, 'content tone adjustment failed');
                return reply.code(500).send({ error: err.message });
            }
        }
    });

    await contentBriefRoutes(fastify, options);

    fastify.get('/api/content/history', async (request, reply) => {
        try {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const limit = Math.min(parseInt(request.query.limit || '10', 10), 25);

            const { rows } = await db.query(
                `SELECT id, input_text, output_text, mode, primary_keyword, related_keywords, tone, audience, brand_voice,
                        preserve_keywords, preserve_html, max_change, summary, verification, created_at
                 FROM content_rewrite_history
                 WHERE agency_id = $1 OR agency_id IS NULL
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [ctx.agencyId, limit]
            );

            return {
                success: true,
                history: rows,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to load content history');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = contentRoutes;