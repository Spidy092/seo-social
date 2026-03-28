/**
 * 🏆 Competitor Analysis Routes
 */

const keywordService = require('../services/keywordService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:competitors');

async function competitorRoutes(fastify, options) {
    const { db } = options;

    // ─── Analyze Competitor Page ───
    fastify.post('/api/competitors/analyze', {
        schema: {
            body: {
                type: 'object',
                required: ['url', 'keyword'],
                properties: {
                    url: { type: 'string' },
                    keyword: { type: 'string' },
                    keywordId: { type: 'number' },
                },
            },
        },
        handler: async (request, reply) => {
            const { url, keyword, keywordId } = request.body;

            try {
                log.info({ url, keyword }, 'analyzing competitor page');

                // Analyze page content
                const pageAnalysis = await keywordService.analyzePageContent(url, keyword);

                // Get domain authority
                const domain = keywordService.extractDomain(url);
                const da = await keywordService.getDomainAuthority(domain);

                // Store in database if keywordId provided
                if (keywordId) {
                    await db.query(
                        `INSERT INTO ranking_pages 
                         (keyword_id, domain, url, word_count, keyword_count, keyword_density,
                          has_h1, has_meta_description, domain_authority)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                         ON CONFLICT (keyword_id, domain) DO UPDATE SET
                             url = $3,
                             word_count = $4,
                             keyword_count = $5,
                             keyword_density = $6,
                             has_h1 = $7,
                             has_meta_description = $8,
                             domain_authority = $9,
                             analyzed_at = NOW()`,
                        [
                            keywordId,
                            domain,
                            url,
                            pageAnalysis.wordCount,
                            pageAnalysis.keywordAnalysis.exactMatches,
                            pageAnalysis.keywordAnalysis.density,
                            pageAnalysis.seoElements.hasH1,
                            pageAnalysis.seoElements.hasMetaDescription,
                            da,
                        ]
                    );
                }

                return {
                    success: true,
                    analysis: {
                        domain,
                        url,
                        domainAuthority: da,
                        content: {
                            wordCount: pageAnalysis.wordCount,
                            keywordAnalysis: pageAnalysis.keywordAnalysis,
                        },
                        seo: pageAnalysis.seoElements,
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'competitor analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Competitors for Keyword ───
    fastify.get('/api/competitors/keyword/:keywordId', async (request, reply) => {
        const { keywordId } = request.params;

        try {
            const result = await db.query(
                `SELECT c.*, rp.word_count, rp.keyword_density, rp.keyword_count,
                        rp.has_h1, rp.has_meta_description, rp.domain_authority
                 FROM competitors c
                 LEFT JOIN ranking_pages rp ON c.domain = rp.domain AND c.keyword_id = rp.keyword_id
                 WHERE c.keyword_id = $1
                 ORDER BY c.rank_position`,
                [keywordId]
            );

            return {
                keywordId,
                competitors: result.rows,
                total: result.rows.length,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get competitors');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Competitor Details ───
    fastify.get('/api/competitors/:domain', async (request, reply) => {
        const { domain } = request.params;

        try {
            // Get all keywords this domain ranks for
            const rankings = await db.query(
                `SELECT c.*, k.keyword, k.search_volume, k.competition
                 FROM competitors c
                 JOIN keywords k ON c.keyword_id = k.id
                 WHERE c.domain = $1
                 ORDER BY k.search_volume DESC`,
                [domain]
            );

            // Get domain authority
            const da = await keywordService.getDomainAuthority(domain);

            return {
                domain,
                domainAuthority: da,
                rankings: rankings.rows,
                totalKeywords: rankings.rows.length,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get competitor details');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Compare Competitors ───
    fastify.post('/api/competitors/compare', {
        schema: {
            body: {
                type: 'object',
                required: ['domains'],
                properties: {
                    domains: { 
                        type: 'array', 
                        items: { type: 'string' },
                        minItems: 2,
                        maxItems: 5,
                    },
                    keyword: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { domains, keyword } = request.body;

            try {
                const results = [];

                for (const domain of domains) {
                    const da = await keywordService.getDomainAuthority(domain);
                    
                    // Get ranking count
                    const rankingCount = await db.query(
                        'SELECT COUNT(*) as count FROM competitors WHERE domain = $1',
                        [domain]
                    );

                    results.push({
                        domain,
                        domainAuthority: da,
                        totalRankings: parseInt(rankingCount.rows[0].count),
                    });

                    await new Promise(r => setTimeout(r, 1000));
                }

                // Sort by DA
                results.sort((a, b) => b.domainAuthority - a.domainAuthority);

                return {
                    comparison: results,
                    winner: results[0],
                    insights: {
                        highestDA: results[0],
                        mostRankings: results.reduce((a, b) => a.totalRankings > b.totalRankings ? a : b),
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'comparison failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Top Competitors ───
    fastify.get('/api/competitors/top', async (request, reply) => {
        const { limit = 15, offset = 0 } = request.query;

        try {
            // Get total count for pagination
            const countResult = await db.query(
                'SELECT COUNT(DISTINCT domain) as total FROM competitors'
            );
            const total = parseInt(countResult.rows[0].total);

            const result = await db.query(
                `SELECT domain, 
                        COUNT(*) as keyword_count,
                        ROUND(AVG(rank_position)::numeric, 1) as avg_position,
                        MIN(rank_position) as best_position
                 FROM competitors
                 GROUP BY domain
                 ORDER BY keyword_count DESC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            );

            return {
                competitors: result.rows,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get top competitors');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = competitorRoutes;
