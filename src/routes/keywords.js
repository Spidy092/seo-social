/**
 * 🔍 Keyword Research Routes
 */

const keywordService = require('../services/keywordService');
const googleAdsService = require('../services/googleAdsService');
const contentBriefService = require('../services/contentBriefService');
const { createLogger } = require('../utils/logger');
const { getAgencyContext, requireAgencyContext, assertProjectAccess } = require('../utils/authHelper');


const log = createLogger('routes:keywords');

const VALID_INTENTS = new Set(['informational', 'navigational', 'commercial', 'transactional']);

function normalizeBulkKeywordItems(items = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
        .map(item => {
            const raw = typeof item === 'string' ? { keyword: item } : item || {};
            const keyword = String(raw.keyword || '').trim();
            const key = keyword.toLowerCase();
            if (!keyword || seen.has(key)) return null;
            seen.add(key);
            return {
                keyword,
                volume: Number(raw.volume || raw.searchVolume || 0),
                competition: String(raw.competition || 'unknown').toLowerCase(),
                cpc: Number(raw.cpc || 0),
                difficulty: Number(raw.difficulty || 0),
                intent: VALID_INTENTS.has(raw.intent) ? raw.intent : keywordService.analyzeKeywordIntent(keyword).primary,
                priorityScore: Number(raw.priorityScore || raw.opportunityScore || 0),
            };
        })
        .filter(Boolean)
        .slice(0, 100);
}

function taskPriorityFromKeyword(item) {
    if (item.priorityScore >= 70 || item.intent === 'transactional') return 'high';
    if (item.priorityScore >= 40 || item.intent === 'commercial') return 'medium';
    return 'low';
}

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

    // ─── Check Google Ads Credential Status ───
    fastify.get('/api/keywords/check-ads', async (request, reply) => {
        const status = await googleAdsService.checkCredentials();
        return {
            googleAds: status,
            dataSource: status.valid
                ? '✅ Real volume from Google Ads Keyword Planner'
                : '⚠️ Estimated volume (Google Ads not connected)',
        };
    });

    // ─── Test Single Keyword Volume (Google Ads) ───
    fastify.get('/api/keywords/volume-test', async (request, reply) => {
        const { keyword = 'seo services india', location = 'India' } = request.query;
        try {
            const data = await googleAdsService.getSingleKeywordVolume(keyword, location);
            return {
                success: true,
                keyword,
                location,
                result: data,
                isReal: data?.isReal ?? false,
            };
        } catch (err) {
            return reply.code(500).send({ error: err.message });
        }
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
                    projectId: { type: 'string' },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;

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
                projectId,
            } = request.body;

            try {
                let project = null;
                if (projectId) {
                    project = await assertProjectAccess(db, projectId, ctx.agencyId);
                    if (!project) return reply.code(403).send({ error: 'Project not found or access denied' });
                }

                log.info({ keyword, location, agencyId: ctx.agencyId }, 'advanced keyword research');

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

                if (projectId && project) {
                    await db.query(
                        `INSERT INTO seo_project_keywords (project_id, keyword_id, intent, priority_score)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (project_id, keyword_id) DO UPDATE SET
                             intent = COALESCE($3, seo_project_keywords.intent),
                             priority_score = GREATEST(seo_project_keywords.priority_score, $4)`,
                        [projectId, keywordId, result.intent?.primary || null, result.metrics.opportunityScore || 0]
                    );
                    await db.query(`UPDATE seo_projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
                    await db.query(`UPDATE seo_clients SET updated_at = NOW() WHERE id = $1`, [project.client_id]);
                }

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


    // ─── Save Selected Research Keywords to Project / Tasks / Briefs ───
    fastify.post('/api/keywords/project-bulk', {
        schema: {
            body: {
                type: 'object',
                required: ['projectId', 'keywords'],
                properties: {
                    projectId: { type: 'string' },
                    location: { type: 'string', default: 'India' },
                    keywords: {
                        type: 'array',
                        minItems: 1,
                        maxItems: 100,
                        items: {
                            type: 'object',
                            required: ['keyword'],
                            properties: {
                                keyword: { type: 'string' },
                                volume: { type: 'number' },
                                competition: { type: 'string' },
                                cpc: { type: 'number' },
                                difficulty: { type: 'number' },
                                intent: { type: 'string' },
                                priorityScore: { type: 'number' },
                            },
                        },
                    },
                    saveKeywords: { type: 'boolean', default: true },
                    createTasks: { type: 'boolean', default: false },
                    createBriefs: { type: 'boolean', default: false },
                    briefLimit: { type: 'integer', default: 3, minimum: 1, maximum: 5 },
                },
            },
        },
        handler: async (request, reply) => {
            const ctx = await requireAgencyContext(request, reply, db);
            if (!ctx) return;
            const {
                projectId,
                location = 'India',
                saveKeywords = true,
                createTasks = false,
                createBriefs = false,
                briefLimit = 3,
            } = request.body;
            const items = normalizeBulkKeywordItems(request.body.keywords);

            if (!items.length) {
                return reply.code(400).send({ error: 'At least one keyword is required' });
            }

            try {
                const projectAccess = await db.query(
                    `SELECT p.id, p.client_id, p.name AS project_name, c.website_url, c.agency_id
                     FROM seo_projects p
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE p.id = $1 AND c.agency_id = $2`,
                    [projectId, ctx.agencyId]
                );

                const project = projectAccess.rows[0];
                if (!project) {
                    return reply.code(404).send({ error: 'Project not found' });
                }

                let savedKeywords = 0;
                let linkedKeywords = 0;
                let tasksCreated = 0;
                let briefsCreated = 0;
                const briefErrors = [];

                for (const item of items) {
                    const keywordResult = await db.query(
                        `INSERT INTO keywords (keyword, location, search_volume, competition, cpc, difficulty)
                         VALUES ($1, $2, $3, $4, $5, $6)
                         ON CONFLICT (keyword, location) DO UPDATE SET
                             search_volume = GREATEST(keywords.search_volume, $3),
                             competition = COALESCE(NULLIF($4, 'unknown'), keywords.competition),
                             cpc = GREATEST(keywords.cpc, $5),
                             difficulty = GREATEST(keywords.difficulty, $6),
                             updated_at = NOW()
                         RETURNING id`,
                        [item.keyword, location, item.volume, item.competition, item.cpc, item.difficulty]
                    );

                    savedKeywords++;
                    const keywordId = keywordResult.rows[0].id;

                    if (saveKeywords) {
                        await db.query(
                            `INSERT INTO seo_project_keywords (project_id, keyword_id, intent, priority_score)
                             VALUES ($1, $2, $3, $4)
                             ON CONFLICT (project_id, keyword_id) DO UPDATE SET
                                 intent = COALESCE($3, seo_project_keywords.intent),
                                 priority_score = GREATEST(seo_project_keywords.priority_score, $4)`,
                            [projectId, keywordId, item.intent, item.priorityScore]
                        );
                        linkedKeywords++;
                    }

                    if (createTasks) {
                        const title = `Create or optimize page for "${item.keyword}"`;
                        const existing = await db.query(
                            `SELECT id FROM seo_tasks WHERE project_id = $1 AND LOWER(title) = LOWER($2) LIMIT 1`,
                            [projectId, title]
                        );

                        if (!existing.rows.length) {
                            await db.query(
                                `INSERT INTO seo_tasks (user_id, agency_id, client_id, project_id, title, description, category, impact, effort, priority, status)
                                 VALUES ($1, $2, $3, $4, $5, $6, 'content', $7, 'medium', $8, 'todo')`,
                                [
                                    ctx?.userId || null,
                                    ctx?.agencyId || null,
                                    project.client_id,
                                    projectId,
                                    title,
                                    `Build a search-intent matched page or section for "${item.keyword}". Include the keyword naturally in title/H1, answer related questions, add internal links, and connect it to the project conversion goal. Intent: ${item.intent}.`,
                                    item.intent === 'transactional' || item.intent === 'commercial' ? 'high' : 'medium',
                                    taskPriorityFromKeyword(item),
                                ]
                            );
                            tasksCreated++;
                        }
                    }
                }

                if (createBriefs) {
                    const briefItems = items.slice(0, Math.min(Number(briefLimit) || 3, 5));
                    for (const item of briefItems) {
                        try {
                            const brief = await contentBriefService.generateContentBrief({
                                keyword: item.keyword,
                                location,
                                projectId,
                                myDomain: project.website_url || '',
                                numResults: 8,
                                useAi: false,
                            });

                            await db.query(
                                `INSERT INTO content_briefs
                                 (user_id, agency_id, project_id, keyword, location, brief, source_metrics)
                                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                                [
                                    ctx?.userId || null,
                                    ctx?.agencyId || null,
                                    projectId,
                                    brief.keyword,
                                    brief.location,
                                    JSON.stringify(brief),
                                    JSON.stringify(brief.sourceData || {}),
                                ]
                            );
                            briefsCreated++;
                        } catch (err) {
                            briefErrors.push({ keyword: item.keyword, error: err.message });
                            log.warn({ err: err.message, keyword: item.keyword, projectId }, 'bulk content brief failed');
                        }
                    }
                }

                await db.query(`UPDATE seo_projects SET updated_at = NOW() WHERE id = $1`, [projectId]);
                await db.query(`UPDATE seo_clients SET updated_at = NOW() WHERE id = $1`, [project.client_id]);

                return {
                    success: true,
                    savedKeywords,
                    linkedKeywords,
                    tasksCreated,
                    briefsCreated,
                    briefErrors,
                };
            } catch (err) {
                log.error({ err: err.message, projectId }, 'bulk keyword project action failed');
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
                        volume: s.volume || 0,
                        competition: s.competition || 'unknown',
                        cpc: s.cpc || 0,
                        difficulty: s.difficulty || 0,
                        intent: s.intent || 'informational',
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
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            const keywordResult = await db.query(
                `SELECT DISTINCT k.*
                 FROM keywords k
                 JOIN seo_project_keywords spk ON spk.keyword_id = k.id
                 JOIN seo_projects p ON p.id = spk.project_id
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE k.id = $1 AND c.agency_id = $2`,
                [id, ctx.agencyId]
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
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;

        try {
            const params = [ctx.agencyId];
            let where = 'c.agency_id = $1';
            if (search) {
                params.push(`%${search}%`);
                where += ` AND k.keyword ILIKE ${params.length}`;
            }

            const result = await db.query(
                `SELECT DISTINCT k.*
                 FROM keywords k
                 JOIN seo_project_keywords spk ON spk.keyword_id = k.id
                 JOIN seo_projects p ON p.id = spk.project_id
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE ${where}
                 ORDER BY k.updated_at DESC
                 LIMIT ${params.length + 1} OFFSET ${params.length + 2}`,
                [...params, limit, offset]
            );

            const countResult = await db.query(
                `SELECT COUNT(DISTINCT k.id) as total
                 FROM keywords k
                 JOIN seo_project_keywords spk ON spk.keyword_id = k.id
                 JOIN seo_projects p ON p.id = spk.project_id
                 JOIN seo_clients c ON c.id = p.client_id
                 WHERE ${where}`,
                params
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
            const suggestions = await keywordService.getKeywordSuggestions(keyword, 'India', false);

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

    // ─── Keyword Clustering ───
    fastify.post('/api/keywords/cluster', {
        schema: {
            body: {
                type: 'object',
                required: ['keywords'],
                properties: {
                    keywords: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 200 },
                    method: { type: 'string', enum: ['semantic', 'intent', 'ngram'], default: 'semantic' },
                    minSize: { type: 'integer', default: 3, minimum: 2, maximum: 10 },
                },
            },
        },
        handler: async (request, reply) => {
            const { keywords, method = 'semantic', minSize = 3 } = request.body;

            try {
                const clean = [...new Set(keywords.map(k => k.trim()).filter(Boolean))];
                if (clean.length < 2) return reply.code(400).send({ error: 'Need at least 2 keywords' });

                // ─── Helpers ─────────────────────────────────────────────
                const stopWords = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','how','what','when','where','why','which','who','that','this','these','those','i','we','you','he','she','they','it','its','my','our','your','his','her','their','best','top','good','great','new']);

                function tokenize(kw) {
                    return kw.toLowerCase().split(/\W+/).filter(w => w.length > 1 && !stopWords.has(w));
                }

                function ngramSimilarity(a, b) {
                    const tokA = new Set(tokenize(a));
                    const tokB = new Set(tokenize(b));
                    if (!tokA.size && !tokB.size) return 1;
                    if (!tokA.size || !tokB.size) return 0;
                    const intersection = [...tokA].filter(t => tokB.has(t)).length;
                    return intersection / Math.max(tokA.size, tokB.size);
                }

                function ngramOverlap(a, b, n = 2) {
                    function ngrams(str) {
                        const words = tokenize(str);
                        const out = new Set();
                        words.forEach(w => { for (let i = 0; i <= w.length - n; i++) out.add(w.slice(i, i + n)); });
                        return out;
                    }
                    const gA = ngrams(a); const gB = ngrams(b);
                    if (!gA.size && !gB.size) return 1;
                    if (!gA.size || !gB.size) return 0;
                    const inter = [...gA].filter(g => gB.has(g)).length;
                    return inter / Math.max(gA.size, gB.size);
                }

                function simScore(a, b, method) {
                    if (method === 'ngram') return ngramOverlap(a, b);
                    if (method === 'intent') {
                        const iA = keywordService.analyzeKeywordIntent(a).primary;
                        const iB = keywordService.analyzeKeywordIntent(b).primary;
                        if (iA !== iB) return 0;
                        return ngramSimilarity(a, b);
                    }
                    // semantic: token overlap weighted by shared prefix
                    const tok = ngramSimilarity(a, b);
                    const ng  = ngramOverlap(a, b);
                    return tok * 0.6 + ng * 0.4;
                }

                // ─── Greedy clustering ────────────────────────────────────
                const THRESHOLD = method === 'ngram' ? 0.25 : 0.20;
                const assigned = new Array(clean.length).fill(-1);
                const groups = []; // [{members: [idx,...]}]

                for (let i = 0; i < clean.length; i++) {
                    if (assigned[i] !== -1) continue;
                    let bestGroup = -1; let bestScore = THRESHOLD;
                    for (let g = 0; g < groups.length; g++) {
                        const centroid = groups[g].centroid;
                        const score = simScore(clean[i], centroid, method);
                        if (score > bestScore) { bestScore = score; bestGroup = g; }
                    }
                    if (bestGroup === -1) {
                        groups.push({ centroid: clean[i], members: [i], scores: { [i]: 1.0 } });
                        assigned[i] = groups.length - 1;
                    } else {
                        groups[bestGroup].members.push(i);
                        groups[bestGroup].scores[i] = bestScore;
                        assigned[i] = bestGroup;
                    }
                }

                // ─── Build result clusters ────────────────────────────────
                const clusters = [];
                const ungrouped = [];

                groups.forEach(g => {
                    if (g.members.length < minSize) {
                        g.members.forEach(idx => ungrouped.push(clean[idx]));
                        return;
                    }
                    const kwObjs = g.members.map(idx => {
                        const kw = clean[idx];
                        const intent = keywordService.analyzeKeywordIntent(kw).primary;
                        return { keyword: kw, intent, similarity: g.scores[idx] || 0 };
                    }).sort((a, b) => b.similarity - a.similarity);

                    // Dominant intent
                    const intentMap = {};
                    kwObjs.forEach(k => { intentMap[k.intent] = (intentMap[k.intent] || 0) + 1; });
                    const dominantIntent = Object.entries(intentMap).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';
                    const isMultiIntent = Object.keys(intentMap).length > 1 && Math.max(...Object.values(intentMap)) / kwObjs.length < 0.7;

                    // Cluster label: top shared tokens or centroid
                    const centroidToks = tokenize(g.centroid);
                    const label = centroidToks.length
                        ? centroidToks.slice(0, 3).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
                        : g.centroid;

                    clusters.push({
                        label,
                        dominantIntent: isMultiIntent ? 'mixed' : dominantIntent,
                        keywords: kwObjs,
                    });
                });

                // Sort clusters by size desc
                clusters.sort((a, b) => b.keywords.length - a.keywords.length);

                log.info({ total: clean.length, clusters: clusters.length, ungrouped: ungrouped.length, method }, 'keyword clustering done');

                return { success: true, clusters, ungrouped, total: clean.length };
            } catch (err) {
                log.error({ err: err.message }, 'keyword clustering failed');
                return reply.code(500).send({ error: err.message });
            }
        },
    });

    // ─── Get Dashboard Stats ───
    fastify.get('/api/stats', async (request, reply) => {
        const ctx = await getAgencyContext(request, db);
        if (!ctx) return reply.code(401).send({ error: 'Unauthorized' });

        try {
            const [keywords, competitors, alerts, rankings] = await Promise.all([
                db.query(
                    `SELECT COUNT(DISTINCT k.id) AS total
                     FROM keywords k
                     JOIN seo_project_keywords spk ON spk.keyword_id = k.id
                     JOIN seo_projects p ON p.id = spk.project_id
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.agency_id = $1`,
                    [ctx.agencyId]
                ),
                db.query(
                    `SELECT COUNT(DISTINCT comp.domain) AS total
                     FROM competitors comp
                     JOIN seo_project_keywords spk ON spk.keyword_id = comp.keyword_id
                     JOIN seo_projects p ON p.id = spk.project_id
                     JOIN seo_clients c ON c.id = p.client_id
                     WHERE c.agency_id = $1`,
                    [ctx.agencyId]
                ),
                db.query('SELECT COUNT(*) AS total FROM alerts WHERE agency_id = $1 AND is_read = FALSE', [ctx.agencyId]),
                db.query('SELECT COUNT(*) AS total FROM domain_rankings WHERE agency_id = $1 AND rank_position <= 10', [ctx.agencyId]),
            ]);

            return {
                totalKeywords: parseInt(keywords.rows[0].total),
                totalCompetitors: parseInt(competitors.rows[0].total),
                unreadAlerts: parseInt(alerts.rows[0].total),
                topRankings: parseInt(rankings.rows[0].total),
            };
        } catch (err) {
            log.error({ err: err.message }, 'failed to get stats');
            return reply.code(500).send({ error: 'Unable to load workspace stats right now' });
        }
    });
}

module.exports = keywordRoutes;
