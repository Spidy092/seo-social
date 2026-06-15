/**
 * Centralized Fastify plugins/hooks.
 *
 * Anything that is identical across dev/staging/prod and identical across
 * every deployment lives here, so index.js can stay short and focused on
 * wiring up routes + workers.
 */

const { createLogger } = require('../utils/logger');
const log = createLogger('plugins');

// ─── Public route allowlist ──────────────────────────────────────────────
// Anything that must NOT trigger the auth hook. Used by the preValidation
// hook below AND by the rate-limit rules in registerRateLimits().
const PUBLIC_GET_ROUTES = new Set([
    '/login',
    '/register',
    '/health',
    '/health/ready',
    '/social/platforms/meta/callback',
    '/social/platforms/linkedin/callback',
    '/social/platforms/youtube/callback',
]);

const PUBLIC_PREFIXES = [
    '/public/',
    '/api/agency/validate-invite',
];

/**
 * Global auth gate. Add a public route above to allow anonymous access.
 *
 * Behaviour:
 *   - /public/* and PUBLIC_GET_ROUTES → pass through
 *   - /api/* without session → 401 JSON
 *   - everything else without session → 302 to /login
 */
function registerAuthHook(fastify) {
    fastify.addHook('preValidation', async (request, reply) => {
        const urlPath = request.url.split('?')[0];

        if (urlPath.startsWith('/public/')) return;
        if (PUBLIC_GET_ROUTES.has(urlPath)) return;
        if (urlPath.startsWith('/api/agency/validate-invite/')) return;
        if (PUBLIC_PREFIXES.some(p => urlPath === p || urlPath.startsWith(p))) return;

        if (!request.session.get('userId')) {
            request.log.info({ url: request.url, routerPath: request.routerPath }, 'Unauthenticated access');
            if (urlPath.startsWith('/api/')) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
            return reply.redirect('/login');
        }
    });

    log.info('auth hook registered');
}

/**
 * Per-route rate limits. Opt-in by URL prefix so we don't have to touch
 * individual route files. Adds a config.rateLimit block to every matching
 * route at registration time.
 */
async function registerRateLimits(fastify) {
    // RULES: array of [matcher(url, method) => bool, limit]
    const RULES = [
        // Strict limit on auth forms
        {
            match: (url, method) => method === 'POST' && (url === '/login' || url === '/register'),
            limit: { max: 10, timeWindow: '1 minute' },
            message: 'Too many attempts. Please wait a minute and try again.',
        },
        // Default for all /api/* endpoints
        {
            match: (url /*, method */) => url.startsWith('/api/'),
            limit: { max: 100, timeWindow: '1 minute' },
            message: 'Rate limit exceeded. Slow down a bit.',
        },
    ];

    await fastify.register(async (scope) => {
        scope.addHook('onRoute', (routeOptions) => {
            const method = (routeOptions.method || 'GET').toUpperCase();
            const url = routeOptions.url;

            for (const rule of RULES) {
                if (!rule.match(url, method)) continue;
                routeOptions.config = routeOptions.config || {};
                routeOptions.config.rateLimit = {
                    ...rule.limit,
                    errorResponseBuilder: (_request, context) => ({
                        error: 'Too many requests',
                        message: `${rule.message} (retry in ${Math.ceil(context.ttl / 1000)}s)`,
                        statusCode: 429,
                    }),
                };
                // first matching rule wins
                break;
            }
        });
    });

    log.info('rate-limit rules registered');
}

/**
 * Standard 404 + error handlers. They auto-format JSON for /api/* and HTML
 * for browser routes, with a hard-coded fallback if 404.ejs is missing.
 */
function registerErrorHandlers(fastify) {
    fastify.setNotFoundHandler(async (request, reply) => {
        const urlPath = request.url.split('?')[0];

        if (urlPath.startsWith('/api/')) {
            return reply.code(404).send({
                error: 'Not Found',
                message: `API route ${request.method} ${urlPath} does not exist`,
                statusCode: 404,
            });
        }

        return reply.code(404).view('404.ejs', { title: '404 — Page Not Found', url: urlPath })
            .catch(() => reply.code(404).send(FALLBACK_404_HTML(urlPath)));
    });

    fastify.setErrorHandler((err, request, reply) => {
        const statusCode = err.statusCode || 500;
        const urlPath = request.url.split('?')[0];

        log.error({ err, url: request.url, method: request.method }, 'Unhandled route error');

        if (urlPath.startsWith('/api/')) {
            return reply.code(statusCode).send({
                error: statusCode === 500 ? 'Internal Server Error' : err.message,
                message: process.env.NODE_ENV === 'production'
                    ? 'An unexpected error occurred'
                    : err.message,
                statusCode,
            });
        }

        return reply.code(statusCode).send(
            `<!DOCTYPE html><html><head><title>Error ${statusCode}</title></head>
             <body><h1>Error ${statusCode}</h1><p>${err.message}</p><a href="/">Back to Dashboard</a></body></html>`
        );
    });

    log.info('error + 404 handlers registered');
}

function FALLBACK_404_HTML(urlPath) {
    return `<!DOCTYPE html>
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
    a { display: inline-block; padding: 12px 28px; background: #6366f1; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
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
</html>`;
}

module.exports = {
    registerAuthHook,
    registerRateLimits,
    registerErrorHandlers,
    PUBLIC_GET_ROUTES,
    PUBLIC_PREFIXES,
};
