/**
 * Check: technical SEO audit
 * Crawls the client's homepage + a few key pages and returns the audit
 * score + top issues.
 */
const { auditSite } = require('../../technicalSeoService');

const NAME = 'technical';
const MAX_PAGES = 8;            // Cap the crawl to keep audits fast
const TIMEOUT_MS = 60_000;

async function run(ctx) {
    if (!ctx.domain) {
        return { status: 'skipped', error: 'no website_url on client' };
    }

    // Race the audit against a timeout — a stuck crawl should not block
    // the whole report.
    const auditPromise = auditSite(ctx.domain, { maxPages: MAX_PAGES });
    const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`timeout after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    );

    try {
        const result = await Promise.race([auditPromise, timeoutPromise]);
        return {
            status: 'success',
            data: {
                score: result?.score ?? result?.overallScore ?? null,
                issues: (result?.issues || []).slice(0, 25),
                pages: result?.pages?.length || 0,
                siteUrl: ctx.domain,
            },
        };
    } catch (err) {
        return { status: 'failed', error: err.message };
    }
}

module.exports = { name: NAME, run };
