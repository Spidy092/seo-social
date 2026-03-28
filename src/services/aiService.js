/**
 * 🤖 AI Service
 * 
 * Handles interaction with LLM providers (OpenRouter, Groq) to provide 
 * expert analysis and intelligent comparisons.
 */

const axios = require('axios');
const config = require('../config');
const { createLogger } = require('../utils/logger');

const log = createLogger('ai-service');

/**
 * Analyze the comparison data using an LLM to provide expert insights.
 * 
 * @param {Object} comparisonData - Data containing domain metrics, SEO scores, and content stats.
 * @returns {Promise<Object>} - AI-generated expert analysis and score.
 */
async function analyzeComparison(comparisonData) {
    const { keyword, myDomain, competitorDomain, scores } = comparisonData;

    log.info({ myDomain, competitorDomain, keyword }, 'performing AI expert analysis');

    // Prepare the prompt
    const prompt = `
        As an expert SEO consultant, analyze the following comparison between my website (${myDomain}) and my competitor (${competitorDomain}) for the target keyword: "${keyword}".
        
        DATA:
        - My OpenPageRank: ${scores.domainAuthority?.mine || 'Unknown'} (vs Competitor: ${scores.domainAuthority?.competitor || 'Unknown'})
        - My Word Count: ${scores.content?.wordCount?.mine || 0} (vs Competitor: ${scores.content?.wordCount?.competitor || 0})
        - My Keyword Density: ${scores.content?.keywordDensity?.mine || 0}% (vs Competitor: ${scores.content?.keywordDensity?.competitor || 0}%)
        - My SEO Score: ${scores.seo?.scores?.mine || 0}/100 (vs Competitor: ${scores.seo?.scores?.competitor || 0}/100)
        
        Detailed Differences (advantages for both sides):
        ${JSON.stringify(comparisonData.keyDifferences, null, 2)}

        Based on this technical data, provide:
        1. An "AI Expert Score" (0-100) representing how well my domain is doing compared to the competitor. (100 = dominating, 50 = even, 0 = crushed).
        2. A "Verdict" (e.g., "Dominating", "Competitive", "At Risk", "Behind").
        3. A "Strategic Summary" (2-3 sentences explaining who is actually winning and why, based on the data).
        4. "Key Observation" (One specific thing that either domain is doing significantly better than the other).

        Format your response ONLY as valid JSON:
        {
            "aiScore": number,
            "verdict": "string",
            "strategicSummary": "string",
            "keyObservation": "string"
        }
    `;

    try {
        let response;
        
        // Try OpenRouter first (Aggregator for free models)
        if (config.apis.openRouter && config.apis.openRouter.key) {
            try {
                log.debug('attempting analysis via OpenRouter');
                response = await axios.post(config.apis.openRouter.url, {
                    model: config.apis.openRouter.model,
                    messages: [{ role: 'user', content: prompt }]
                    // Removed response_format for compatibility
                }, {
                    headers: {
                        'Authorization': `Bearer ${config.apis.openRouter.key}`,
                        'HTTP-Referer': 'http://localhost:4000',
                        'X-Title': 'SEO Keyword Analyzer',
                        'Content-Type': 'application/json'
                    },
                    timeout: 20000
                });
            } catch (err) {
                const errorData = err.response?.data;
                log.warn({ err: err.message, errorData }, 'OpenRouter failed, falling back to Groq');
            }
        }

        // Fallback to Groq if OpenRouter failed
        if (!response && config.apis.groq && config.apis.groq.key) {
            try {
                log.debug('attempting analysis via Groq');
                response = await axios.post(config.apis.groq.url, {
                    model: config.apis.groq.model,
                    messages: [{ role: 'user', content: prompt }]
                    // Removed response_format for compatibility
                }, {
                    headers: {
                        'Authorization': `Bearer ${config.apis.groq.key}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 20000
                });
            } catch (err) {
                const errorData = err.response?.data;
                log.warn({ err: err.message, errorData }, 'Groq fallback failed');
            }
        }

        if (response && response.data?.choices?.[0]?.message?.content) {
            const content = response.data.choices[0].message.content.trim();
            log.debug({ contentLength: content.length }, 'received AI response');

            try {
                // Find JSON block if model added conversational text
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                return JSON.parse(content);
            } catch (pErr) {
                log.error({ pErr: pErr.message, content }, 'failed to parse AI response as JSON');
                throw new Error('Invalid JSON format from AI');
            }
        }

        throw new Error('No AI response received from any provider');
    } catch (err) {
        log.error({ err: err.message }, 'AI analysis failed');
        return {
            aiScore: 0,
            verdict: 'Analysis Unavailable',
            strategicSummary: 'Could not reach AI experts to analyze the data. Please check your API keys.',
            keyObservation: 'Check your OpenRouter/Groq API keys in the .env file.'
        };
    }
}

module.exports = {
    analyzeComparison
};
