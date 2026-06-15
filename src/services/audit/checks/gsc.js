/**
 * Check: GSC data summary
 * Pulls the last 30 days of clicks/impressions/position from
 * gsc_search_analytics. Skipped if the client has no GSC property linked
 * or if no data is in the table.
 */
const NAME = 'gsc';

async function run(ctx) {
    if (!ctx.client?.id) return { status: 'skipped', error: 'no client' };

    try {
        const { rows } = await ctx.db.query(
            `SELECT
                 COALESCE(SUM(clicks), 0)::int       AS clicks,
                 COALESCE(SUM(impressions), 0)::int AS impressions,
                 COALESCE(AVG(position), 0)::float  AS avg_position,
                 COALESCE(AVG(ctr), 0)::float       AS avg_ctr
             FROM gsc_search_analytics
             WHERE client_id = $1
               AND date >= CURRENT_DATE - INTERVAL '30 days'`,
            [ctx.client.id],
        );

        const stats = rows[0] || { clicks: 0, impressions: 0, avg_position: 0, avg_ctr: 0 };

        // Top 10 queries in the window
        const top = await ctx.db.query(
            `SELECT query, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
                    AVG(position)::float AS position
             FROM gsc_search_analytics
             WHERE client_id = $1
               AND date >= CURRENT_DATE - INTERVAL '30 days'
             GROUP BY query
             ORDER BY clicks DESC
             LIMIT 10`,
            [ctx.client.id],
        );

        return {
            status: 'success',
            data: {
                windowDays: 30,
                ...stats,
                topQueries: top.rows,
            },
        };
    } catch (err) {
        return { status: 'skipped', error: err.message };
    }
}

module.exports = { name: NAME, run };
