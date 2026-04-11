require('dotenv').config();

const path = require('path');
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const static = require('@fastify/static');
const view = require('@fastify/view');
const ejs = require('ejs');

const config = require('./src/config');
const { logger, createLogger } = require('./src/utils/logger');
const db = require('./src/db');
const { startRankTracker } = require('./src/workers/rankTracker');

// Routes
const keywordRoutes = require('./src/routes/keywords');
const competitorRoutes = require('./src/routes/competitors');
const analysisRoutes = require('./src/routes/analysis');
const alertRoutes = require('./src/routes/alerts');
const onpageRoutes = require('./src/routes/onpage');
const technicalRoutes = require('./src/routes/technical');
const contentRoutes = require('./src/routes/content');


const log = createLogger('server');

async function main() {
    log.info('🚀 Starting Keyword Analyzer...');

    // ─── 1. Database ───
    try {
        await db.initializeDatabase();
        log.info('✅ Database initialized');
    } catch (err) {
        log.error({ err }, '❌ Database initialization failed');
        log.info('💡 Make sure PostgreSQL is running and the database exists.');
        log.info('   Run: createdb keyword_analyzer');
        process.exit(1);
    }

    const secureSession = require('@fastify/secure-session');
    const formbody = require('@fastify/formbody');
    const authRoutes = require('./src/routes/auth');

    // ─── 2. Register Plugins ───
    await fastify.register(cors, { origin: true });
    
    await fastify.register(static, {
        root: path.join(__dirname, 'public'),
        prefix: '/public/',
    });

    await fastify.register(view, {
        engine: { ejs },
        root: path.join(__dirname, 'views'),
    });

    await fastify.register(require('@fastify/multipart'), {
        limits: {
            fileSize: 100 * 1024 * 1024 // 100MB margin for video uploads
        }
    });

    await fastify.register(formbody);

    // Provide a secret key for development. In production, use env var.
    await fastify.register(secureSession, {
        secret: process.env.SESSION_SECRET || 'a-very-long-secret-key-that-is-at-least-32-bytes',
        salt: 'mq9hDxBVDbspDR6n',
        cookie: {
            path: '/',
            httpOnly: true
        }
    });

    // ─── Global Auth Hook ───
    fastify.addHook('preValidation', async (request, reply) => {
        const urlPath = request.url.split('?')[0];
        const publicRoutes = [
            '/login', '/register', '/health', 
            '/social/platforms/meta/callback', 
            '/social/platforms/linkedin/callback', 
            '/social/platforms/youtube/callback'
        ];

        const isPublic = urlPath.startsWith('/public/') || 
                         publicRoutes.includes(urlPath) || 
                         publicRoutes.includes(request.routerPath);

        if (isPublic) {
            return;
        }

        if (!request.session.get('userId')) {
            request.log.info({ url: request.url, routerPath: request.routerPath }, 'Unauthenticated access, redirecting to /login');
            return reply.redirect('/login');
        }
    });

    // ─── 3. Register Routes ───
    await fastify.register(authRoutes, { db });
    await fastify.register(keywordRoutes, { db });
    await fastify.register(competitorRoutes, { db });
    await fastify.register(analysisRoutes, { db });
    await fastify.register(alertRoutes, { db });
    await fastify.register(onpageRoutes, { db });
    await fastify.register(technicalRoutes, { db });
    await fastify.register(contentRoutes, { db });
    
    // Social Routes
    await fastify.register(require('./src/routes/social/platforms'), { db });
    await fastify.register(require('./src/routes/social/posts'), { db });
    await fastify.register(require('./src/routes/social/analytics'), { db });
    await fastify.register(require('./src/routes/social/captions'), { db });

    // ─── 4. Dashboard Route ───
    fastify.get('/', async (request, reply) => {
        return reply.view('index.ejs', {
            title: 'Keyword Analyzer & Social Poster',
            version: '1.0.0',
        });
    });

    // ─── 5. Health Check ───
    fastify.get('/health', async () => {
        try {
            await db.query('SELECT 1');
            return { status: 'ok', database: 'connected', uptime: process.uptime() };
        } catch (err) {
            return { status: 'error', database: 'disconnected', error: err.message };
        }
    });

    // ─── 6. Start Workers ───
    startRankTracker(db);
    require('./src/workers/postScheduler').startScheduler();
    require('./src/services/analyticsSync').startAnalyticsCron();

    // ─── 7. Start Server ───
    try {
        const address = await fastify.listen({ 
            port: config.server.port, 
            host: config.server.host 
        });
        log.info(`🌐 Server running at ${address}`);
        log.info(`📊 Dashboard: http://localhost:${config.server.port}`);
    } catch (err) {
        log.error({ err }, '❌ Failed to start server');
        process.exit(1);
    }
}

// ─── Graceful Shutdown ───
process.on('SIGTERM', async () => {
    log.info('SIGTERM received, shutting down...');
    await fastify.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    log.info('SIGINT received, shutting down...');
    await fastify.close();
    process.exit(0);
});

main().catch(err => {
    log.error({ err }, '❌ Fatal error');
    process.exit(1);
});
