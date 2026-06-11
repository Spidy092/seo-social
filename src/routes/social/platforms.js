const crypto = require('crypto');
const axios = require('axios');
const { requireAgencyContext, getAgencyContext } = require('../../utils/authHelper');

function generateState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = async function (fastify, options) {
  const { db } = options;

  // ─── GET /platforms — list connections (Protected) ────────────
  fastify.get('/social/platforms', async (request, reply) => {
    const ctx = await requireAgencyContext(request, reply, db);
    if (!ctx) return;
    try {
      const { rows: connections } = await db.query(
        'SELECT * FROM platform_connections WHERE user_id = $1 AND (agency_id = $2 OR agency_id IS NULL OR $2 IS NULL)',
        [ctx.userId, ctx.agencyId]
      );

      const platforms = ['instagram', 'facebook', 'linkedin', 'youtube'];
      const connectionMap = {};
      platforms.forEach(p => {
        const conn = connections.find(c => c.platform === p);
        connectionMap[p] = conn || null;
      });

      return reply.view('social/platforms.ejs', { 
        activePage: 'platforms', 
        connections: connectionMap,
        success: request.session.get('success'),
        error: request.session.get('error'),
        layout: 'social/layout.ejs'
      });
    } catch (err) {
      request.log.error(err, '[platforms] list error');
      return reply.view('social/platforms.ejs', { 
        activePage: 'platforms', 
        connections: {},
        error: 'Failed to load platform connections'
      });
    } finally {
        request.session.set('success', null);
        request.session.set('error', null);
    }
  });

  // ─── GET /platforms/:platform/connect — initiate OAuth ───
  fastify.get('/social/platforms/meta/connect', async (request, reply) => {
    const ctx = await requireAgencyContext(request, reply, db);
    if (!ctx) return;
    const state = generateState();
    request.session.set('oauthState', state);
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      redirect_uri: process.env.META_REDIRECT_URI,
      scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts',
      response_type: 'code',
      state
    });
    return reply.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params}`);
  });

  fastify.get('/social/platforms/linkedin/connect', async (request, reply) => {
    const ctx = await requireAgencyContext(request, reply, db);
    if (!ctx) return;
    const state = generateState();
    request.session.set('oauthState', state);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.LINKEDIN_CLIENT_ID,
      redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
      scope: 'openid profile w_member_social',
      state
    });
    return reply.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
  });

  fastify.get('/social/platforms/youtube/connect', async (request, reply) => {
    const ctx = await requireAgencyContext(request, reply, db);
    if (!ctx) return;
    const state = generateState();
    request.session.set('oauthState', state);
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      scope: 'openid email profile',
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state
    });
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  });

  // ─── DELETE /platforms/:platform/disconnect ───────────────
  // We'll use POST /social/platforms/:platform/disconnect logic for easy HTML forms without method-override
  fastify.post('/social/platforms/:platform/disconnect', async (request, reply) => {
    const ctx = await requireAgencyContext(request, reply, db);
    if (!ctx) return;
    const { platform } = request.params;
    const allowed = ['instagram', 'facebook', 'linkedin', 'youtube'];
    if (!allowed.includes(platform)) {
      request.session.set('error', 'Unknown platform');
      return reply.redirect('/#social-platforms');
    }

    try {
      await db.query(
        'DELETE FROM platform_connections WHERE user_id = $1 AND platform = $2 AND (agency_id = $3 OR agency_id IS NULL OR $3 IS NULL)',
        [ctx.userId, platform, ctx.agencyId]
      );

      if (platform === 'instagram' || platform === 'facebook') {
        const otherPlatform = platform === 'instagram' ? 'facebook' : 'instagram';
        await db.query(
          'DELETE FROM platform_connections WHERE user_id = $1 AND platform = $2 AND (agency_id = $3 OR agency_id IS NULL OR $3 IS NULL)',
          [ctx.userId, otherPlatform, ctx.agencyId]
        );
        request.session.set('success', `Instagram & Facebook disconnected`);
      } else {
        request.session.set('success', `${platform.charAt(0).toUpperCase() + platform.slice(1)} disconnected`);
      }
    } catch (err) {
      request.log.error(err, `[platforms] disconnect ${platform} error`);
      request.session.set('error', `Failed to disconnect ${platform}`);
    }

    return reply.redirect('/#social-platforms');
  });

  // ═══════════════════════════════════════════════════════════
  // CALLBACK ROUTES (Public)
  // ═══════════════════════════════════════════════════════════

  fastify.get('/social/platforms/meta/callback', async (request, reply) => {
    const { code, state, error: oauthError } = request.query;

    if (oauthError) {
      request.session.set('error', `Meta authorization failed: ${oauthError}`);
      return reply.redirect('/#social-platforms');
    }

    if (!state || state !== request.session.get('oauthState')) {
      request.session.set('error', 'OAuth state mismatch — possible CSRF attack. Please try again.');
      return reply.redirect('/#social-platforms');
    }
    request.session.set('oauthState', null);

    try {
      const tokenRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          redirect_uri: process.env.META_REDIRECT_URI,
          code
        }
      });

      const { access_token, expires_in } = tokenRes.data;
      const tokenExpiresAt = new Date(Date.now() + (expires_in || 5184000) * 1000);

      const longLivedRes = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
        params: {
          grant_type: 'fb_exchange_token',
          client_id: process.env.META_APP_ID,
          client_secret: process.env.META_APP_SECRET,
          fb_exchange_token: access_token
        }
      });

      const longToken = longLivedRes.data.access_token || access_token;
      const longExpiresAt = longLivedRes.data.expires_in
        ? new Date(Date.now() + longLivedRes.data.expires_in * 1000)
        : tokenExpiresAt;

      const userRes = await axios.get('https://graph.facebook.com/v18.0/me', {
        params: { fields: 'id,name', access_token: longToken }
      });

      const pagesRes = await axios.get('https://graph.facebook.com/v18.0/me/accounts', {
        params: { access_token: longToken }
      });

      const userId = request.session.get('userId');
      if (!userId) {
          request.session.set('error', 'User not logged in');
          return reply.redirect('/login');
      }

      const ctx = await getAgencyContext(request, db);
      let fbUsername = userRes.data.name || 'Facebook User';
      let igUsername = null;

      if (pagesRes.data.data && pagesRes.data.data.length > 0) {
        const page = pagesRes.data.data[0];
        await db.query(
          `INSERT INTO platform_connections (user_id, agency_id, platform, access_token, refresh_token, token_expires_at, platform_user_id, platform_username)
           VALUES ($1, $2, 'facebook', $3, NULL, $4, $5, $6)
           ON CONFLICT (user_id, platform) DO UPDATE SET
             access_token = $3, token_expires_at = $4, platform_user_id = $5, platform_username = $6, agency_id = $2`,
          [userId, ctx?.agencyId || null, page.access_token, longExpiresAt, page.id, page.name || fbUsername]
        );
      }

      if (pagesRes.data.data && pagesRes.data.data.length > 0) {
        const page = pagesRes.data.data[0];
        try {
          const igRes = await axios.get(`https://graph.facebook.com/v18.0/${page.id}`, {
            params: { fields: 'instagram_business_account', access_token: page.access_token }
          });

          if (igRes.data.instagram_business_account) {
            const igId = igRes.data.instagram_business_account.id;
            const igUserRes = await axios.get(`https://graph.facebook.com/v18.0/${igId}`, {
              params: { fields: 'id,username', access_token: longToken }
            });
            igUsername = igUserRes.data.username || 'Instagram User';

            await db.query(
              `INSERT INTO platform_connections (user_id, agency_id, platform, access_token, refresh_token, token_expires_at, platform_user_id, platform_username)
               VALUES ($1, $2, 'instagram', $3, NULL, $4, $5, $6)
               ON CONFLICT (user_id, platform) DO UPDATE SET
                 access_token = $3, token_expires_at = $4, platform_user_id = $5, platform_username = $6, agency_id = $2`,
              [userId, ctx?.agencyId || null, longToken, longExpiresAt, igId, igUsername]
            );
          }
        } catch (igErr) {
          request.log.warn(igErr, '[platforms] Could not fetch Instagram business account');
        }
      }

      const connected = [];
      if (igUsername) connected.push(`Instagram (@${igUsername})`);
      if (fbUsername) connected.push('Facebook');
      request.session.set('success', `Connected: ${connected.join(' & ')}`);
    } catch (err) {
      request.log.error(err, '[platforms] Meta callback error');
      request.session.set('error', 'Failed to connect Meta accounts. Check app credentials.');
    }

    return reply.redirect('/#social-platforms');
  });

  fastify.get('/social/platforms/linkedin/callback', async (request, reply) => {
    const { code, state, error: oauthError, error_description } = request.query;

    if (oauthError) {
      request.session.set('error', `LinkedIn authorization failed: ${error_description || oauthError}`);
      return reply.redirect('/#social-platforms');
    }

    if (!state || state !== request.session.get('oauthState')) {
      request.session.set('error', 'OAuth state mismatch — possible CSRF attack. Please try again.');
      return reply.redirect('/#social-platforms');
    }
    request.session.set('oauthState', null);

    try {
      const tokenRes = await axios.post('https://www.linkedin.com/oauth/v2/accessToken', null, {
        params: {
          grant_type: 'authorization_code',
          code,
          redirect_uri: process.env.LINKEDIN_REDIRECT_URI,
          client_id: process.env.LINKEDIN_CLIENT_ID,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET
        },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const { access_token, expires_in, refresh_token } = tokenRes.data;
      const tokenExpiresAt = new Date(Date.now() + (expires_in || 5184000) * 1000);

      const userInfoRes = await axios.get('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });

      const personId = userInfoRes.data.sub;
      const displayName = userInfoRes.data.name || userInfoRes.data.given_name || 'LinkedIn User';

      const userId = request.session.get('userId');
      if (!userId) {
          request.session.set('error', 'User not logged in');
          return reply.redirect('/login');
      }

      const ctx = await getAgencyContext(request, db);
      await db.query(
        `INSERT INTO platform_connections (user_id, agency_id, platform, access_token, refresh_token, token_expires_at, platform_user_id, platform_username)
         VALUES ($1, $2, 'linkedin', $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, platform) DO UPDATE SET
           access_token = $3, refresh_token = $4, token_expires_at = $5, platform_user_id = $6, platform_username = $7, agency_id = $2`,
        [userId, ctx?.agencyId || null, access_token, refresh_token || null, tokenExpiresAt, personId, displayName]
      );

      request.session.set('success', `LinkedIn connected as ${displayName}`);
    } catch (err) {
      request.log.error(err, '[platforms] LinkedIn callback error');
      request.session.set('error', 'Failed to connect LinkedIn. Check app credentials.');
    }

    return reply.redirect('/#social-platforms');
  });

  fastify.get('/social/platforms/youtube/callback', async (request, reply) => {
    const { code, state, error: oauthError } = request.query;

    if (oauthError) {
      request.session.set('error', `Google authorization failed: ${oauthError}`);
      return reply.redirect('/#social-platforms');
    }

    if (!state || state !== request.session.get('oauthState')) {
      request.session.set('error', 'OAuth state mismatch — possible CSRF attack. Please try again.');
      return reply.redirect('/#social-platforms');
    }
    request.session.set('oauthState', null);

    try {
      const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code'
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;
      const tokenExpiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);

      const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'snippet', mine: true },
        headers: { Authorization: `Bearer ${access_token}` }
      });

      let channelName = 'YouTube Channel';
      let channelId = null;
      if (channelRes.data.items && channelRes.data.items.length > 0) {
        channelName = channelRes.data.items[0].snippet.title;
        channelId = channelRes.data.items[0].id;
      }

      const userId = request.session.get('userId');
      if (!userId) {
          request.session.set('error', 'User not logged in');
          return reply.redirect('/login');
      }

      const ctx = await getAgencyContext(request, db);
      await db.query(
        `INSERT INTO platform_connections (user_id, agency_id, platform, access_token, refresh_token, token_expires_at, platform_user_id, platform_username)
         VALUES ($1, $2, 'youtube', $3, $4, $5, $6, $7)
         ON CONFLICT (user_id, platform) DO UPDATE SET
           access_token = $3, refresh_token = $4, token_expires_at = $5, platform_user_id = $6, platform_username = $7, agency_id = $2`,
        [userId, ctx?.agencyId || null, access_token, refresh_token || null, tokenExpiresAt, channelId, channelName]
      );

      request.session.set('success', `YouTube connected as ${channelName}`);
    } catch (err) {
      request.log.error(err, '[platforms] YouTube callback error');
      request.session.set('error', 'Failed to connect YouTube. Check app credentials.');
    }

    return reply.redirect('/#social-platforms');
  });
};
