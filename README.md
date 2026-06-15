# 🔍 Keyword Analyzer — SEO Agency Dashboard

> Advanced SEO Keyword Research, Rank Tracking, Competitor Analysis, Content Briefs & Agency Reporting Tool

Built with **Node.js + Fastify + PostgreSQL + EJS**. Runs as a private, session-protected internal dashboard for SEO agencies.

---

## 📋 Table of Contents

- [Features](#-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Prerequisites](#-prerequisites)
- [Installation](#-installation)
- [Environment Variables](#-environment-variables)
- [Running the App](#-running-the-app)
- [API Routes](#-api-routes)
- [Database Schema](#-database-schema)
- [Background Workers](#-background-workers)
- [Deployment](#-deployment)
- [Known Issues](#-known-issues)

---

## ✅ Features

| Module | Description |
|---|---|
| **Keyword Research** | SERP data via Serper API + real search volume from Google Ads Keyword Planner. Includes intent analysis, CPC, difficulty, and content gap |
| **Competitor Analysis** | Tracks all domains ranking for your researched keywords, shows avg position and keyword overlap |
| **Head-to-Head Analysis** | Compare two domains: DA, content length, keyword density, technical factors |
| **Rank Tracking** | Automated daily SERP checks for your tracked domains. Stores history and generates alerts on significant position changes |
| **Alerts** | Rank drop / improvement / new / lost ranking alerts with optional webhook (Telegram/Discord) |
| **On-Page SEO Analyzer** | Crawl any URL (or paste HTML) and get a full on-page audit with AI-generated fix suggestions |
| **Technical SEO Crawler** | Site-wide crawl: robots.txt, sitemap, broken links, missing meta, page load times |
| **PageSpeed Insights** | Google PageSpeed API integration — Core Web Vitals scores per URL |
| **Page Optimization** | Compare your page vs top-ranking competitors for a keyword; highlights content gaps |
| **Client Management** | Store client info (website, industry, audience, goals, competitors, services) |
| **Project Management** | Create SEO projects under clients (Local SEO, Blog, Content Plan, etc.) |
| **Project SEO Dashboard** | Per-project view: keyword rankings, 7-day movement, technical score, competitors, content gaps, alerts, next actions |
| **Content Briefs** | AI-generated content briefs based on SERP analysis for any keyword |
| **Content Humanizer** | AI rewriter that reduces AI-generated content detection score |
| **Agency Reports** | Full PDF-ready reports: rankings, rank changes, PageSpeed, technical score, competitor overview, AI executive summary + 4-week action plan |
| **SEO Tasks** | Kanban-style task manager with priority, category, and status tracking |
| **Social Poster** | Schedule and publish posts to Meta (Facebook/Instagram), LinkedIn, and YouTube |
| **Social Analytics** | Track engagement (likes, comments, shares, reach) per post per platform |
| **🤖 Full Project Audit (auto)** | One click (or auto on project create) runs every check — technical, on-page, PageSpeed, keywords, competitors, GSC, GA4, search visibility — and returns a unified report with score + prioritized action list. Polls progress, persists history, weekly re-audits run on a schedule. |

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (CommonJS) |
| Framework | Fastify v5 |
| Template Engine | EJS (server-rendered SPA) |
| Database | PostgreSQL 14+ |
| Query Style | Raw SQL (parameterized, no ORM) |
| Auth | `@fastify/secure-session` + bcrypt |
| AI | OpenRouter API + Groq API |
| SERP Data | Serper.dev API |
| Search Volume | Google Ads Keyword Planner API |
| PageSpeed | Google PageSpeed Insights API |
| HTML Parsing | Cheerio |
| HTTP Client | Axios |
| File Storage | Cloudinary (for social media images) |
| Cron Jobs | node-cron |
| Logging | Pino |
| Process Manager | PM2 (production) |
| Reverse Proxy | Nginx |

---

## 📁 Project Structure

```
keyword-analyzer/
├── index.js                        # Server entry: plugins, routes, worker startup
├── package.json
├── ecosystem.config.js             # PM2 production configuration
├── nginx.conf                      # Nginx reverse proxy config
├── deploy.sh                       # Production deployment script
├── .env                            # Environment variables (do NOT commit)
├── .env.example                    # Safe template for .env
│
├── src/
│   ├── config/
│   │   └── index.js                # Reads all env vars, exports config object
│   │
│   ├── db/
│   │   └── index.js                # PostgreSQL pool + full schema creation on startup
│   │
│   ├── routes/
│   │   ├── auth.js                 # POST /login, /register, /logout
│   │   ├── keywords.js             # POST /api/keywords/research, /api/keywords/save, etc.
│   │   ├── competitors.js          # GET /api/competitors
│   │   ├── analysis.js             # POST /api/analysis/compare
│   │   ├── alerts.js               # GET/PATCH /api/alerts
│   │   ├── onpage.js               # POST /api/onpage/analyze, /api/onpage/ai-fix
│   │   ├── technical.js            # POST /api/technical/audit, /api/technical/pagespeed
│   │   ├── content.js              # POST /api/content/rewrite
│   │   ├── contentBriefs.js        # POST /api/content-briefs/generate, GET /api/content-briefs
│   │   ├── pageOptimization.js     # POST /api/page-optimization/analyze
│   │   ├── clients.js              # CRUD /api/clients, /api/projects
│   │   ├── projectDashboard.js     # GET /api/project-dashboard/:projectId
│   │   ├── reports.js              # POST /api/reports/generate, GET /reports/:id/html
│   │   ├── tasks.js                # CRUD /api/tasks
│   │   └── social/
│   │       ├── platforms.js        # OAuth connect/disconnect for Meta, LinkedIn, YouTube
│   │       ├── posts.js            # Create, schedule, publish posts
│   │       ├── analytics.js        # GET /api/social/analytics
│   │       └── captions.js         # AI caption generation
│   │
│   ├── services/
│   │   ├── keywordService.js       # SERP fetching, related keywords, intent, domain extract
│   │   ├── googleAdsService.js     # Real search volume from Google Ads API
│   │   ├── analysisService.js      # Domain comparison logic
│   │   ├── technicalSeoService.js  # Site crawler (robots, sitemap, links, meta)
│   │   ├── pageSpeedService.js     # Google PageSpeed Insights API wrapper
│   │   ├── reportService.js        # Aggregates all data for agency reports + AI narrative
│   │   ├── contentBriefService.js  # SERP-based content brief generator
│   │   ├── humanizerService.js     # AI content rewriter / humanizer
│   │   ├── onpageService.js        # On-page HTML analysis
│   │   ├── pageOptimizationService.js  # Gap analysis vs competitors
│   │   ├── taskService.js          # Task CRUD business logic
│   │   ├── aiService.js            # AI provider abstraction
│   │   ├── openrouter.js           # OpenRouter LLM client
│   │   ├── cloudinary.js           # Image upload helper
│   │   └── analyticsSync.js        # Social analytics sync cron
│   │
│   ├── workers/
│   │   ├── rankTracker.js          # Cron: daily rank checks + alerts generation
│   │   └── postScheduler.js        # Cron: publish scheduled social posts
│   │
│   └── utils/
│       ├── logger.js               # Pino logger factory
│       └── aiHelper.js             # Resilient LLM request with retry logic
│
├── views/
│   ├── index.ejs                   # Main SPA (all pages in one file, JS-driven nav)
│   ├── login.ejs                   # Login / Register page
│   ├── report.ejs                  # HTML report template (printable / PDF)
│   └── social/
│       ├── upload.ejs
│       ├── schedule.ejs
│       ├── platforms.ejs
│       └── analytics.ejs
│
├── public/
│   ├── css/
│   │   ├── style.css               # Main dashboard styles
│   │   ├── onpage.css
│   │   ├── technical.css
│   │   ├── project-dashboard.css
│   │   ├── page-optimization.css
│   │   └── tasks.css
│   └── js/
│       ├── app.js                  # Main frontend logic (~104KB)
│       ├── onpage.js
│       ├── technical.js
│       └── reports.js
│
└── logs/
    ├── pm2-out.log
    └── pm2-error.log
```

---

## ⚙️ Prerequisites

- **Node.js** v18+ (LTS recommended)
- **PostgreSQL** 14+
- **npm** (no Yarn or pnpm needed)
- Valid API keys (see [Environment Variables](#-environment-variables))

---

## 🚀 Installation

### 1. Clone the repo

```bash
git clone <your-repo-url>
cd keyword-analyzer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create your `.env` file

```bash
cp .env.example .env
```

Then fill in all values. See the [Environment Variables](#-environment-variables) section below.

### 4. Set up PostgreSQL

```bash
# Create the database
psql -U postgres -c "CREATE DATABASE keyword_analyzer;"
```

The app auto-creates all tables on first startup via `src/db/index.js`.

### 5. Run in development mode

```bash
npm run dev
```

The app will be available at `http://localhost:4000`

### 6. Register your first user

Go to `http://localhost:4000/login` → click **Create Account**.

---

## 🔐 Environment Variables

Create a `.env` file in the project root. All required variables are listed below.

### Database

```env
DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/keyword_analyzer
DB_HOST=localhost
DB_PORT=5432
DB_NAME=keyword_analyzer
DB_USER=postgres
DB_PASSWORD=yourpassword
```

### Server

```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=development        # or production
LOG_LEVEL=info
SESSION_SECRET=a-very-long-random-secret-key-at-least-32-chars
```

### SERP Data (Required for keyword research & rank tracking)

```env
SERPER_API_KEY=your_serper_api_key
```

Get a free key at [serper.dev](https://serper.dev) — 2,500 free searches/month.

### Google Custom Search (Optional fallback)

```env
GOOGLE_CSE_API_KEY=your_google_cse_api_key
GOOGLE_CSE_CX=your_search_engine_id
```

### Google Ads Keyword Planner (Real search volume)

```env
GOOGLE_ADS_CLIENT_ID=your_oauth_client_id
GOOGLE_ADS_CLIENT_SECRET=your_oauth_client_secret
GOOGLE_ADS_DEV_TOKEN=your_dev_token
GOOGLE_ADS_REFRESH_TOKEN=your_refresh_token
GOOGLE_ADS_LOGIN_CUSTOMER_ID=your_customer_id
```

Guide: [Google Ads API Setup](https://developers.google.com/google-ads/api/docs/first-call/overview)

### PageSpeed Insights

```env
PAGESPEED_API_KEY=your_google_api_key
```

Get from [Google Cloud Console](https://console.cloud.google.com) → Enable PageSpeed Insights API.

### Open PageRank (Domain Authority)

```env
OPENPAGERANK_API_KEY=your_openpagerank_key
```

Free key at [openpagerank.com](https://openpagerank.com)

### AI Providers (for content briefs, reports, humanizer)

```env
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openrouter/owl-alpha
OPENROUTER_URL=https://openrouter.ai/api/v1/chat/completions

GROQ_API_KEY=gsk_...
```

Get OpenRouter key at [openrouter.ai](https://openrouter.ai). Groq at [console.groq.com](https://console.groq.com).

### Social Media Posting

**Cloudinary (image storage)**
```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

**Meta (Facebook/Instagram)**
```env
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_REDIRECT_URI=http://localhost:4000/social/platforms/meta/callback
```

**LinkedIn**
```env
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret
LINKEDIN_REDIRECT_URI=http://localhost:4000/social/platforms/linkedin/callback
```

**YouTube / Google**
```env
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:4000/social/platforms/youtube/callback
```

### Alerts (Optional)

```env
ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/...  # or Telegram webhook URL
CHECK_INTERVAL=86400   # Rank check interval in seconds (86400 = 24 hours)
```

---

## ▶️ Running the App

### Development (with hot reload)

```bash
npm run dev
```

App runs at `http://localhost:4000`

### Production (with PM2)

```bash
# Install PM2 globally
npm install -g pm2

# Start the app
pm2 start ecosystem.config.js --env production

# Save process list for auto-restart on reboot
pm2 save
pm2 startup
```

### NPM Scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `nodemon index.js` | Dev server with hot reload |
| `npm start` | `node index.js` | Production server (no reload) |
| `npm run migrate` | `node src/db/migrate.js` | Run DB migrations |

---

## 🌐 API Routes

All API routes require an active session (login first). Unauthenticated requests are redirected to `/login`.

### Auth

| Method | Route | Description |
|---|---|---|
| `GET` | `/login` | Login/Register page |
| `POST` | `/login` | Authenticate user |
| `POST` | `/register` | Create new user account |
| `POST` | `/logout` | Destroy session |

### Keywords

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/keywords/research` | Full keyword research (SERP + intent + volume + gaps) |
| `POST` | `/api/keywords/save` | Save keyword to database |
| `GET` | `/api/keywords` | List all saved keywords |
| `POST` | `/api/keywords/suggestions` | Get related keyword suggestions |
| `DELETE` | `/api/keywords/:id` | Delete a keyword |

### Rank Tracking

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/tracking/domains` | Get all tracked domains |
| `POST` | `/api/tracking/domains` | Add domain to track |
| `GET` | `/api/tracking/rankings` | Get current rankings for all domains |
| `POST` | `/api/tracking/check` | Manually trigger rank check for a domain |

### Alerts

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/alerts` | Get all alerts |
| `PATCH` | `/api/alerts/:id/read` | Mark alert as read |
| `DELETE` | `/api/alerts/:id` | Delete alert |

### Clients & Projects

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/clients` | List all clients |
| `POST` | `/api/clients` | Create client |
| `PUT` | `/api/clients/:id` | Update client |
| `DELETE` | `/api/clients/:id` | Delete client |
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects/:id/keywords` | Get keywords linked to project |

### Technical SEO

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/technical/audit` | Run full site crawl |
| `POST` | `/api/technical/pagespeed` | Run PageSpeed Insights |
| `GET` | `/api/technical/audits` | List saved audits |

### On-Page SEO

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/onpage/analyze` | Analyze a URL or HTML for on-page issues |
| `POST` | `/api/onpage/ai-fix` | Get AI-generated fix for a specific issue |

### Reports

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/reports/generate` | Generate full agency report |
| `GET` | `/api/reports` | List saved reports |
| `GET` | `/api/reports/:id` | Get report data (JSON) |
| `GET` | `/reports/:id/html` | View report as print-ready HTML |

### Content

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/content/rewrite` | AI content rewriter / humanizer |
| `POST` | `/api/content-briefs/generate` | Generate content brief for a keyword |
| `GET` | `/api/content-briefs` | List saved content briefs |

### Page Optimization

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/page-optimization/analyze` | Compare your page vs competitors |

### SEO Tasks

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/tasks` | List all tasks |
| `POST` | `/api/tasks` | Create task |
| `PATCH` | `/api/tasks/:id` | Update task status/priority |
| `DELETE` | `/api/tasks/:id` | Delete task |

### Social Poster

| Method | Route | Description |
|---|---|---|
| `GET` | `/social/platforms` | Social platforms management page |
| `GET` | `/social/platforms/:platform/connect` | Initiate OAuth for platform |
| `GET` | `/social/platforms/:platform/callback` | OAuth callback |
| `POST` | `/api/social/posts` | Create scheduled post |
| `GET` | `/api/social/posts` | List scheduled posts |
| `POST` | `/api/social/posts/:id/publish` | Publish post immediately |
| `GET` | `/api/social/analytics` | Get engagement analytics |

### System

| Method | Route | Description |
|---|---|---|
| `GET` | `/health` | DB health check |

---

## 🗄️ Database Schema

All tables are auto-created on startup. No manual migration needed for a fresh install.

| Table | Purpose |
|---|---|
| `users` | User accounts (email + bcrypt password) |
| `keywords` | Researched keywords + volume, CPC, difficulty, location |
| `competitors` | SERP domains ranking for each keyword |
| `ranking_pages` | Detailed SERP page results |
| `my_domains` | Your tracked domains |
| `domain_rankings` | Current rank per domain/keyword |
| `rank_history` | Historical rank positions |
| `alerts` | Rank change alerts |
| `seo_clients` | Agency client profiles |
| `seo_projects` | SEO projects under each client |
| `seo_project_keywords` | Keywords linked to projects |
| `technical_audits` | Site crawl results (JSONB) |
| `page_optimizations` | Gap analysis results (JSONB) |
| `content_briefs` | AI content briefs (JSONB) |
| `seo_reports` | Full agency reports (JSONB) |
| `seo_tasks` | SEO task manager |
| `analysis_reports` | Head-to-head comparisons (JSONB) |
| `platform_connections` | Social OAuth tokens per user/platform |
| `posts` | Scheduled social media posts |
| `post_results` | Publish outcomes per platform |
| `analytics_snapshots` | Social engagement snapshots |
| `content_rewrite_history` | AI rewrite history |

---

## ⚙️ Background Workers

Two cron workers start automatically when the server boots.

### 1. Rank Tracker (`src/workers/rankTracker.js`)

- **What it does:** Fetches current SERP positions for all tracked domains across all researched keywords
- **Frequency:** Configurable via `CHECK_INTERVAL` env var (default: every 24 hours)
- **On startup:** Runs an initial check 60 seconds after boot
- **Alerts generated:** Rank drop, rank improvement, new ranking, lost ranking
- **Webhook:** Sends Slack/Discord/Telegram notification on significant drops (if `ALERT_WEBHOOK_URL` is set)
- **Threshold:** Configurable rank drop threshold for triggering alerts

### 2. Post Scheduler (`src/workers/postScheduler.js`)

- **What it does:** Publishes social media posts that are scheduled for the current time
- **Frequency:** Runs every minute to check for due posts
- **Platforms:** Meta (Facebook/Instagram), LinkedIn, YouTube

### 3. Analytics Sync (`src/services/analyticsSync.js`)

- **What it does:** Fetches engagement stats (likes, comments, shares, views, reach) for all published posts
- **Frequency:** Daily at 2 AM
- **⚠️ Note:** Currently returns mock data. Real platform API integration is pending.

---

## 🚢 Deployment

### Server Requirements

- Ubuntu 20.04+ / Debian 11+
- Node.js 18+
- PostgreSQL 14+
- Nginx
- PM2

### Quick Deploy

```bash
# Run the included deploy script
bash deploy.sh
```

### Manual Steps

```bash
# 1. Install dependencies
npm ci --only=production

# 2. Set NODE_ENV in .env
NODE_ENV=production

# 3. Start with PM2
pm2 start ecosystem.config.js --env production
pm2 save

# 4. Configure Nginx
sudo cp nginx.conf /etc/nginx/sites-available/keyword-analyzer
sudo ln -s /etc/nginx/sites-available/keyword-analyzer /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Nginx Configuration

Edit `nginx.conf` and replace `server_name _;` with your domain:

```nginx
server_name keyword.yourdomain.com;
```

The app runs on port **4000** internally. Nginx proxies port 80 → 4000.

> ⚠️ **Port Note:** Make sure `PORT=4000` in `.env`, and `proxy_pass http://localhost:4000;` in `nginx.conf`, and `PORT: 4000` in `ecosystem.config.js` all match.

### SSL (HTTPS)

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d keyword.yourdomain.com
```

---

## 🐛 Known Issues

| Issue | Impact | Fix |
|---|---|---|
| `SERPER_API_KEY` returning `Unauthorized` | All keyword research and rank tracking fails | Replace key at [serper.dev](https://serper.dev) |
| Port mismatch between `.env` (4000), `nginx.conf` (3000), `ecosystem.config.js` (3000) | Production Nginx may not proxy correctly | Set all three to the same port |
| Social analytics returns mock/random data | Engagement numbers are not real | Real platform API integration is planned |
| `content_history` table missing from schema | Silent error in report generation | Table will be added in next schema update |
| No rate limiting on API routes | Vulnerable to abuse if exposed publicly | Add `@fastify/rate-limit` |
| CORS set to `origin: true` | Allows requests from any domain | Restrict to your domain in production |

---

## 🗺️ Roadmap

- [ ] Google Search Console integration (impressions, clicks, CTR, index coverage)
- [ ] Real social platform analytics (Meta Insights API, LinkedIn Analytics API)
- [ ] Rate limiting on all API routes
- [ ] Two-factor authentication
- [ ] Multi-user roles (Admin, Client view-only)
- [ ] Export reports to PDF (server-side)
- [ ] Slack/Telegram alert notifications (currently webhook-only)
- [ ] Redis caching for frequent SERP queries

---

## 📄 License

ISC — See [LICENSE](LICENSE) for details.

---

*Built by Spidy092 · v1.0.0*
