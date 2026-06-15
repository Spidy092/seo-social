/**
 * Check: competitor analysis
 * Pulls the top competitors already linked to the project (or stored
 * in the competitors table for this client) and gathers their stats.
 */
const NAME = 'competitors';

async function run(ctx) {
    if (!ctx.client?.id) return { status: 'skipped', error: 'no client' };

    try {
        const { rows } = await ctx.db.query(
            `SELECT domain, source, average_position, visibility_score
             FROM competitors
             WHERE client_id = $1
             ORDER BY visibility_score DESC NULLS LAST
             LIMIT 5`,
            [ctx.client.id],
        );

        if (!rows.length) {
            return {
                status: 'success',
                data: { count: 0, competitors: [], note: 'no competitors tracked yet' },
            };
        }
        return { status: 'success', data: { count: rows.length, competitors: rows } };
    } catch (err) {
        // The competitors table may not exist in every install — don't
        // fail the whole audit if so.
        return { status: 'skipped', error: err.message };
    }
}

module.exports = { name: NAME, run };
