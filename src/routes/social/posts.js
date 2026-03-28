const fs = require('fs');
const util = require('util');
const path = require('path');
const pipeline = util.promisify(require('stream').pipeline);
const os = require('os');
const { uploadFile, deleteFile } = require('../../services/cloudinary');
const { postToPlatform } = require('../../services/platforms');

module.exports = async function (fastify, options) {
    const { db } = options;

    // GET /social/posts/upload
    fastify.get('/social/posts/upload', async (request, reply) => {
        const error = request.session.get('error');
        const success = request.session.get('success');
        request.session.set('error', null);
        request.session.set('success', null);
        
        return reply.view('social/upload.ejs', {
            activePage: 'upload',
            error,
            success,
            layout: 'social/layout.ejs'
        });
    });

    // POST /social/posts (handle multipart form data)
    fastify.post('/social/posts', async (request, reply) => {
        const parts = request.parts(); // use async iterator for parts
        let mediaFile = null;
        let tempFilePath = null;
        const body = {};

        try {
            for await (const part of parts) {
                if (part.type === 'file') {
                    if (part.filename) {
                        tempFilePath = path.join(os.tmpdir(), `upload-${Date.now()}-${part.filename}`);
                        await pipeline(part.file, fs.createWriteStream(tempFilePath));
                        mediaFile = { path: tempFilePath, fieldname: part.fieldname, filename: part.filename };
                    } else {
                        // Empty file case
                        part.file.resume();
                    }
                } else {
                    // String field (handle arrays for multiple checkboxes)
                    if (body[part.fieldname]) {
                        if (Array.isArray(body[part.fieldname])) {
                            body[part.fieldname].push(part.value);
                        } else {
                            body[part.fieldname] = [body[part.fieldname], part.value];
                        }
                    } else {
                        body[part.fieldname] = part.value;
                    }
                }
            }

            if (!mediaFile) {
                request.session.set('error', 'Please upload a media file.');
                return reply.redirect('/social/posts/upload');
            }

            // Platforms might be string (if 1 checkbox selected) or not present
            let platforms = body.platforms;
            if (platforms && typeof platforms === 'string') {
                platforms = [platforms];
            } else if (!platforms) {
                platforms = [];
            }

            if (platforms.length === 0) {
                request.session.set('error', 'Select at least one platform.');
                if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                return reply.redirect('/social/posts/upload');
            }

            const caption = body.caption || '';
            const scheduled_at = body.scheduled_at;

            let platformsData = {};
            platforms.forEach(p => {
                platformsData[p] = { caption: body[`caption_${p}`] || caption };
            });

            // Upload to Cloudinary
            const cloudinaryResult = await uploadFile(mediaFile.path);
            
            // Delete temp file
            fs.unlinkSync(mediaFile.path);

            const status = scheduled_at ? 'pending' : 'draft';
            const dbScheduledAt = scheduled_at ? new Date(scheduled_at) : null;
            
            await db.query(`
              INSERT INTO posts (user_id, media_url, media_type, caption_original, platforms, scheduled_at, status)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
            `, [request.session.get('userId'), cloudinaryResult.url, cloudinaryResult.resourceType, caption, JSON.stringify(platformsData), dbScheduledAt, status]);

            request.session.set('success', 'Post created successfully!');
            return reply.redirect('/social/posts/upload');
        } catch (err) {
            request.log.error(err, 'Post creation error');
            if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            request.session.set('error', 'Error creating post: ' + err.message);
            return reply.redirect('/social/posts/upload');
        }
    });

    // GET /social/posts/schedule
    fastify.get('/social/posts/schedule', async (request, reply) => {
        try {
            const result = await db.query(`
              SELECT p.*, 
                (SELECT json_agg(pr) FROM post_results pr WHERE pr.post_id = p.id) as results
              FROM posts p
              WHERE p.user_id = $1
              ORDER BY p.created_at DESC
            `, [request.session.get('userId')]);

            return reply.view('social/schedule.ejs', { 
                activePage: 'schedule', 
                posts: result.rows,
                success: request.session.get('success'),
                error: request.session.get('error'),
                layout: 'social/layout.ejs'
            });
        } catch (err) {
            request.log.error(err, 'Schedule fetch error');
            return reply.view('social/schedule.ejs', { 
                activePage: 'schedule', 
                posts: [],
                error: 'Could not fetch posts.',
                layout: 'social/layout.ejs'
            });
        } finally {
            request.session.set('success', null);
            request.session.set('error', null);
        }
    });

    // POST /social/posts/:id/delete
    fastify.post('/social/posts/:id/delete', async (request, reply) => {
        try {
            const result = await db.query('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [request.params.id, request.session.get('userId')]);
            const post = result.rows[0];

            if (!post) {
                request.session.set('error', 'Post not found.');
                return reply.redirect('/social/posts/schedule');
            }

            const urlParts = post.media_url.split('/');
            const lastPart = urlParts[urlParts.length - 1];
            const publicId = `social-poster/${lastPart.split('.')[0]}`;
            
            await deleteFile(publicId, post.media_type);
            await db.query('DELETE FROM posts WHERE id = $1', [request.params.id]);

            request.session.set('success', 'Post deleted.');
        } catch (err) {
            request.log.error(err, 'Delete post error');
            request.session.set('error', 'Error deleting post.');
        }
        return reply.redirect('/social/posts/schedule');
    });

    // POST /social/posts/:id/publish-now
    fastify.post('/social/posts/:id/publish-now', async (request, reply) => {
        try {
            const { id } = request.params;
            const userId = request.session.get('userId');
            
            const checkResult = await db.query('SELECT * FROM posts WHERE id = $1 AND user_id = $2', [id, userId]);
            const post = checkResult.rows[0];

            if (!post) {
                request.session.set('error', 'Post not found.');
                return reply.redirect('/social/posts/schedule');
            }

            await db.query('UPDATE posts SET status = $1 WHERE id = $2', ['publishing', id]);

            const platforms = Object.keys(post.platforms);
            
            const results = await Promise.allSettled(
                platforms.map(async (platform) => {
                    const { rows: [conn] } = await db.query(
                        `SELECT * FROM platform_connections WHERE user_id=$1 AND platform=$2`,
                        [post.user_id, platform]
                    );
                    if (!conn) throw new Error(`No connection for ${platform}`);
                    const caption = post.platforms[platform]?.caption || post.caption_original;
                    
                    const platResult = await postToPlatform(platform, conn, {
                        mediaUrl: post.media_url, mediaType: post.media_type, caption
                    });
                    
                    await db.query(
                        `INSERT INTO post_results (post_id, platform, status, platform_post_id) VALUES ($1,$2,'success',$3)`,
                        [post.id, platform, platResult.platformPostId]
                    );
                })
            );
            
            const allOk = results.every(r => r.status === 'fulfilled');
            await db.query(`UPDATE posts SET status=$1 WHERE id=$2`, [allOk ? 'published' : 'failed', post.id]);
            
            for (let i = 0; i < results.length; i++) {
                if (results[i].status === 'rejected') {
                    await db.query(
                        `INSERT INTO post_results (post_id, platform, status, error_message) VALUES ($1,$2,'failed',$3)`,
                        [post.id, platforms[i], results[i].reason?.message]
                    );
                }
            }

            if (allOk) {
                request.session.set('success', 'Post published successfully!');
            } else {
                request.session.set('error', 'Post published with some errors. Check your platform dashboards.');
            }
        } catch (err) {
            request.log.error(err, 'Publish-now error');
            await db.query('UPDATE posts SET status = $1 WHERE id = $2 AND user_id = $3', ['failed', request.params.id, request.session.get('userId')]);
            request.session.set('error', 'Error triggering publish: ' + err.message);
        }
        return reply.redirect('/social/posts/schedule');
    });
};
