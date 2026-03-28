const bcrypt = require('bcryptjs');

module.exports = async function (fastify, options) {
    const { db } = options;

    // ----- GET /login -----
    fastify.get('/login', async (request, reply) => {
        if (request.session.get('userId')) {
            return reply.redirect('/');
        }
        return reply.view('login.ejs', { 
            error: request.session.get('error') || null,
            success: request.query.success || null
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
                request.session.set('error', null); // Clear error
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

    // ----- POST /register (for initial setup) -----
    // Note: In a real app we might restrict who can register.
    fastify.post('/register', async (request, reply) => {
        const { email, password } = request.body;
        try {
            const password_hash = await bcrypt.hash(password, 10);
            const result = await db.query(
                'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id',
                [email, password_hash]
            );
            return reply.redirect('/login?success=register');
        } catch (err) {
            request.log.error(err, 'Register error');
            request.session.set('error', 'Could not register account');
            return reply.redirect('/login');
        }
    });

    // ----- GET /logout -----
    fastify.get('/logout', async (request, reply) => {
        request.session.delete();
        return reply.redirect('/login');
    });
};
