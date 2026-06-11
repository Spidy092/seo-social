const { syncAnalytics } = require('../../services/analyticsSync');
const { requireAgencyContext } = require('../../utils/authHelper');

module.exports = async function (fastify, options) {
    const { db } = options;

    fastify.get('/social/analytics', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        try {
            const { rows: summary } = await db.query(`
              SELECT 
                SUM(likes) as total_likes, 
                SUM(views) as total_views, 
                SUM(reach) as total_reach
              FROM (
                SELECT analytics_snapshots.likes, analytics_snapshots.views, analytics_snapshots.reach,
                       ROW_NUMBER() OVER(PARTITION BY analytics_snapshots.post_result_id ORDER BY analytics_snapshots.snapped_at DESC) as rn
                FROM analytics_snapshots
                JOIN post_results pr ON analytics_snapshots.post_result_id = pr.id
                JOIN posts p ON pr.post_id = p.id
                WHERE p.user_id = $1 AND (p.agency_id = $2 OR p.agency_id IS NULL OR $2 IS NULL)
              ) latest
              WHERE rn = 1
            `, [ctx.userId, ctx.agencyId]);

            const { rows: platformStats } = await db.query(`
              SELECT 
                pr.platform,
                COUNT(DISTINCT pr.id) as total_posts,
                ROUND(AVG(latest.likes)) as avg_likes,
                ROUND(AVG(latest.views)) as avg_views
              FROM post_results pr
              JOIN posts p ON pr.post_id = p.id
              LEFT JOIN (
                SELECT post_result_id, likes, views,
                       ROW_NUMBER() OVER(PARTITION BY post_result_id ORDER BY snapped_at DESC) as rn
                FROM analytics_snapshots
              ) latest ON latest.post_result_id = pr.id AND latest.rn = 1
              WHERE p.user_id = $1 AND (p.agency_id = $2 OR p.agency_id IS NULL OR $2 IS NULL) AND pr.status = 'success'
              GROUP BY pr.platform
            `, [ctx.userId, ctx.agencyId]);

            const { rows: recentPosts } = await db.query(`
              SELECT 
                p.id, 
                p.caption_original, 
                p.media_url, 
                pr.platform, 
                COALESCE(latest.likes, 0) as likes,
                COALESCE(latest.views, 0) as views,
                COALESCE(latest.comments, 0) as comments
              FROM post_results pr
              JOIN posts p ON pr.post_id = p.id
              LEFT JOIN (
                SELECT post_result_id, likes, views, comments,
                       ROW_NUMBER() OVER(PARTITION BY post_result_id ORDER BY snapped_at DESC) as rn
                FROM analytics_snapshots
              ) latest ON latest.post_result_id = pr.id AND latest.rn = 1
              WHERE p.user_id = $1 AND (p.agency_id = $2 OR p.agency_id IS NULL OR $2 IS NULL) AND pr.status = 'success'
              ORDER BY p.created_at DESC
              LIMIT 10
            `, [ctx.userId, ctx.agencyId]);

            const stats = summary[0] || { total_likes: 0, total_views: 0, total_reach: 0 };

            return reply.view('social/analytics.ejs', { 
                activePage: 'analytics',
                stats,
                platformStats,
                recentPosts,
                success: request.session.get('success'),
                error: request.session.get('error'),
                layout: 'social/layout.ejs'
            });
        } catch (err) {
            request.log.error(err, 'Failed to load analytics');
            request.session.set('error', 'Failed to load analytics');
            return reply.redirect('/');
        } finally {
            request.session.set('success', null);
            request.session.set('error', null);
        }
    });

    fastify.post('/social/analytics/sync', async (request, reply) => {
        const ctx = await requireAgencyContext(request, reply, db);
        if (!ctx) return;
        try {
            await syncAnalytics(ctx.userId);
            request.session.set('success', 'Analytics synced successfully');
        } catch (err) {
            request.log.error(err, 'Failed to sync analytics');
            request.session.set('error', 'Failed to sync analytics');
        }
        return reply.redirect('/social/analytics');
    });
};
