/**
 * 📊 Analysis & Comparison Routes
 */

const analysisService = require('../services/analysisService');
const keywordService = require('../services/keywordService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:analysis');

async function analysisRoutes(fastify, options) {
    const { db } = options;

    // ─── Compare My Domain vs Competitor ───
    fastify.post('/api/analysis/compare', {
        schema: {
            body: {
                type: 'object',
                required: ['myDomain', 'competitorDomain', 'keyword'],
                properties: {
                    myDomain: { type: 'string' },
                    competitorDomain: { type: 'string' },
                    keyword: { type: 'string' },
                    myUrl: { type: 'string' },
                    competitorUrl: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { myDomain, competitorDomain, keyword, myUrl, competitorUrl } = request.body;

            try {
                log.info({ myDomain, competitorDomain, keyword }, 'comparing domains');

                // Analyze both pages if URLs provided
                let myPageData = null;
                let competitorPageData = null;

                if (myUrl) {
                    myPageData = await keywordService.analyzePageContent(myUrl, keyword);
                }

                if (competitorUrl) {
                    competitorPageData = await keywordService.analyzePageContent(competitorUrl, keyword);
                }

                // Compare domains
                const comparison = await analysisService.compareDomains(
                    myDomain,
                    competitorDomain,
                    keyword,
                    myPageData,
                    competitorPageData
                );

                // Store comparison
                const keywordResult = await db.query(
                    'SELECT id FROM keywords WHERE keyword = $1 LIMIT 1',
                    [keyword]
                );

                if (keywordResult.rows.length > 0) {
                    await db.query(
                        `INSERT INTO analysis_reports 
                         (keyword_id, my_domain, competitor_domain, comparison_data, suggestions)
                         VALUES ($1, $2, $3, $4, $5)`,
                        [
                            keywordResult.rows[0].id,
                            myDomain,
                            competitorDomain,
                            JSON.stringify(comparison),
                            JSON.stringify(comparison.suggestions),
                        ]
                    );
                }

                return {
                    success: true,
                    comparison,
                };
            } catch (err) {
                log.error({ err: err.message }, 'comparison failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Full Keyword Report ───
    fastify.post('/api/analysis/report', {
        schema: {
            body: {
                type: 'object',
                required: ['keyword', 'myDomain'],
                properties: {
                    keyword: { type: 'string' },
                    myDomain: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                },
            },
        },
        handler: async (request, reply) => {
            const { keyword, myDomain, location = 'India' } = request.body;

            try {
                log.info({ keyword, myDomain }, 'generating full report');

                // Get SERP results
                const serpResults = await keywordService.getSERPResults(keyword, location, 20);

                // Get competitor domains
                const competitorDomains = serpResults
                    .filter(r => !r.domain.includes(myDomain))
                    .map(r => r.domain)
                    .slice(0, 5);

                // Generate report
                const report = await analysisService.generateReport(
                    keyword,
                    myDomain,
                    competitorDomains,
                    serpResults
                );

                return {
                    success: true,
                    report,
                };
            } catch (err) {
                log.error({ err: err.message }, 'report generation failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Analyze Single Page ───
    fastify.post('/api/analysis/page', {
        schema: {
            body: {
                type: 'object',
                required: ['url', 'keyword'],
                properties: {
                    url: { type: 'string' },
                    keyword: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { url, keyword } = request.body;

            try {
                const analysis = await keywordService.analyzePageContent(url, keyword);
                const domain = keywordService.extractDomain(url);
                const da = await keywordService.getDomainAuthority(domain);

                return {
                    success: true,
                    analysis: {
                        ...analysis,
                        domain,
                        domainAuthority: da,
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'page analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Suggestions for My Domain ───
    fastify.post('/api/analysis/suggestions', {
        schema: {
            body: {
                type: 'object',
                required: ['myDomain', 'keyword'],
                properties: {
                    myDomain: { type: 'string' },
                    keyword: { type: 'string' },
                    myUrl: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { myDomain, keyword, myUrl } = request.body;

            try {
                log.info({ myDomain, keyword }, 'generating suggestions');

                // Get SERP results to find top competitors
                const serpResults = await keywordService.getSERPResults(keyword, 'India', 10);

                // Find my position
                const myResult = serpResults.find(r => r.domain.includes(myDomain));
                const myPosition = myResult ? myResult.position : null;

                // Get top 3 competitors
                const topCompetitors = serpResults
                    .filter(r => !r.domain.includes(myDomain))
                    .slice(0, 3);

                // Analyze my page
                let myPageData = null;
                if (myUrl) {
                    myPageData = await keywordService.analyzePageContent(myUrl, keyword);
                } else if (myResult) {
                    myPageData = await keywordService.analyzePageContent(myResult.url, keyword);
                }

                // Analyze top competitor
                let competitorAnalysis = null;
                if (topCompetitors.length > 0) {
                    const topComp = topCompetitors[0];
                    competitorAnalysis = await keywordService.analyzePageContent(topComp.url, keyword);
                    competitorAnalysis.domain = topComp.domain;
                    competitorAnalysis.domainAuthority = await keywordService.getDomainAuthority(topComp.domain);
                }

                // Generate suggestions
                const suggestions = [];

                if (myPageData && competitorAnalysis) {
                    // Compare and generate suggestions
                    const comparison = await analysisService.compareDomains(
                        myDomain,
                        topCompetitors[0].domain,
                        keyword,
                        myPageData,
                        competitorAnalysis
                    );

                    suggestions.push(...comparison.suggestions);
                } else if (!myPageData) {
                    // I'm not ranking - suggest how to rank
                    suggestions.push({
                        priority: 'HIGH',
                        category: 'Content',
                        action: 'Create a dedicated page for this keyword',
                        details: [
                            `Target keyword: "${keyword}"`,
                            `Analyze top ${topCompetitors.length} competitors`,
                            'Create better, more comprehensive content',
                            'Optimize on-page SEO',
                        ],
                        estimatedImpact: 'Could rank in top 10 within 2-4 weeks',
                    });

                    if (competitorAnalysis) {
                        suggestions.push({
                            priority: 'HIGH',
                            category: 'Benchmark',
                            action: `Match or beat top competitor: ${topCompetitors[0].domain}`,
                            details: [
                                `Their word count: ${competitorAnalysis.wordCount}`,
                                `Their keyword density: ${competitorAnalysis.keywordAnalysis.density}%`,
                                `Their DA: ${competitorAnalysis.domainAuthority}`,
                                'Create content that is 2x better',
                            ],
                            estimatedImpact: 'Higher chance of ranking above them',
                        });
                    }
                }

                return {
                    success: true,
                    myPosition,
                    topCompetitors: topCompetitors.map(c => ({
                        domain: c.domain,
                        position: c.position,
                        url: c.url,
                    })),
                    myPage: myPageData ? {
                        wordCount: myPageData.wordCount,
                        keywordDensity: myPageData.keywordAnalysis.density,
                        hasH1: myPageData.seoElements.hasH1,
                        hasMetaDescription: myPageData.seoElements.hasMetaDescription,
                    } : null,
                    suggestions,
                };
            } catch (err) {
                log.error({ err: err.message }, 'suggestions generation failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Analysis History ───
    fastify.get('/api/analysis/history', async (request, reply) => {
        const { domain, limit = 20 } = request.query;

        try {
            let query = `
                SELECT ar.*, k.keyword
                FROM analysis_reports ar
                JOIN keywords k ON ar.keyword_id = k.id
            `;
            const params = [];

            if (domain) {
                query += ' WHERE ar.my_domain = $1 OR ar.competitor_domain = $1';
                params.push(domain);
            }

            query += ' ORDER BY ar.created_at DESC LIMIT $' + (params.length + 1);
            params.push(limit);

            const result = await db.query(query, params);

            return {
                reports: result.rows,
                total: result.rows.length,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get history');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Multi-Competitor Analysis ───
    fastify.post('/api/analysis/multi-competitor', {
        schema: {
            body: {
                type: 'object',
                required: ['domains', 'keyword'],
                properties: {
                    domains: { 
                        type: 'array', 
                        items: { type: 'string' },
                        minItems: 2,
                        maxItems: 10,
                    },
                    keyword: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                },
            },
        },
        handler: async (request, reply) => {
            const { domains, keyword, location = 'India' } = request.body;

            try {
                log.info({ domains, keyword }, 'multi-competitor analysis');

                const analysis = await analysisService.analyzeMultipleCompetitors(domains, keyword, location);

                return {
                    success: true,
                    analysis,
                };
            } catch (err) {
                log.error({ err: err.message }, 'multi-competitor analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Competitor Gap Analysis ───
    fastify.post('/api/analysis/gap-analysis', {
        schema: {
            body: {
                type: 'object',
                required: ['myDomain', 'competitorDomains', 'keyword'],
                properties: {
                    myDomain: { type: 'string' },
                    competitorDomains: { 
                        type: 'array', 
                        items: { type: 'string' },
                        minItems: 1,
                        maxItems: 10,
                    },
                    keyword: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const { myDomain, competitorDomains, keyword } = request.body;

            try {
                log.info({ myDomain, competitorDomains, keyword }, 'gap analysis');

                const gapAnalysis = await analysisService.performGapAnalysis(myDomain, competitorDomains, keyword);

                return {
                    success: true,
                    gapAnalysis,
                };
            } catch (err) {
                log.error({ err: err.message }, 'gap analysis failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });
}

module.exports = analysisRoutes;
