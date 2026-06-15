/**
 * Check: GA4 traffic summary
 * Same idea as GSC — pull the last 30 days of sessions/pageviews/etc.
 * from ga4_search_analytics (or whatever the GA4 sync table is called).
 */
const NAME = 'ga4';

async function run(ctx) {
    if (!ctx.client?.id) return { status: 'skipped', error: 'no client' };

    try {
        const { rows } = await ctx.db.query(
            `SELECT
                 COALESCE(SUM(sessions), 0)::int      AS sessions,
                 COALESCE(SUM(users), 0)::int        AS users,
                 COALESCE(SUM(pageviews), 0)::int    AS pageviews,
                 COALESCE(AVG(engagement_rate), 0)::float AS engagement_rate,
                 COALESCE(AVG(bounce_rate), 0)::float     AS bounce_rate
             FROM ga4_search_analytics
             WHERE client_id = $1
               AND date >= CURRENT_DATE - INTERVAL '30 days'`,
            [ctx.client.id],
        );

        const stats = rows[0] || {};
        return { status: 'success', data: { windowDays: 30, ...stats } };
    } catch (err) {
        return { status: 'skipped', error: err.message };
    }
}

module.exports = { name: NAME, run };
