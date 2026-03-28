/**
 * 📊 Analysis Service
 * 
 * Compares domains, analyzes why competitors rank, and generates improvement suggestions.
 */

const { createLogger } = require('../utils/logger');
const keywordService = require('./keywordService');
const aiService = require('./aiService');
const { analyzeWhyCompetitorRanks } = require('./analysisService'); 

const log = createLogger('analysis-service');

// ─── Compare My Domain vs Competitor ───
async function compareDomains(myDomain, competitorDomain, keyword, myPageData = null, competitorPageData = null) {
    log.info({ myDomain, competitorDomain, keyword }, 'comparing domains');

    const comparison = {
        keyword,
        myDomain,
        competitorDomain,
        timestamp: new Date().toISOString(),
        scores: {},
        differences: {},
        keyDifferences: [],
        suggestions: [],
    };

    try {
        // Domain extraction safety (handles full URLs if pasted)
        const myCleanDomain = keywordService.extractDomain(myDomain);
        const compCleanDomain = keywordService.extractDomain(competitorDomain);

        log.info({ myCleanDomain, compCleanDomain }, 'normalized domains for comparison');

        // Get domain authorities
        const [myDA, competitorDA] = await Promise.all([
            keywordService.getDomainAuthority(myCleanDomain),
            keywordService.getDomainAuthority(compCleanDomain),
        ]);

        comparison.scores.domainAuthority = {
            mine: myDA,
            competitor: competitorDA,
            difference: competitorDA - myDA,
        };

        // If we have page data, compare content
        if (myPageData && competitorPageData) {
            comparison.scores.content = compareContent(myPageData, competitorPageData);
            comparison.scores.seo = compareSEO(myPageData, competitorPageData);
        }

        // Analyze key differences (for both sides)
        comparison.keyDifferences = analyzeKeyDifferences(
            comparison.scores,
            myPageData,
            competitorPageData
        );

        // Generate suggestions
        comparison.suggestions = generateSuggestions(
            comparison.scores,
            comparison.keyDifferences,
            myPageData,
            competitorPageData
        );

        // Calculate overall score
        comparison.overallScore = calculateOverallScore(comparison.scores);

        // Perform AI Analysis for expert feedback
        comparison.aiAnalysis = await aiService.analyzeComparison(comparison);

        return comparison;
    } catch (err) {
        log.error({ err: err.message }, 'comparison failed');
        return { ...comparison, error: err.message };
    }
}

// ─── Compare Content ───
function compareContent(myPage, competitorPage) {
    const myKW = myPage.keywordAnalysis || {};
    const compKW = competitorPage.keywordAnalysis || {};

    return {
        wordCount: {
            mine: myPage.wordCount || 0,
            competitor: competitorPage.wordCount || 0,
            difference: (competitorPage.wordCount || 0) - (myPage.wordCount || 0),
            winner: (competitorPage.wordCount || 0) > (myPage.wordCount || 0) ? 'competitor' : 'mine',
        },
        keywordDensity: {
            mine: myKW.density || 0,
            competitor: compKW.density || 0,
            difference: ((compKW.density || 0) - (myKW.density || 0)).toFixed(2),
            winner: (compKW.density || 0) > (myKW.density || 0) ? 'competitor' : 'mine',
        },
        exactMatches: {
            mine: myKW.exactMatches || 0,
            competitor: compKW.exactMatches || 0,
            difference: (compKW.exactMatches || 0) - (myKW.exactMatches || 0),
            winner: (compKW.exactMatches || 0) > (myKW.exactMatches || 0) ? 'competitor' : 'mine',
        },
    };
}

// ─── Compare SEO Elements ───
function compareSEO(myPage, competitorPage) {
    const mySEO = myPage.seoElements || {};
    const compSEO = competitorPage.seoElements || {};

    const checks = {
        hasH1: { mine: mySEO.hasH1, competitor: compSEO.hasH1 },
        hasMetaDescription: { mine: mySEO.hasMetaDescription, competitor: compSEO.hasMetaDescription },
        hasSchema: { mine: mySEO.hasSchema, competitor: compSEO.hasSchema },
        internalLinks: { mine: mySEO.internalLinks || 0, competitor: compSEO.internalLinks || 0 },
        externalLinks: { mine: mySEO.externalLinks || 0, competitor: compSEO.externalLinks || 0 },
        images: { mine: mySEO.images || 0, competitor: compSEO.images || 0 },
        imagesWithAlt: { mine: mySEO.imagesWithAlt || 0, competitor: compSEO.imagesWithAlt || 0 },
    };

    // Calculate SEO score
    let myScore = 0;
    let compScore = 0;

    if (mySEO.hasH1) myScore += 15;
    if (compSEO.hasH1) compScore += 15;
    if (mySEO.hasMetaDescription) myScore += 15;
    if (compSEO.hasMetaDescription) compScore += 15;
    if (mySEO.hasSchema) myScore += 20;
    if (compSEO.hasSchema) compScore += 20;
    
    // Link score (more internal links = better)
    myScore += Math.min(25, (mySEO.internalLinks || 0) * 2);
    compScore += Math.min(25, (compSEO.internalLinks || 0) * 2);
    
    // Image alt text score
    const myAltRatio = mySEO.images > 0 ? (mySEO.imagesWithAlt / mySEO.images) : 0;
    const compAltRatio = compSEO.images > 0 ? (compSEO.imagesWithAlt / compSEO.images) : 0;
    myScore += Math.round(myAltRatio * 25);
    compScore += Math.round(compAltRatio * 25);

    return {
        checks,
        scores: {
            mine: myScore,
            competitor: compScore,
            difference: compScore - myScore,
            winner: compScore > myScore ? 'competitor' : 'mine',
        },
    };
}

// ─── Analyze Key Differences ───
function analyzeKeyDifferences(scores, myPage, competitorPage) {
    const differences = [];

    // Helper to add difference
    const addDiff = (factor, impact, mineScore, compScore, explanationTpl, gapUnit) => {
        if (mineScore === compScore) return;
        
        const isMineBetter = mineScore > compScore;
        const winner = isMineBetter ? 'mine' : 'competitor';
        const gap = Math.abs(mineScore - compScore);
        
        // Don't add if the gap is too small to mention
        if (factor === 'Keyword Density' && gap < 0.5) return;
        if (factor === 'Domain Authority' && gap <= 5) return;
        if (factor === 'Content Length' && gap < 200) return;
        if (factor === 'Keyword Usage' && gap <= 2) return;
        if (factor === 'SEO Optimization' && gap <= 10) return;

        const explanation = explanationTpl
            .replace('{winner}', isMineBetter ? 'Your domain' : 'The competitor')
            .replace('{loser}', isMineBetter ? 'the competitor' : 'your domain')
            .replace('{winScore}', isMineBetter ? mineScore : compScore)
            .replace('{loseScore}', isMineBetter ? compScore : mineScore);

        differences.push({
            factor,
            impact,
            winner,
            explanation,
            gap: `${isMineBetter ? 'You win by' : 'Competitor leads by'} ${gap} ${gapUnit}`,
        });
    };

    // Domain Authority
    if (scores.domainAuthority) {
        addDiff('Domain Authority', 'HIGH', 
            scores.domainAuthority.mine, 
            scores.domainAuthority.competitor, 
            `{winner} has DA {winScore} vs {loser}'s DA {loseScore}. Higher DA means more trust from Google.`, 
            'DA points'
        );
    }

    // Content Length
    if (scores.content?.wordCount) {
        addDiff('Content Length', 'MEDIUM',
            scores.content.wordCount.mine,
            scores.content.wordCount.competitor,
            `{winner} has {winScore} words vs {loser}'s {loseScore} words. Richer content often ranks better for informational queries.`,
            'words'
        );
    }

    // Keyword Density
    if (scores.content?.keywordDensity) {
        addDiff('Keyword Density', 'MEDIUM',
            scores.content.keywordDensity.mine,
            scores.content.keywordDensity.competitor,
            `{winner} uses the keyword more effectively ({winScore}% vs {loseScore}%). Better keyword optimization.`,
            '% density'
        );
    }

    // Exact Keyword Matches
    if (scores.content?.exactMatches) {
        addDiff('Keyword Usage', 'MEDIUM',
            scores.content.exactMatches.mine,
            scores.content.exactMatches.competitor,
            `{winner} mentions the keyword {winScore} times vs {loser}'s {loseScore} times.`,
            'mentions'
        );
    }

    // SEO Elements
    if (scores.seo?.scores) {
        addDiff('SEO Optimization', 'HIGH',
            scores.seo.scores.mine,
            scores.seo.scores.competitor,
            `{winner} has better on-page SEO (headings, meta tags, schema markup) with a score of {winScore} vs {loseScore}.`,
            'SEO points'
        );
    }

    // Specific Binary SEO Checks
    const checkBinary = (factor, impact, myStatus, compStatus, explanationMine, explanationComp, gapMsg) => {
        if (myStatus && !compStatus) {
            differences.push({ factor, impact, winner: 'mine', explanation: explanationMine, gap: gapMsg });
        } else if (compStatus && !myStatus) {
            differences.push({ factor, impact, winner: 'competitor', explanation: explanationComp, gap: gapMsg });
        }
    };

    // H1 Tag
    checkBinary('H1 Tag', 'HIGH', 
        myPage?.seoElements?.hasH1, competitorPage?.seoElements?.hasH1,
        `Your page has an H1 tag, but the competitor is missing one.`,
        `Your page is missing an H1 tag. Competitor has: "${competitorPage?.seoElements?.h1Text}"`,
        'H1 Tag Presence'
    );

    // Meta Description
    checkBinary('Meta Description', 'MEDIUM',
        myPage?.seoElements?.hasMetaDescription, competitorPage?.seoElements?.hasMetaDescription,
        `You have a meta description, but the competitor doesn't. This helps your click-through rate.`,
        `Your page is missing a meta description. This affects click-through rate from search results.`,
        'Meta Description Presence'
    );

    // Schema Markup
    checkBinary('Schema Markup', 'MEDIUM',
        myPage?.seoElements?.hasSchema, competitorPage?.seoElements?.hasSchema,
        `You use structured data (schema markup) which helps Google understand your content better. Competitor does not.`,
        `Competitor uses structured data (schema markup) which helps Google understand the content better. You do not.`,
        'Schema Markup Presence'
    );

    // Internal Links
    const myLinks = myPage?.seoElements?.internalLinks || 0;
    const compLinks = competitorPage?.seoElements?.internalLinks || 0;
    if (Math.abs(myLinks - compLinks) > 5) {
        addDiff('Internal Linking', 'MEDIUM',
            myLinks, compLinks,
            `{winner} has {winScore} internal links vs {loser}'s {loseScore}. Better internal linking helps with page authority distribution.`,
            'internal links'
        );
    }

    // Sort by impact
    const impactOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    differences.sort((a, b) => impactOrder[a.impact] - impactOrder[b.impact]);

    return differences;
}

// ─── Generate Improvement Suggestions ───
function generateSuggestions(scores, reasons, myPage, competitorPage) {
    const suggestions = [];

    // Content suggestions
    if (scores.content?.wordCount?.difference > 200) {
        suggestions.push({
            priority: 'HIGH',
            category: 'Content',
            action: `Add ${Math.ceil(scores.content.wordCount.difference / 100) * 100} more words to your content`,
            details: [
                'Add more detailed sections',
                'Include FAQs related to the topic',
                'Add examples and case studies',
                'Include statistics and data',
            ],
            estimatedImpact: 'Could improve ranking by 5-10 positions',
        });
    }

    // Keyword optimization
    if (scores.content?.keywordDensity?.difference > 0.3) {
        suggestions.push({
            priority: 'HIGH',
            category: 'Keywords',
            action: 'Improve keyword optimization',
            details: [
                'Include keyword in H1 tag',
                'Use keyword in first 100 words',
                'Add keyword to meta title and description',
                'Use related keywords naturally',
                'Target density: 1-2%',
            ],
            estimatedImpact: 'Could improve ranking by 3-8 positions',
        });
    }

    // H1 tag
    if (!myPage?.seoElements?.hasH1) {
        suggestions.push({
            priority: 'HIGH',
            category: 'SEO',
            action: 'Add an H1 tag with your target keyword',
            details: [
                'Use only one H1 per page',
                'Include your main keyword',
                'Keep it under 60 characters',
                'Make it compelling for users',
            ],
            estimatedImpact: 'Could improve ranking by 5-15 positions',
        });
    }

    // Meta description
    if (!myPage?.seoElements?.hasMetaDescription) {
        suggestions.push({
            priority: 'MEDIUM',
            category: 'SEO',
            action: 'Add a meta description',
            details: [
                'Keep it between 150-160 characters',
                'Include your target keyword',
                'Add a call-to-action',
                'Make it compelling to click',
            ],
            estimatedImpact: 'Improves click-through rate by 5-10%',
        });
    }

    // Schema markup
    if (!myPage?.seoElements?.hasSchema && competitorPage?.seoElements?.hasSchema) {
        const compSchemaTypes = competitorPage.seoElements.schemaDetails?.detectedTypes || [];
        const pageType = competitorPage.seoElements.pageType?.primary || 'WebPage';
        
        suggestions.push({
            priority: 'MEDIUM',
            category: 'Technical SEO',
            action: 'Add schema markup (structured data)',
            details: [
                `Competitor uses: ${compSchemaTypes.join(', ') || 'schema markup'}`,
                `Detected page type: ${pageType}`,
                'Use Google\'s Rich Results Test to validate',
                'Add matching schema to your page',
            ],
            competitorSchemaTypes: compSchemaTypes,
            pageType,
            estimatedImpact: 'Can get rich snippets in search results',
        });
    }
    
    // Schema validation errors
    if (myPage?.seoElements?.schemaDetails?.errors?.length > 0) {
        suggestions.push({
            priority: 'HIGH',
            category: 'Technical SEO',
            action: 'Fix schema markup errors',
            details: myPage.seoElements.schemaDetails.errors.map(e => e.message),
            estimatedImpact: 'Prevents schema-related indexing issues',
        });
    }
    
    // Schema suggestions based on content
    if (myPage?.seoElements?.schemaSuggestions?.length > 0) {
        const topSuggestion = myPage.seoElements.schemaSuggestions[0];
        if (!myPage.seoElements.hasSchema) {
            suggestions.push({
                priority: topSuggestion.priority === 'CRITICAL' ? 'HIGH' : topSuggestion.priority,
                category: 'Technical SEO',
                action: `Add ${topSuggestion.type} schema`,
                details: [
                    topSuggestion.reason,
                    ...(topSuggestion.fields ? [`Recommended fields: ${topSuggestion.fields.join(', ')}`] : []),
                ],
                schemaExample: topSuggestion.example,
                estimatedImpact: 'May enable rich snippets in search results',
            });
        }
    }

    // Internal linking
    const compLinks = competitorPage?.seoElements?.internalLinks || 0;
    const myLinks = myPage?.seoElements?.internalLinks || 0;
    if (compLinks > myLinks + 3) {
        suggestions.push({
            priority: 'MEDIUM',
            category: 'Link Building',
            action: `Add ${compLinks - myLinks} more internal links`,
            details: [
                'Link from high-authority pages on your site',
                'Use descriptive anchor text',
                'Link to related content',
                'Create a content hub structure',
            ],
            estimatedImpact: 'Improves page authority and crawlability',
        });
    }

    // Domain Authority (long-term)
    if (scores.domainAuthority?.difference > 20) {
        suggestions.push({
            priority: 'LOW',
            category: 'Authority',
            action: 'Build domain authority (long-term strategy)',
            details: [
                'Get backlinks from high-DA sites',
                'Create linkable assets (infographics, tools)',
                'Guest post on relevant sites',
                'Build brand mentions',
            ],
            estimatedImpact: 'Long-term improvement in all rankings',
        });
    }

    // Image optimization
    if (myPage?.seoElements?.images > myPage?.seoElements?.imagesWithAlt) {
        suggestions.push({
            priority: 'LOW',
            category: 'SEO',
            action: 'Add alt text to all images',
            details: [
                `You have ${myPage.seoElements.images} images, ${myPage.seoElements.images - myPage.seoElements.imagesWithAlt} missing alt text`,
                'Use descriptive alt text',
                'Include keywords where relevant',
                'Keep alt text under 125 characters',
            ],
            estimatedImpact: 'Improves image SEO and accessibility',
        });
    }

    // Sort by priority
    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return suggestions;
}

// ─── Calculate Overall Score ───
function calculateOverallScore(scores) {
    let total = 50; // Base score

    // DA contribution
    if (scores.domainAuthority) {
        total += (scores.domainAuthority.mine - 50) * 0.5;
    }

    // Content contribution
    if (scores.content) {
        if (scores.content.wordCount?.winner === 'mine') total += 10;
        else total -= 10;
        
        if (scores.content.keywordDensity?.winner === 'mine') total += 10;
        else total -= 10;
    }

    // SEO contribution
    if (scores.seo) {
        total += (scores.seo.scores?.mine - 50) * 0.3;
    }

    return Math.max(0, Math.min(100, Math.round(total)));
}

// ─── Generate Full Report ───
async function generateReport(keyword, myDomain, competitorDomains, serpResults) {
    log.info({ keyword, myDomain, competitorCount: competitorDomains.length }, 'generating full report');

    const report = {
        keyword,
        myDomain,
        timestamp: new Date().toISOString(),
        serpAnalysis: {},
        competitorAnalysis: [],
        myPosition: null,
        suggestions: [],
        summary: {},
    };

    try {
        // Find my position in SERP
        const myResult = serpResults.find(r => r.domain.includes(myDomain));
        report.myPosition = myResult ? myResult.position : null;

        // Analyze top 5 competitors
        const topCompetitors = serpResults.slice(0, 5);
        
        for (const competitor of topCompetitors) {
            if (competitor.domain.includes(myDomain)) continue;

            const pageAnalysis = await keywordService.analyzePageContent(competitor.url, keyword);
            const da = await keywordService.getDomainAuthority(competitor.domain);

            report.competitorAnalysis.push({
                domain: competitor.domain,
                url: competitor.url,
                position: competitor.position,
                title: competitor.title,
                domainAuthority: da,
                content: {
                    wordCount: pageAnalysis.wordCount,
                    keywordDensity: pageAnalysis.keywordAnalysis.density,
                    exactMatches: pageAnalysis.keywordAnalysis.exactMatches,
                },
                seo: pageAnalysis.seoElements,
            });

            // Rate limit
            await new Promise(r => setTimeout(r, 2000));
        }

        // If I'm ranking, analyze my page
        if (myResult) {
            const myPageAnalysis = await keywordService.analyzePageContent(myResult.url, keyword);
            const myDA = await keywordService.getDomainAuthority(myDomain);

            report.myPage = {
                url: myResult.url,
                position: myResult.position,
                domainAuthority: myDA,
                content: {
                    wordCount: myPageAnalysis.wordCount,
                    keywordDensity: myPageAnalysis.keywordAnalysis.density,
                    exactMatches: myPageAnalysis.keywordAnalysis.exactMatches,
                },
                seo: myPageAnalysis.seoElements,
            };

            // Compare with top competitor
            if (report.competitorAnalysis.length > 0) {
                const topCompetitor = report.competitorAnalysis[0];
                report.comparison = await compareDomains(
                    myDomain,
                    topCompetitor.domain,
                    keyword,
                    myPageAnalysis,
                    {
                        wordCount: topCompetitor.content.wordCount,
                        keywordAnalysis: {
                            density: topCompetitor.content.keywordDensity,
                            exactMatches: topCompetitor.content.exactMatches,
                        },
                        seoElements: topCompetitor.seo,
                    }
                );
            }
        }

        // Generate summary
        report.summary = {
            totalCompetitors: report.competitorAnalysis.length,
            averageDA: Math.round(
                report.competitorAnalysis.reduce((sum, c) => sum + c.domainAuthority, 0) / 
                report.competitorAnalysis.length
            ),
            averageWordCount: Math.round(
                report.competitorAnalysis.reduce((sum, c) => sum + c.content.wordCount, 0) / 
                report.competitorAnalysis.length
            ),
            myRanking: report.myPosition ? `#${report.myPosition}` : 'Not ranking',
            topSuggestion: report.comparison?.suggestions?.[0]?.action || 'Analyze your page first',
        };

        return report;
    } catch (err) {
        log.error({ err: err.message }, 'report generation failed');
        return { ...report, error: err.message };
    }
}

module.exports = {
    compareDomains,
    generateReport,
    analyzeWhyCompetitorRanks,
    generateSuggestions,
    analyzeMultipleCompetitors,
    performGapAnalysis,
};

// ─── Analyze Multiple Competitors ───
async function analyzeMultipleCompetitors(domains, keyword, location = 'India') {
    log.info({ domains, keyword }, 'analyzing multiple competitors');

    const results = [];
    let totalWordCount = 0;
    let totalDA = 0;
    let bestDA = 0;
    let bestWordCount = 0;
    let bestPosition = null;

    // Get SERP data for keyword
    const serpResults = await keywordService.getSERPResults(keyword, location, 50);

    for (const domain of domains) {
        try {
            const analysis = await analyzeSingleDomain(domain, keyword, serpResults);
            results.push(analysis);

            totalWordCount += analysis.pageAnalysis.wordCount || 0;
            totalDA += analysis.domainAuthority || 0;
            
            if (analysis.domainAuthority > bestDA) bestDA = analysis.domainAuthority;
            if (analysis.pageAnalysis.wordCount > bestWordCount) bestWordCount = analysis.pageAnalysis.wordCount;
            if (analysis.serpPosition && (!bestPosition || analysis.serpPosition < bestPosition)) {
                bestPosition = analysis.serpPosition;
            }

            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            log.error({ domain, err: err.message }, 'domain analysis failed');
            results.push({
                domain,
                error: err.message,
                domainAuthority: null,
                pageAnalysis: null,
                seoScore: 0,
            });
        }
    }

    // Calculate benchmarks
    const avgWordCount = Math.round(totalWordCount / results.length);
    const avgDA = Math.round(totalDA / results.length);

    // Build comparison table
    const comparisonTable = buildComparisonTable(results);

    // Find common strengths and weaknesses
    const analysis = analyzePatterns(results);

    return {
        keyword,
        location,
        domains: results,
        benchmarks: {
            averageWordCount: avgWordCount,
            averageDA: avgDA,
            bestDA,
            bestWordCount,
        },
        comparisonTable,
        patterns: analysis,
        serpRanking: serpResults.slice(0, 10).map(r => ({
            domain: r.domain,
            position: r.position,
            title: r.title,
            snippet: r.snippet,
        })),
        timestamp: new Date().toISOString(),
    };
}

// ─── Analyze Single Domain ───
async function analyzeSingleDomain(domain, keyword, serpResults = null) {
    const serpEntry = serpResults?.find(r => r.domain.includes(domain));
    
    // Get domain authority
    const domainAuthority = await keywordService.getDomainAuthority(domain);

    // Analyze page if we have a URL
    let pageAnalysis = null;
    let pageUrl = null;

    if (serpEntry?.url) {
        pageUrl = serpEntry.url;
        pageAnalysis = await keywordService.analyzePageContent(pageUrl, keyword);
    }

    // Calculate SEO score
    const seoScore = calculateDomainSEOScore(pageAnalysis, domainAuthority);

    return {
        domain,
        url: pageUrl,
        serpPosition: serpEntry?.position || null,
        domainAuthority,
        pageAnalysis: pageAnalysis ? {
            wordCount: pageAnalysis.wordCount,
            keywordDensity: pageAnalysis.keywordAnalysis.density,
            keywordMatches: pageAnalysis.keywordAnalysis.exactMatches,
            h1: pageAnalysis.seoElements.h1Text,
            metaDescription: pageAnalysis.seoElements.metaDescription,
            schemaMarkup: pageAnalysis.seoElements.hasSchema,
            schemaTypes: pageAnalysis.seoElements.schemaDetails?.detectedTypes || [],
            schemaValid: pageAnalysis.seoElements.schemaDetails?.isValid || false,
            schemaErrors: pageAnalysis.seoElements.schemaDetails?.errors || [],
            schemaSuggestions: pageAnalysis.seoElements.schemaSuggestions || [],
            pageType: pageAnalysis.seoElements.pageType?.primary || 'WebPage',
            internalLinks: pageAnalysis.seoElements.internalLinks,
            externalLinks: pageAnalysis.seoElements.externalLinks,
            images: pageAnalysis.seoElements.images,
            imagesWithAlt: pageAnalysis.seoElements.imagesWithAlt,
            headingStructure: pageAnalysis.headingStructure,
        } : null,
        seoScore,
    };
}

// ─── Calculate Domain SEO Score ───
function calculateDomainSEOScore(pageAnalysis, da) {
    let score = 0;

    // DA contributes up to 30 points
    score += Math.min(30, da);

    if (pageAnalysis) {
        const seo = pageAnalysis.seoElements;
        const kw = pageAnalysis.keywordAnalysis;

        // Word count (up to 15 points)
        if (pageAnalysis.wordCount >= 2000) score += 15;
        else if (pageAnalysis.wordCount >= 1000) score += 10;
        else if (pageAnalysis.wordCount >= 500) score += 5;

        // Keyword density (up to 15 points)
        if (kw.density >= 1 && kw.density <= 3) score += 15;
        else if (kw.density >= 0.5 && kw.density <= 5) score += 10;

        // SEO elements (up to 40 points)
        if (seo.hasH1) score += 10;
        if (seo.hasMetaDescription) score += 10;
        if (seo.hasSchema) score += 10;
        if (seo.internalLinks > 0) score += 5;
        if (seo.externalLinks > 0) score += 5;

        // Image optimization (up to 10 points)
        if (seo.images === seo.imagesWithAlt) score += 10;
        else if (seo.imagesWithAlt / seo.images >= 0.8) score += 7;
        else if (seo.imagesWithAlt / seo.images >= 0.5) score += 4;
    }

    return Math.min(100, score);
}

// ─── Build Comparison Table ───
function buildComparisonTable(results) {
    return {
        domainAuthority: results.map(r => ({
            domain: r.domain,
            value: r.domainAuthority,
            rank: null,
        })).sort((a, b) => (b.value || 0) - (a.value || 0)).map((r, i) => {
            r.rank = i + 1;
            return r;
        }),
        wordCount: results.map(r => ({
            domain: r.domain,
            value: r.pageAnalysis?.wordCount || 0,
            rank: null,
        })).sort((a, b) => b.value - a.value).map((r, i) => {
            r.rank = i + 1;
            return r;
        }),
        keywordDensity: results.map(r => ({
            domain: r.domain,
            value: r.pageAnalysis?.keywordDensity || 0,
            rank: null,
        })).sort((a, b) => b.value - a.value).map((r, i) => {
            r.rank = i + 1;
            return r;
        }),
        seoScore: results.map(r => ({
            domain: r.domain,
            value: r.seoScore || 0,
            rank: null,
        })).sort((a, b) => b.value - a.value).map((r, i) => {
            r.rank = i + 1;
            return r;
        }),
        serpPosition: results.filter(r => r.serpPosition).map(r => ({
            domain: r.domain,
            value: r.serpPosition,
            rank: null,
        })).sort((a, b) => a.value - b.value).map((r, i) => {
            r.rank = i + 1;
            return r;
        }),
    };
}

// ─── Analyze Patterns ───
function analyzePatterns(results) {
    const patterns = {
        commonStrengths: [],
        commonWeaknesses: [],
        opportunities: [],
        recommendations: [],
    };

    // Analyze word counts
    const wordCounts = results.filter(r => r.pageAnalysis?.wordCount).map(r => r.pageAnalysis.wordCount);
    if (wordCounts.length > 0) {
        const avgWC = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
        const minWC = Math.min(...wordCounts);
        
        if (avgWC < 1000) {
            patterns.commonWeaknesses.push({
                factor: 'Low content volume',
                detail: `Average word count is ${Math.round(avgWC)} words - competitors with 2000+ words tend to rank better`,
            });
        }

        const lowWordCountDomains = results.filter(r => r.pageAnalysis?.wordCount < avgWC * 0.7);
        if (lowWordCountDomains.length > 0) {
            patterns.opportunities.push({
                factor: 'Content gap opportunity',
                detail: `${lowWordCountDomains.length} competitor(s) have below-average content length`,
                domains: lowWordCountDomains.map(r => r.domain),
            });
        }
    }

    // Analyze SEO elements
    const hasH1Count = results.filter(r => r.pageAnalysis?.h1).length;
    const hasMetaCount = results.filter(r => r.pageAnalysis?.metaDescription).length;
    const hasSchemaCount = results.filter(r => r.pageAnalysis?.schemaMarkup).length;
    const schemaTypes = results.flatMap(r => r.pageAnalysis?.schemaTypes || []).filter((v, i, a) => a.indexOf(v) === i);

    if (hasH1Count === results.length) {
        patterns.commonStrengths.push('All competitors have H1 tags');
    }
    if (hasMetaCount < results.length / 2) {
        patterns.commonWeaknesses.push({
            factor: 'Meta descriptions',
            detail: `Only ${hasMetaCount}/${results.length} competitors have optimized meta descriptions`,
        });
    }
    if (hasSchemaCount > results.length / 2) {
        patterns.commonStrengths.push(`${hasSchemaCount}/${results.length} competitors use schema markup`);
        if (schemaTypes.length > 0) {
            patterns.commonStrengths.push(`Common schema types: ${schemaTypes.join(', ')}`);
        }
    } else if (hasSchemaCount === 0) {
        patterns.commonWeaknesses.push({
            factor: 'Schema Markup',
            detail: `None of the competitors use schema markup - opportunity to gain advantage`,
        });
    }

    // Analyze links
    const internalLinks = results.map(r => r.pageAnalysis?.internalLinks || 0);
    const externalLinks = results.map(r => r.pageAnalysis?.externalLinks || 0);
    const avgInternal = internalLinks.reduce((a, b) => a + b, 0) / results.length;
    const avgExternal = externalLinks.reduce((a, b) => a + b, 0) / results.length;

    if (avgInternal < 5) {
        patterns.recommendations.push({
            priority: 'HIGH',
            action: 'Improve internal linking',
            detail: `Average internal links: ${Math.round(avgInternal)}. Aim for 10+ per page.`,
        });
    }
    if (avgExternal < 3) {
        patterns.recommendations.push({
            priority: 'MEDIUM',
            action: 'Add external links',
            detail: `Average external links: ${Math.round(avgExternal)}. Linking to authoritative sources signals trust.`,
        });
    }

    // Keyword density analysis
    const densities = results.filter(r => r.pageAnalysis?.keywordDensity).map(r => r.pageAnalysis.keywordDensity);
    if (densities.length > 0) {
        const avgDensity = densities.reduce((a, b) => a + b, 0) / densities.length;
        if (avgDensity < 0.5) {
            patterns.recommendations.push({
                priority: 'MEDIUM',
                action: 'Increase keyword usage',
                detail: `Average keyword density: ${avgDensity.toFixed(2)}%. Target 1-2% for optimal results.`,
            });
        }
    }

    return patterns;
}

// ─── Perform Gap Analysis ───
async function performGapAnalysis(myDomain, competitorDomains, keyword) {
    log.info({ myDomain, competitorDomains, keyword }, 'performing gap analysis');

    // Analyze my domain
    const myAnalysis = await analyzeSingleDomain(myDomain, keyword);

    // Analyze competitors
    const competitorAnalyses = [];
    for (const domain of competitorDomains) {
        try {
            const analysis = await analyzeSingleDomain(domain, keyword);
            competitorAnalyses.push(analysis);
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {
            log.error({ domain, err: err.message }, 'competitor analysis failed');
        }
    }

    // Calculate gaps
    const gaps = [];

    // DA gap
    const compAvgDA = competitorAnalyses.reduce((sum, c) => sum + (c.domainAuthority || 0), 0) / competitorAnalyses.length;
    const daGap = Math.round(compAvgDA - (myAnalysis.domainAuthority || 0));
    if (daGap > 0) {
        gaps.push({
            category: 'Domain Authority',
            myValue: myAnalysis.domainAuthority,
            competitorAvg: Math.round(compAvgDA),
            gap: daGap,
            priority: daGap > 15 ? 'HIGH' : 'MEDIUM',
            recommendation: `Build backlinks to close the DA gap of ${daGap} points`,
        });
    }

    // Content gap
    const compAvgWC = competitorAnalyses.reduce((sum, c) => sum + (c.pageAnalysis?.wordCount || 0), 0) / competitorAnalyses.length;
    const wcGap = Math.round(compAvgWC - (myAnalysis.pageAnalysis?.wordCount || 0));
    if (wcGap > 200) {
        gaps.push({
            category: 'Content Length',
            myValue: myAnalysis.pageAnalysis?.wordCount || 0,
            competitorAvg: Math.round(compAvgWC),
            gap: wcGap,
            priority: wcGap > 500 ? 'HIGH' : 'MEDIUM',
            recommendation: `Add approximately ${Math.ceil(wcGap / 100) * 100} more words to match competitor content volume`,
        });
    }

    // Keyword density gap
    const compAvgKD = competitorAnalyses.reduce((sum, c) => sum + (c.pageAnalysis?.keywordDensity || 0), 0) / competitorAnalyses.length;
    const kdGap = (compAvgKD - (myAnalysis.pageAnalysis?.keywordDensity || 0)).toFixed(2);
    if (parseFloat(kdGap) > 0.3) {
        gaps.push({
            category: 'Keyword Density',
            myValue: myAnalysis.pageAnalysis?.keywordDensity || 0,
            competitorAvg: parseFloat(compAvgKD.toFixed(2)),
            gap: parseFloat(kdGap),
            priority: 'MEDIUM',
            recommendation: `Increase keyword usage to match ${compAvgKD.toFixed(2)}% density (currently ${(myAnalysis.pageAnalysis?.keywordDensity || 0).toFixed(2)}%)`,
        });
    }

    // SEO elements gap
    const myHasH1 = myAnalysis.pageAnalysis?.h1 ? 1 : 0;
    const compHasH1 = competitorAnalyses.filter(c => c.pageAnalysis?.h1).length;
    if (compHasH1 > competitorAnalyses.length / 2 && !myAnalysis.pageAnalysis?.h1) {
        gaps.push({
            category: 'H1 Tag',
            myValue: 'Missing',
            competitorAvg: `${compHasH1}/${competitorAnalyses.length} have H1`,
            gap: 'Missing',
            priority: 'HIGH',
            recommendation: 'Add H1 tag with target keyword',
        });
    }

    const myHasMeta = myAnalysis.pageAnalysis?.metaDescription ? 1 : 0;
    const compHasMeta = competitorAnalyses.filter(c => c.pageAnalysis?.metaDescription).length;
    if (compHasMeta > competitorAnalyses.length / 2 && !myAnalysis.pageAnalysis?.metaDescription) {
        gaps.push({
            category: 'Meta Description',
            myValue: 'Missing',
            competitorAvg: `${compHasMeta}/${competitorAnalyses.length} have meta description`,
            gap: 'Missing',
            priority: 'MEDIUM',
            recommendation: 'Add compelling meta description with keyword and CTA',
        });
    }

    const myHasSchema = myAnalysis.pageAnalysis?.schemaMarkup ? 1 : 0;
    const compHasSchema = competitorAnalyses.filter(c => c.pageAnalysis?.schemaMarkup).length;
    if (compHasSchema > competitorAnalyses.length / 2 && !myAnalysis.pageAnalysis?.schemaMarkup) {
        gaps.push({
            category: 'Schema Markup',
            myValue: 'Missing',
            competitorAvg: `${compHasSchema}/${competitorAnalyses.length} use schema`,
            gap: 'Missing',
            priority: 'MEDIUM',
            recommendation: 'Add structured data (FAQ, Article, or LocalBusiness schema)',
        });
    }

    // Internal links gap
    const compAvgIL = competitorAnalyses.reduce((sum, c) => sum + (c.pageAnalysis?.internalLinks || 0), 0) / competitorAnalyses.length;
    const ilGap = Math.round(compAvgIL - (myAnalysis.pageAnalysis?.internalLinks || 0));
    if (ilGap > 3) {
        gaps.push({
            category: 'Internal Links',
            myValue: myAnalysis.pageAnalysis?.internalLinks || 0,
            competitorAvg: Math.round(compAvgIL),
            gap: ilGap,
            priority: 'LOW',
            recommendation: `Add ${ilGap} more internal links to match competitor average`,
        });
    }

    // Opportunities (what competitors have that you don't)
    const opportunities = [];

    // Find best performer in each category
    if (competitorAnalyses.length > 0) {
        const bestDA = competitorAnalyses.reduce((best, c) => 
            (c.domainAuthority || 0) > (best.domainAuthority || 0) ? c : best
        );
        if ((bestDA.domainAuthority || 0) > (myAnalysis.domainAuthority || 0) + 10) {
            opportunities.push({
                type: 'High DA Competitor',
                domain: bestDA.domain,
                da: bestDA.domainAuthority,
                insight: 'Study their backlink profile and outreach strategy',
            });
        }

        const bestContent = competitorAnalyses.reduce((best, c) => 
            (c.pageAnalysis?.wordCount || 0) > (best.pageAnalysis?.wordCount || 0) ? c : best
        );
        if ((bestContent.pageAnalysis?.wordCount || 0) > (myAnalysis.pageAnalysis?.wordCount || 0) * 1.5) {
            opportunities.push({
                type: 'Content Leader',
                domain: bestContent.domain,
                wordCount: bestContent.pageAnalysis?.wordCount,
                insight: 'Analyze their content structure and topics covered',
            });
        }
    }

    return {
        myDomain,
        keyword,
        myAnalysis,
        competitorAnalyses,
        gaps: gaps.sort((a, b) => {
            const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
        }),
        opportunities,
        summary: {
            totalGaps: gaps.length,
            highPriority: gaps.filter(g => g.priority === 'HIGH').length,
            mediumPriority: gaps.filter(g => g.priority === 'MEDIUM').length,
            lowPriority: gaps.filter(g => g.priority === 'LOW').length,
            topRecommendation: gaps[0]?.recommendation || 'Continue monitoring competitors',
        },
        timestamp: new Date().toISOString(),
    };
}
