/**
 * Check: keyword suggestions
 * Uses the existing keyword service to pull 20-30 candidate keywords
 * based on the project name and tracking domain.
 */
const keywordService = require('../../keywordService');

const NAME = 'keywords';
const TIMEOUT_MS = 30_000;

async function run(ctx) {
    if (!ctx.project?.name) return { status: 'skipped', error: 'project has no name' };

    const seed = ctx.project.name;
    try {
        const suggestions = await Promise.race([
            keywordService.getKeywordSuggestions(seed, ctx.location),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS),
            ),
        ]);
        const items = (suggestions?.keywords || suggestions || []).slice(0, 30);

        // Merge in user-supplied custom keywords (always included,
        // even if the SERP doesn't suggest them).
        const custom = Array.isArray(ctx.customKeywords) ? ctx.customKeywords : [];
        const seen = new Set(items.map(i => (typeof i === 'string' ? i : i.keyword).toLowerCase()));
        for (const ck of custom) {
            const key = String(ck).toLowerCase().trim();
            if (key && !seen.has(key)) {
                items.push({ keyword: ck, source: 'custom' });
                seen.add(key);
            }
        }

        return {
            status: 'success',
            data: {
                seed,
                count: items.length,
                customCount: custom.length,
                keywords: items,
            },
        };
    } catch (err) {
        return { status: 'failed', error: err.message };
    }
}

module.exports = { name: NAME, run };
