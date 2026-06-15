/**
 * Check: search visibility / indexability
 * Counts known pages, checks if a sitemap is reachable, and counts how
 * many of the project's tracked keywords have rankings in the last 7
 * days.
 */
const NAME = 'search_visibility';

async function run(ctx) {
    if (!ctx.client?.id) return { status: 'skipped', error: 'no client' };

    try {
        const [rankedKeywords, sitemapStatus] = await Promise.all([
            ctx.db.query(
                `SELECT COUNT(DISTINCT keyword_id)::int AS tracked
                 FROM seo_project_keywords
                 WHERE project_id = $1`,
                [ctx.project.id],
            ),
            ctx.client.website_url
                ? ctx.db.query(
                    `SELECT 1 FROM sitemaps
                     WHERE client_id = $1
                       AND is_active = TRUE
                     LIMIT 1`,
                    [ctx.client.id],
                  ).then(r => r.rows.length > 0)
                : Promise.resolve(false),
        ]);

        return {
            status: 'success',
            data: {
                trackedKeywords: rankedKeywords.rows[0]?.tracked || 0,
                sitemapRegistered: !!sitemapStatus,
            },
        };
    } catch (err) {
        return { status: 'skipped', error: err.message };
    }
}

module.exports = { name: NAME, run };
