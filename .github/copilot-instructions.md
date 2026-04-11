# Copilot instructions for Keyword Analyzer

## Architecture
- This repo is a single CommonJS Fastify app started from `index.js`; it registers all backend routes, EJS views, static assets, session middleware, and background jobs in one place.
- Treat it as two products sharing one server: SEO/keyword analysis APIs under `src/routes/*.js` and a social posting tool under `src/routes/social/*.js` with views in `views/social/`.
- Request flow is usually `route -> service -> direct SQL persistence`. Example: `src/routes/keywords.js` calls `keywordService`, then persists rows with `db.query(...)`; there is no ORM layer.
- Database schema is created at startup by `src/db/index.js` via `initializeDatabase()`. Prefer updating that file when adding tables/indexes; do not assume a migration system exists.
- JSONB is used for flexible payloads (`analysis_reports.comparison_data`, `analysis_reports.suggestions`, `posts.platforms`), so new features often need both SQL changes and serialization updates.

## Backend patterns
- Routes usually define Fastify `schema.body` inline and return JSON shaped like `{ success: true, ... }` on success and `reply.code(500).send({ error: err.message })` on failure.
- Keep heavier logic in services such as `src/services/keywordService.js`, `src/services/analysisService.js`, and `src/services/onpageService.js`; route files commonly orchestrate I/O and persistence only.
- Use parameterized `db.query(...)` SQL and existing `ON CONFLICT ... DO UPDATE` patterns for upserts. Keyword and competitor persistence in `src/routes/keywords.js` is the main example.
- Preserve local file style instead of forcing one global style: most core files use 4-space indentation, while some social modules use 2 spaces.
- Use `createLogger()` from `src/utils/logger.js` in core backend modules. Some social/worker files still use `console.log`; match the surrounding file unless you are already refactoring that area.

## Auth, UI, and data flow
- A global `preValidation` hook in `index.js` redirects unauthenticated requests to `/login`; only `/login`, `/register`, `/health`, `/public/*`, and OAuth callbacks are public.
- Main dashboard UX is an EJS page plus a large hash-based frontend controller in `public/js/app.js`; many panels call JSON APIs and swap views client-side instead of using separate pages.
- Social pages (`/social/posts/upload`, `/social/posts/schedule`, `/social/platforms`, `/social/analytics`) are rendered server-side and loaded into iframes from the dashboard.
- Social/auth flows use session-backed flash messages via `request.session.set('error'|'success', ...)` and redirect, not JSON responses.

## Integrations and background jobs
- SEO features rely on env-driven fallbacks in `src/config/index.js` and `src/services/keywordService.js`: Serper is preferred, Google scraping is fallback, and OpenPageRank is used for authority scoring.
- AI features are split: `src/services/aiService.js` compares domains via OpenRouter first and Groq second; `src/services/openrouter.js` generates platform-specific captions; `src/routes/onpage.js` uses OpenRouter directly for AI fixes.
- Social publishing depends on Cloudinary uploads (`src/services/cloudinary.js`), OAuth tokens in `platform_connections`, and platform adapters in `src/services/platforms/`.
- Starting the app also starts cron/background work: `rankTracker`, `postScheduler`, and `analyticsSync`. Be careful with startup-side effects when debugging or changing boot code.
- `src/services/analyticsSync.js` currently uses mocked analytics data, so do not assume live platform metrics exist yet.

## Developer workflow
- Use `npm run dev` for local work and `npm start` for a plain run. Smoke-test with `/health` after backend changes.
- `npm test` is only a placeholder and exits with an error; do not rely on an automated test suite being present.
- `npm run migrate` points to `src/db/migrate.js`, but the repo currently auto-creates schema in `src/db/index.js` and that migrate file is not present.
- Useful maintenance scripts live at the repo root: `check_keywords.js` inspects duplicate keywords and `cleanup_db.js` removes bad tracked-domain rows.
- The app expects PostgreSQL plus several optional API keys in `.env`; copy from `.env.example` and prefer keeping new config in `src/config/index.js` instead of reading env vars ad hoc.

## Change guidance
- When adding a new endpoint, update the matching route file, the service it delegates to, and any DB persistence in the same pass.
- When changing API response shapes, check `public/js/app.js` and the relevant EJS templates because the frontend is tightly coupled to current JSON field names.
- When changing social publishing or OAuth logic, review both the route handlers in `src/routes/social/` and token refresh behavior in `src/services/platforms/index.js`.
- When adding startup-dependent behavior, consider the cron jobs and auth hook in `index.js`; many bugs here affect the whole app, not one feature.
