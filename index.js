require('dotenv').config();

const path = require('path');
const fastify = require('fastify')({ logger: true });
const cors = require('@fastify/cors');
const static = require('@fastify/static');
const view = require('@fastify/view');
const rateLimit = require('@fastify/rate-limit');
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
const clientRoutes = require('./src/routes/clients');
const reportRoutes = require('./src/routes/reports');
const gscRoutes    = require('./src/routes/gsc');
const ga4Routes    = require('./src/routes/ga4');
const seoPerformanceRoutes = require('./src/routes/seoPerformance');
const searchVisibilityRoutes = require('./src/routes/searchVisibility');
const agencyRoutes = require('./src/routes/agency');
const scheduledReportRoutes = require('./src/routes/scheduledReports');


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
    await fastify.register(cors, { 
        origin: process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? false : true),
    });

    // ─── Rate Limiting (API routes only) ───
    await fastify.register(rateLimit, {
        // Apply only to /api/* routes
        keyGenerator: (request) => request.ip,
        routeConfig: true,           // allow per-route overrides
        global: false,               // opt-in per route prefix instead
    });

    // Scoped rate limiter for all /api/* routes: 100 requests per 1 minute per IP
    await fastify.register(async (apiScope) => {
        apiScope.addHook('onRoute', (routeOptions) => {
            if (routeOptions.url.startsWith('/api/')) {
                routeOptions.config = routeOptions.config || {};
                routeOptions.config.rateLimit = {
                    max: 100,
                    timeWindow: '1 minute',
                    errorResponseBuilder: (_request, context) => ({
                        error: 'Too many requests',
                        message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
                        statusCode: 429,
                    }),
                };
            }
            // Stricter rate limit for auth routes: 10 requests per 1 minute per IP
            if (routeOptions.url === '/login' || routeOptions.url === '/register') {
                routeOptions.config = routeOptions.config || {};
                routeOptions.config.rateLimit = {
                    max: 10,
                    timeWindow: '1 minute',
                    errorResponseBuilder: (_request, context) => ({
                        error: 'Too many requests',
                        message: `Too many attempts. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
                        statusCode: 429,
                    }),
                };
            }
        });
    });
    
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
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
        }
    });

    // ─── Global Auth Hook ───
    fastify.addHook('preValidation', async (request, reply) => {
        const urlPath = request.url.split('?')[0];
        const publicRoutes = [
            '/login', '/register', '/health', 
            '/social/platforms/meta/callback', 
            '/social/platforms/linkedin/callback', 
            '/social/platforms/youtube/callback',
            '/api/agency/validate-invite',
        ];

        const isPublic = urlPath.startsWith('/public/') || 
                         publicRoutes.includes(urlPath) || 
                         publicRoutes.includes(request.routerPath) ||
                         urlPath.startsWith('/api/agency/validate-invite/');

        if (isPublic) {
            return;
        }

        if (!request.session.get('userId')) {
            request.log.info({ url: request.url, routerPath: request.routerPath }, 'Unauthenticated access');
            if (urlPath.startsWith('/api/')) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
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
    await fastify.register(clientRoutes, { db });
    await fastify.register(reportRoutes, { db });
    await fastify.register(gscRoutes,    { db });
    await fastify.register(ga4Routes,    { db });
    await fastify.register(seoPerformanceRoutes, { db });
    await fastify.register(searchVisibilityRoutes, { db });
    await fastify.register(agencyRoutes, { db });
    await fastify.register(scheduledReportRoutes, { db });
    await fastify.register(require('./src/routes/tasks'), { db });
    await fastify.register(require('./src/routes/projectDashboard'), { db });
    await fastify.register(require('./src/routes/pageOptimization'), { db });
    
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

    // ─── Onboarding Wizard Route ───
    fastify.get('/onboarding', async (request, reply) => {
        if (!request.session.get('userId')) {
            return reply.redirect('/login');
        }

        // Get the user's agency name for the wizard
        const userId = request.session.get('userId');
        try {
            const result = await db.query(
                `SELECT a.name FROM agencies a
                 JOIN agency_members am ON am.agency_id = a.id
                 WHERE am.user_id = $1
                 ORDER BY am.joined_at ASC LIMIT 1`,
                [userId]
            );
            const agencyName = result.rows[0]?.name || '';
            return reply.view('onboarding.ejs', { agencyName });
        } catch (err) {
            return reply.view('onboarding.ejs', { agencyName: '' });
        }
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

    // ─── 5b. Readiness Check (probes all external APIs) ───
    fastify.get('/health/ready', async (_request, reply) => {
        const { runAllChecks } = require('./src/services/healthCheckService');
        const result = await runAllChecks();
        const code = result.status === 'ok' ? 200 : 503;
        return reply.code(code).send(result);
    });

    // ─── 6. Custom 404 Handler ───
    fastify.setNotFoundHandler(async (request, reply) => {
        const urlPath = request.url.split('?')[0];

        // Return JSON for API routes
        if (urlPath.startsWith('/api/')) {
            return reply.code(404).send({
                error: 'Not Found',
                message: `API route ${request.method} ${urlPath} does not exist`,
                statusCode: 404,
            });
        }

        // Render a friendly HTML 404 page for browser routes
        return reply.code(404).view('404.ejs', {
            title: '404 — Page Not Found',
            url: urlPath,
        }).catch(() => {
            // Fallback if 404.ejs template doesn't exist yet
            return reply.code(404).send(
                `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Page Not Found</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', sans-serif; background: #0f1117; color: #e2e8f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; text-align: center; }
    .container { max-width: 480px; padding: 40px 24px; }
    .code { font-size: 7rem; font-weight: 700; color: #6366f1; line-height: 1; margin-bottom: 16px; }
    h1 { font-size: 1.6rem; font-weight: 600; margin-bottom: 12px; }
    p { color: #94a3b8; margin-bottom: 32px; line-height: 1.6; }
    a { display: inline-block; padding: 12px 28px; background: #6366f1; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; transition: background .2s; }
    a:hover { background: #4f46e5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="code">404</div>
    <h1>Page Not Found</h1>
    <p>The page <strong>${urlPath}</strong> doesn't exist or has been moved.</p>
    <a href="/">← Back to Dashboard</a>
  </div>
</body>
</html>`
            );
        });
    });

    // ─── 6b. Global Error Handler ───
    fastify.setErrorHandler((err, request, reply) => {
        const statusCode = err.statusCode || 500;
        const urlPath = request.url.split('?')[0];

        log.error({ err, url: request.url, method: request.method }, 'Unhandled route error');

        // JSON for API routes
        if (urlPath.startsWith('/api/')) {
            return reply.code(statusCode).send({
                error: statusCode === 500 ? 'Internal Server Error' : err.message,
                message: process.env.NODE_ENV === 'production'
                    ? 'An unexpected error occurred'
                    : err.message,
                statusCode,
            });
        }

        // Fallback for browser routes
        return reply.code(statusCode).send(
            `<!DOCTYPE html><html><head><title>Error ${statusCode}</title></head>
             <body><h1>Error ${statusCode}</h1><p>${err.message}</p><a href="/">Back to Dashboard</a></body></html>`
        );
    });

    // ─── 7. Start Workers ───
    // When running under PM2 with separate worker apps, skip in-process workers.
    // Set WORKER_ENABLED=false in ecosystem.config.js to disable in-process workers.
    const workersEnabled = process.env.WORKER_ENABLED !== 'false';
    if (workersEnabled) {
        startRankTracker(db);
        require('./src/workers/postScheduler').startScheduler();
        require('./src/services/analyticsSync').startAnalyticsCron();
        require('./src/workers/gscSync').startGscSync(db);
        require('./src/workers/scheduledReports').startScheduledReports(db);
        log.info('✅ background workers started in-process');
    } else {
        log.info('⏭️  in-process workers disabled (running as separate PM2 apps)');
    }
    require('./src/workers/ga4Sync').startGa4Sync(db);

    // ─── 8. Start Server ───
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

// ─── Global Error Catchers ───
process.on('unhandledRejection', (reason, promise) => {
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
