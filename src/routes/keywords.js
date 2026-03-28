/**
 * 🔍 Keyword Research Routes
 */

const keywordService = require('../services/keywordService');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:keywords');

// ─── Supported Locations List ───
const SUPPORTED_LOCATIONS = {
    countries: [
        { id: 'india', name: 'India', gl: 'in' },
        { id: 'usa', name: 'United States', gl: 'us' },
        { id: 'uk', name: 'United Kingdom', gl: 'gb' },
        { id: 'canada', name: 'Canada', gl: 'ca' },
        { id: 'australia', name: 'Australia', gl: 'au' },
        { id: 'germany', name: 'Germany', gl: 'de' },
        { id: 'france', name: 'France', gl: 'fr' },
        { id: 'uae', name: 'UAE', gl: 'ae' },
        { id: 'singapore', name: 'Singapore', gl: 'sg' },
    ],
    india: {
        cities: [
            { id: 'bangalore', name: 'Bangalore', state: 'Karnataka' },
            { id: 'mumbai', name: 'Mumbai', state: 'Maharashtra' },
            { id: 'delhi', name: 'Delhi/NCR', state: 'Delhi' },
            { id: 'chennai', name: 'Chennai', state: 'Tamil Nadu' },
            { id: 'hyderabad', name: 'Hyderabad', state: 'Telangana' },
            { id: 'pune', name: 'Pune', state: 'Maharashtra' },
            { id: 'kolkata', name: 'Kolkata', state: 'West Bengal' },
            { id: 'ahmedabad', name: 'Ahmedabad', state: 'Gujarat' },
            { id: 'jaipur', name: 'Jaipur', state: 'Rajasthan' },
            { id: 'kochi', name: 'Kochi', state: 'Kerala' },
        ],
        areas: {
            bangalore: ['Whitefield', 'Marathahalli', 'Koramangala', 'HSR Layout', 'Indiranagar', 'Jayanagar', 'Electronic City', 'MG Road', 'BTM Layout', 'JP Nagar', 'Banashankari', 'Malleshwaram', 'Hebbal', 'Yelahanka', 'Hennur', 'K.R. Puram'],
            mumbai: ['Andheri', 'Bandra', 'Juhu', 'Powai', 'Malad', 'Goregaon', 'Thane', 'Navi Mumbai'],
            delhi: ['Dwarka', 'Saket', 'Lajpat Nagar', 'Rohini', 'Janakpuri', 'Connaught Place', 'Gurgaon', 'Noida'],
            hyderabad: ['Gachibowli', 'Hitech City', 'Kukatpally', 'Jubilee Hills', 'Banjara Hills'],
        },
    },
};

async function keywordRoutes(fastify, options) {
    const { db } = options;

    // ─── Get Available Locations ───
    fastify.get('/api/locations', async (request, reply) => {
        return {
            success: true,
            locations: SUPPORTED_LOCATIONS,
        };
    });

    // ─── Advanced Keyword Research ───
    fastify.post('/api/keywords/advanced-research', {
        schema: {
            body: {
                type: 'object',
                required: ['keyword'],
                properties: {
                    keyword: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                    language: { type: 'string', default: 'en' },
                    includeSerpFeatures: { type: 'boolean', default: true },
                    includeIntent: { type: 'boolean', default: true },
                    includeContentGap: { type: 'boolean', default: true },
                    includeCompetitorAnalysis: { type: 'boolean', default: true },
                    compareLocations: { type: 'array', items: { type: 'string' } },
                    numResults: { type: 'integer', default: 20, maximum: 50 },
                },
            },
        },
        handler: async (request, reply) => {
            const { 
                keyword, 
                location = 'India',
                language = 'en',
                includeSerpFeatures = true,
                includeIntent = true,
                includeContentGap = true,
                includeCompetitorAnalysis = true,
                compareLocations,
                numResults = 20,
            } = request.body;

            try {
                log.info({ keyword, location }, 'advanced keyword research');

                const options = {
                    location,
                    language,
                    includeSerpFeatures,
                    includeIntent,
                    includeContentGap,
                    includeCompetitorAnalysis,
                    numResults,
                    compareLocations,
                };

                const result = await keywordService.advancedKeywordResearch(keyword, options);

                // Store keyword in database
                const dbResult = await db.query(
                    `INSERT INTO keywords (keyword, location, search_volume, competition, cpc, difficulty)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (keyword, location) DO UPDATE SET
                         search_volume = $3,
                         competition = $4,
                         cpc = $5,
                         difficulty = $6,
                         updated_at = NOW()
                     RETURNING id`,
                    [keyword, location, result.metrics.searchVolume, result.metrics.competition, result.metrics.cpc.estimated, result.metrics.difficulty]
                );

                const keywordId = dbResult.rows[0].id;

                // Store competitors from SERP results
                if (result.competitors) {
                    for (const serp of result.competitors) {
                        await db.query(
                            `INSERT INTO competitors (domain, keyword_id, rank_position, url, title, description)
                             VALUES ($1, $2, $3, $4, $5, $6)
                             ON CONFLICT (domain, keyword_id) DO UPDATE SET
                                 rank_position = $3,
                                 url = $4,
                                 title = $5,
                                 description = $6,
                                 discovered_at = NOW()`,
                            [serp.domain, keywordId, serp.position, serp.url, serp.title, serp.description]
                        );
                    }
                }

                return {
                    success: true,
                    id: keywordId,
                    ...result,
                };
            } catch (err) {
                log.error({ err: err.message }, 'advanced research failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Research Keyword (Legacy) ───
    fastify.post('/api/keywords/research', {
        schema: {
            body: {
                type: 'object',
                required: ['keyword'],
                properties: {
                    keyword: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                },
            },
        },
        handler: async (request, reply) => {
            const { keyword, location = 'India' } = request.body;

            try {
                log.info({ keyword, location }, 'researching keyword');

                // Get search volume and competition
                const volumeData = await keywordService.estimateSearchVolume(keyword, location);

                // Get SERP results
                const serpResults = await keywordService.getSERPResults(keyword, location, 20);

                // Analyze intent
                const intent = keywordService.analyzeKeywordIntent(keyword);

                // Store keyword in database
                const result = await db.query(
                    `INSERT INTO keywords (keyword, location, search_volume, competition, cpc, difficulty)
                     VALUES ($1, $2, $3, $4, $5, $6)
                     ON CONFLICT (keyword, location) DO UPDATE SET
                         search_volume = $3,
                         competition = $4,
                         cpc = $5,
                         difficulty = $6,
                         updated_at = NOW()
                     RETURNING id`,
                    [keyword, location, volumeData.volume, volumeData.competition, volumeData.cpc, volumeData.difficulty]
                );

                const keywordId = result.rows[0].id;

                // Store competitors
                for (const serp of serpResults) {
                    await db.query(
                        `INSERT INTO competitors (domain, keyword_id, rank_position, url, title, description)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (domain, keyword_id) DO UPDATE SET
                             rank_position = $3,
                             url = $4,
                             title = $5,
                             description = $6,
                             discovered_at = NOW()`,
                        [serp.domain, keywordId, serp.position, serp.url, serp.title, serp.description]
                    );
                }

                // Get additional keyword suggestions
                const suggestions = await keywordService.getKeywordSuggestions(keyword, location);

                return {
                    success: true,
                    keyword: {
                        id: keywordId,
                        keyword,
                        location,
                        searchVolume: volumeData.volume,
                        competition: volumeData.competition,
                        cpc: volumeData.cpc,
                        difficulty: volumeData.difficulty,
                        relatedSearches: volumeData.relatedSearches || [],
                    },
                    intent: {
                        primary: intent.primary,
                        secondary: intent.secondary,
                        stage: intent.stage,
                    },
                    relatedKeywords: suggestions.map(s => ({
                        keyword: s.keyword,
                        type: s.type,
                        source: s.source,
                    })),
                    competitors: serpResults.map(r => ({
                        domain: r.domain,
                        position: r.position,
                        url: r.url,
                        title: r.title,
                        description: r.description,
                    })),
                    totalResults: serpResults.length,
                    totalRelated: suggestions.length,
                };
            } catch (err) {
                log.error({ err: err.message }, 'keyword research failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Keyword Details ───
    fastify.get('/api/keywords/:id', async (request, reply) => {
        const { id } = request.params;

        try {
            const keywordResult = await db.query(
                'SELECT * FROM keywords WHERE id = $1',
                [id]
            );

            if (keywordResult.rows.length === 0) {
                return reply.code(404).send({ error: 'Keyword not found' });
            }

            const competitorsResult = await db.query(
                'SELECT * FROM competitors WHERE keyword_id = $1 ORDER BY rank_position',
                [id]
            );

            return {
                keyword: keywordResult.rows[0],
                competitors: competitorsResult.rows,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get keyword');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── List All Keywords ───
    fastify.get('/api/keywords', async (request, reply) => {
        const { limit = 50, offset = 0, search } = request.query;

        try {
            let query = 'SELECT * FROM keywords';
            const params = [];

            if (search) {
                query += ' WHERE keyword ILIKE $1';
                params.push(`%${search}%`);
            }

            query += ' ORDER BY updated_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
            params.push(limit, offset);

            const result = await db.query(query, params);

            const countResult = await db.query(
                search 
                    ? 'SELECT COUNT(*) as total FROM keywords WHERE keyword ILIKE $1'
                    : 'SELECT COUNT(*) as total FROM keywords',
                search ? [`%${search}%`] : []
            );

            return {
                keywords: result.rows,
                total: parseInt(countResult.rows[0].total),
                limit,
                offset,
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to list keywords');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Keyword Suggestions ───
    fastify.post('/api/keywords/suggestions', {
        schema: {
            body: {
                type: 'object',
                required: ['seed'],
                properties: {
                    seed: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                },
            },
        },
        handler: async (request, reply) => {
            const { seed, location = 'India' } = request.body;

            try {
                const suggestions = await keywordService.getKeywordSuggestions(seed, location);

                return {
                    seed,
                    suggestions,
                    total: suggestions.length,
                    byType: {
                        autocomplete: suggestions.filter(s => s.type === 'autocomplete'),
                        related: suggestions.filter(s => s.type === 'related'),
                        questions: suggestions.filter(s => s.type === 'question'),
                    },
                };
            } catch (err) {
                log.error({ err: err.message }, 'suggestions failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Related Keywords (Quick) ───
    fastify.get('/api/keywords/related/:keyword', async (request, reply) => {
        const { keyword } = request.params;

        try {
            const suggestions = await keywordService.getKeywordSuggestions(keyword, 'India');

            return {
                keyword,
                related: suggestions.map(s => s.keyword),
                total: suggestions.length,
            };
        } catch (err) {
            log.error({ err: err.message }, 'related keywords failed');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Delete Keyword ───
    fastify.delete('/api/keywords/:id', async (request, reply) => {
        const { id } = request.params;

        try {
            await db.query('DELETE FROM keywords WHERE id = $1', [id]);
            return { success: true, message: 'Keyword deleted' };
        } catch (err) {
            log.error({ err: err.message }, 'failed to delete keyword');
            return reply.code(500).send({ error: err.message });
        }
    });

    // ─── Get Dashboard Stats ───
    fastify.get('/api/stats', async (request, reply) => {
        try {
            const [keywords, competitors, alerts, rankings] = await Promise.all([
                db.query('SELECT COUNT(*) as total FROM keywords'),
                db.query('SELECT COUNT(DISTINCT domain) as total FROM competitors'),
                db.query('SELECT COUNT(*) as total FROM alerts WHERE is_read = FALSE'),
                db.query('SELECT COUNT(*) as total FROM domain_rankings WHERE rank_position <= 10'),
            ]);

            return {
                totalKeywords: parseInt(keywords.rows[0].total),
                totalCompetitors: parseInt(competitors.rows[0].total),
                unreadAlerts: parseInt(alerts.rows[0].total),
                topRankings: parseInt(rankings.rows[0].total),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get stats');
            return reply.code(500).send({ error: err.message });
        }
    });
}

module.exports = keywordRoutes;
