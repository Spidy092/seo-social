/**
 * Check: on-page audit of the homepage
 * Lightweight: just one URL — full per-URL audits are still triggered
 * manually from the UI for important pages.
 */
const { analyzeOnPage } = require('../../onpageService');

const NAME = 'onpage';

async function run(ctx) {
    if (!ctx.domain) return { status: 'skipped', error: 'no website_url' };
    try {
        const url = /^https?:\/\//i.test(ctx.domain) ? ctx.domain : `https://${ctx.domain}`;
        const result = await analyzeOnPage(url, ctx.project?.name || '');
        return {
            status: 'success',
            data: {
                url,
                score: result?.overallScore ?? result?.score ?? null,
                title: result?.title || null,
                metaDescription: result?.metaDescription || null,
                issues: (result?.issues || []).slice(0, 20),
            },
        };
    } catch (err) {
        return { status: 'failed', error: err.message };
    }
}

module.exports = { name: NAME, run };
