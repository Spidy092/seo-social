require('dotenv').config();

const path = require('path');
const fastify = require('fastify')({ logger: true });

const config = require('./src/config');
const { createLogger } = require('./src/utils/logger');
const db = require('./src/db');
const { registerAll } = require('./src/utils/loadModules');
const { registerAuthHook, registerRateLimits, registerErrorHandlers } = require('./src/config/plugins');
const workerRegistry = require('./src/workers/registry');

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

    // ─── 2. Register Plugins (static, view, multipart, formbody, secure-session) ───
    const cors = require('@fastify/cors');
    const static_ = require('@fastify/static');
    const view = require('@fastify/view');
    const rateLimit = require('@fastify/rate-limit');
    const multipart = require('@fastify/multipart');
    const formbody = require('@fastify/formbody');
    const secureSession = require('@fastify/secure-session');
    const ejs = require('ejs');

    await fastify.register(cors, {
        origin: process.env.CORS_ORIGIN
            || (process.env.NODE_ENV === 'production' ? false : true),
    });

    // rate-limit core plugin (rules are added in registerRateLimits below)
    await fastify.register(rateLimit, {
        keyGenerator: (request) => request.ip,
        routeConfig: true,
        global: false,
    });

    await fastify.register(static_, {
        root: path.join(__dirname, 'public'),
        prefix: '/public/',
    });

    await fastify.register(view, {
        engine: { ejs },
        root: path.join(__dirname, 'views'),
    });

    await fastify.register(multipart, {
        limits: { fileSize: 100 * 1024 * 1024 }, 
    });

    await fastify.register(formbody);

    await fastify.register(secureSession, {
        secret: process.env.SESSION_SECRET || 'a-very-long-secret-key-that-is-at-least-32-bytes',
        salt: 'mq9hDxBVDbspDR6n',
        cookie: {
            path: '/',
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
        },
    });

    // ─── 3. Auth + rate-limit + error handlers (all centralized) ───
    registerAuthHook(fastify);
    await registerRateLimits(fastify);
    registerErrorHandlers(fastify);

    // ─── 4. Register every route under src/routes/ (incl. sub-dirs) ───
    const { registered, failed } = await registerAll(
        fastify,
        path.join(__dirname, 'src', 'routes'),
        { db },
    );
    if (failed.length) {
        log.error({ failed }, '❌ some routes failed to register');
    }
    log.info({ count: registered.length, routes: registered }, '✅ routes registered');

    // ─── 5. Dashboard + onboarding + health routes (live here, not in /routes) ───
    fastify.get('/', async (request, reply) => {
        return reply.view('index.ejs', {
            title: 'Keyword Analyzer & Social Poster',
            version: '1.0.0',
        });
    });

    fastify.get('/onboarding', async (request, reply) => {
        if (!request.session.get('userId')) {
            return reply.redirect('/login');
        }
        const userId = request.session.get('userId');
        try {
            const result = await db.query(
                `SELECT a.name FROM agencies a
                 JOIN agency_members am ON am.agency_id = a.id
                 WHERE am.user_id = $1
                 ORDER BY am.joined_at ASC LIMIT 1`,
                [userId],
            );
            const agencyName = result.rows[0]?.name || '';
            return reply.view('onboarding.ejs', { agencyName });
        } catch (err) {
            request.log.warn({ err: err.message }, 'onboarding: agency lookup failed');
            return reply.view('onboarding.ejs', { agencyName: '' });
        }
    });

    fastify.get('/health', async () => {
        try {
            await db.query('SELECT 1');
            return { status: 'ok', database: 'connected', uptime: process.uptime() };
        } catch (err) {
            return { status: 'error', database: 'disconnected', error: err.message };
        }
    });

    fastify.get('/health/ready', async (_request, reply) => {
        const { runAllChecks } = require('./src/services/healthCheckService');
        const result = await runAllChecks();
        const code = result.status === 'ok' ? 200 : 503;
        return reply.code(code).send(result);
    });

    // ─── 6. Worker endpoints (manual triggers for ops/debug) ───
    fastify.get('/api/admin/workers', async (request, reply) => {
        if (!request.session.get('userId')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        return { workers: workerRegistry.listJobs() };
    });

    fastify.post('/api/admin/workers/:name/run', async (request, reply) => {
        if (!request.session.get('userId')) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
        try {
            const result = await workerRegistry.runJob(request.params.name);
            return { ok: true, result };
        } catch (err) {
            return reply.code(404).send({ error: err.message });
        }
    });

    // ─── 7. Start Workers ───
    const workersEnabled = process.env.WORKER_ENABLED !== 'false';
    if (workersEnabled) {
        workerRegistry.discover();
        await workerRegistry.startAll(db);
        log.info('✅ background workers started in-process');
    } else {
        log.info('⏭️  in-process workers disabled (running as separate PM2 apps)');
    }

    // ─── 8. Start Server ───
    try {
        const address = await fastify.listen({
            port: config.server.port,
            host: config.server.host,
        });
        log.info(`🌐 Server running at ${address}`);
        log.info(`📊 Dashboard: http://localhost:${config.server.port}`);
        log.info(`🛠  Admin: GET /api/admin/workers, POST /api/admin/workers/:name/run`);
    } catch (err) {
        log.error({ err }, '❌ Failed to start server');
        process.exit(1);
    }
}

// ─── Graceful Shutdown ───
async function shutdown(signal) {
    log.info({ signal }, 'shutting down...');
    try {
        workerRegistry.stopAll();
        await fastify.close();
    } catch (err) {
        log.error({ err }, 'error during shutdown');
    } finally {
        process.exit(0);
    }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ─── Global Error Catchers ───
process.on('unhandledRejection', (reason) => {
    log.error({ err: reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (err) => {
    log.error({ err }, 'Uncaught exception — shutting down');
    process.exit(1);
});

main().catch(err => {
    log.error({ err }, '❌ Fatal error');
    process.exit(1);
});
