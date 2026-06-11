const bcrypt = require('bcryptjs');
const { createLogger } = require('../utils/logger');

const log = createLogger('routes:auth');

/**
 * Create a personal agency for a newly registered user.
 * Also backs existing clients that have no agency_id.
 */
async function createPersonalAgency(db, userId, email) {
    const agencyName = email.split('@')[0] + "'s Agency";
    const agencyRes = await db.query(
        `INSERT INTO agencies (name, created_by) VALUES ($1, $2) RETURNING id`,
        [agencyName, userId]
    );
    const agencyId = agencyRes.rows[0].id;

    await db.query(
        `INSERT INTO agency_members (agency_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [agencyId, userId]
    );

    // Backfill: assign any existing clients/tasks belonging to this user to the new agency
    await db.query(
        `UPDATE seo_clients SET agency_id = $1 WHERE user_id = $2 AND agency_id IS NULL`,
        [agencyId, userId]
    );
    await db.query(
        `UPDATE seo_tasks SET agency_id = $1 WHERE user_id = $2 AND agency_id IS NULL`,
        [agencyId, userId]
    );

    return agencyId;
}

/**
 * Accept an invite token: add user to the inviter's agency.
 */
async function acceptInvite(db, userId, token) {
    const inviteRes = await db.query(
        `SELECT * FROM agency_invites
         WHERE token = $1 AND accepted = FALSE AND expires_at > NOW()`,
        [token]
    );

    if (!inviteRes.rows.length) return null;

    const invite = inviteRes.rows[0];

    await db.query(
        `INSERT INTO agency_members (agency_id, user_id, role, invited_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (agency_id, user_id) DO NOTHING`,
        [invite.agency_id, userId, invite.role, invite.invited_by]
    );

    await db.query(
        `UPDATE agency_invites SET accepted = TRUE WHERE id = $1`,
        [invite.id]
    );

    return invite.agency_id;
}

module.exports = async function (fastify, options) {
    const { db } = options;

    // ----- GET /login -----
    fastify.get('/login', async (request, reply) => {
        if (request.session.get('userId')) {
            return reply.redirect('/');
        }
        const error = request.session.get('error') || null;
        if (error) {
            request.session.set('error', null);
        }
        return reply.view('login.ejs', { 
            error,
            success: request.query.success || null
        });
    });

    // ----- GET /register -----
    fastify.get('/register', async (request, reply) => {
        if (request.session.get('userId')) {
            return reply.redirect('/');
        }
        const invite = request.query.invite || null;
        const error = request.session.get('error') || null;
        if (error) {
            request.session.set('error', null);
        }

        // Validate invite token if present
        let inviteInfo = null;
        if (invite) {
            try {
                const result = await db.query(
                    `SELECT ai.email, ai.role, a.name AS agency_name
                     FROM agency_invites ai
                     JOIN agencies a ON a.id = ai.agency_id
                     WHERE ai.token = $1 AND ai.accepted = FALSE AND ai.expires_at > NOW()`,
                    [invite]
                );
                if (result.rows.length) {
                    inviteInfo = result.rows[0];
                }
            } catch (err) {
                log.debug({ err: err.message, token: invite }, 'invite token validation failed — treating as no invite');
            }
        }

        return reply.view('register.ejs', {
            error,
            invite,
            inviteInfo,
        });
    });

    // ----- POST /login -----
    fastify.post('/login', async (request, reply) => {
        const { email, password } = request.body;

        try {
            const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
            const user = result.rows[0];

            if (user && await bcrypt.compare(password, user.password_hash)) {
                request.session.set('userId', user.id);
                request.session.set('error', null);
                return reply.redirect('/');
            }

            request.session.set('error', 'Invalid email or password');
            return reply.redirect('/login');
        } catch (err) {
            request.log.error(err, 'Login error');
            request.session.set('error', 'Something went wrong. Please try again.');
            return reply.redirect('/login');
        }
    });

    // ----- POST /register -----
    fastify.post('/register', async (request, reply) => {
        const { email, password, invite } = request.body || {};

        if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
            request.session.set('error', 'Email and password are required');
            return reply.redirect('/register');
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            request.session.set('error', 'Please enter a valid email address');
            return reply.redirect('/register');
        }

        if (password.length < 6) {
            request.session.set('error', 'Password must be at least 6 characters long');
            return reply.redirect('/register');
        }

        // If invite provided, validate email matches
        if (invite) {
            try {
                const inviteRes = await db.query(
                    `SELECT email FROM agency_invites WHERE token = $1 AND accepted = FALSE AND expires_at > NOW()`,
                    [invite]
                );
                if (inviteRes.rows.length && inviteRes.rows[0].email.toLowerCase() !== email.trim().toLowerCase()) {
                    request.session.set('error', 'This invite is for a different email address');
                    return reply.redirect(`/register?invite=${invite}`);
                }
            } catch (err) {
                log.debug({ err: err.message, token: invite }, 'invite email validation failed — proceeding without validation');
            }
        }

        try {
            const password_hash = await bcrypt.hash(password, 10);
            const result = await db.query(
                'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
                [email.trim().toLowerCase(), password_hash]
            );
            const userId = result.rows[0].id;

            if (invite) {
                // Try to accept the invite
                const agencyId = await acceptInvite(db, userId, invite);
                if (agencyId) {
                    log.info({ userId, agencyId }, 'user joined agency via invite');
                    request.session.set('userId', userId);
                    request.session.set('error', null);
                    return reply.redirect('/');
                }
            }

            // No invite or invite failed — create a personal agency
            const agencyId = await createPersonalAgency(db, userId, email.trim().toLowerCase());
            log.info({ userId, agencyId }, 'personal agency created for new user');

            // Auto-login and redirect to onboarding wizard
            request.session.set('userId', userId);
            request.session.set('error', null);
            return reply.redirect('/onboarding');
        } catch (err) {
            request.log.error(err, 'Register error');
            request.session.set('error', 'Could not register account: email might be taken');
            return reply.redirect(invite ? `/register?invite=${invite}` : '/register');
        }
    });

    // ----- GET /logout -----
    fastify.get('/logout', async (request, reply) => {
        request.session.delete();
        return reply.redirect('/login');
    });
};
