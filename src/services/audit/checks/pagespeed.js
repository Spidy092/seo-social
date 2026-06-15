/**
 * Check: Google PageSpeed Insights
 * Skipped silently if no API key is configured.
 */
const { runPageSpeed } = require('../../pageSpeedService');

const NAME = 'pagespeed';
const TIMEOUT_MS = 45_000;

async function run(ctx) {
    if (!process.env.PAGESPEED_API_KEY) {
        return { status: 'skipped', error: 'PAGESPEED_API_KEY not configured' };
    }
    if (!ctx.domain) return { status: 'skipped', error: 'no website_url' };

    const url = /^https?:\/\//i.test(ctx.domain) ? ctx.domain : `https://${ctx.domain}`;
    try {
        const result = await Promise.race([
            runPageSpeed(url, 'mobile'),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS),
            ),
        ]);
        return {
            status: 'success',
            data: {
                url,
                mobileScore: result?.mobile?.score ?? null,
                desktopScore: result?.desktop?.score ?? null,
                coreWebVitals: result?.mobile?.coreWebVitals || null,
            },
        };
    } catch (err) {
        return { status: 'failed', error: err.message };
    }
}

module.exports = { name: NAME, run };
