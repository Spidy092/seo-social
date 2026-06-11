# GSC + GA4 Service Account Integration Plan

## Purpose

This document explains how to extend Keyword Analyzer into a stronger SEO performance and client reporting platform by combining:

- Google Search Console data for search visibility.
- Google Analytics 4 data for on-site behavior and conversions.
- Page URL matching as the bridge between both systems.

The project should use **Google service account authentication only**. Do not build OAuth for GSC or GA4.

## Current Project State

The project already has a strong SEO agency foundation:

- Keyword research and SERP analysis.
- Competitor discovery.
- Rank tracking and rank alerts.
- On-page analysis.
- Technical SEO audits.
- PageSpeed checks.
- Client and project management.
- Agency reports.
- SEO tasks.
- Real GSC integration through `src/services/gscService.js`.
- GSC API routes through `src/routes/gsc.js`.
- Daily GSC worker through `src/workers/gscSync.js`.
- GSC data stored in `gsc_search_analytics`.
- GSC sync logs stored in `gsc_sync_runs`.

The missing piece is real GA4 website analytics. The existing `src/services/analyticsSync.js` is for social post analytics and currently uses mock data, so it should not be reused as GA4 website analytics.

## Strategic Goal

The main goal is to move the product from:

> Keyword analyzer and rank tracker

to:

> SEO performance intelligence platform for agencies.

The most valuable workflow should become:

```text
Keyword -> Ranking Page -> GSC Clicks -> GA4 Sessions -> Engagement -> Conversions -> Recommended Action
```

Example:

```text
Keyword: web design bangalore
GSC page: /services/web-design
GSC: 200 clicks, 8,000 impressions, position 7.2
GA4: 180 organic sessions, 68% bounce rate, 0 conversions
Insight: Ranking and clicks are working, but the landing page is not converting.
Action: Improve landing page intro, offer, CTA, trust signals, and internal links.
```

## Why Service Account Only

Service account authentication is the best fit for this project because this is an agency dashboard with scheduled background syncs.

Benefits:

- No OAuth popup.
- No user token refresh issues.
- No per-user consent flow.
- Easier daily background workers.
- Matches the existing GSC integration pattern.
- Better for agencies managing many client properties.
- Clients only need to add the service account email to GSC and GA4.

Recommended authentication model:

- One Google Cloud service account.
- Same service account can be used for GSC and GA4 if it has access to both.
- Store the service account JSON in `.env`.

Recommended environment variable:

```env
GOOGLE_SERVICE_ACCOUNT_JSON={...}
```

Backward-compatible fallback:

```env
GSC_SERVICE_ACCOUNT_JSON={...}
GA4_SERVICE_ACCOUNT_JSON={...}
```

Implementation rule:

```text
Use GOOGLE_SERVICE_ACCOUNT_JSON first.
Fallback to GSC_SERVICE_ACCOUNT_JSON for GSC.
Fallback to GA4_SERVICE_ACCOUNT_JSON for GA4.
```

## Data Sources

## Google Search Console Data

GSC tells us how the website performs in Google Search before and during the click.

Useful GSC metrics:

| Data | Meaning |
|---|---|
| Clicks | How many times users clicked the site from Google Search |
| Impressions | How many times the site appeared in search |
| CTR | Click-through rate from search results |
| Average Position | Average ranking position |
| Queries | Keywords/search terms bringing visibility and clicks |
| Pages | Pages receiving search traffic |
| Devices | Desktop, mobile, tablet search breakdown |
| Countries | Country-level search performance |
| Search Type | Web, image, video, news |
| Sitemaps | Submitted sitemap status |
| Index Coverage | Indexed pages and errors |
| Core Web Vitals | Basic page experience metrics |

Most useful GSC dimensions for this project:

- `query`
- `page`
- `query,page`
- `device`
- `country`
- `date`

## Google Analytics 4 Data

GA4 tells us what users do after they land on the website.

Useful GA4 metrics:

| Data | Meaning |
|---|---|
| Sessions | Total visits |
| Users | Unique visitors |
| New Users | First-time visitors |
| Views | Page views |
| Bounce Rate | Percent of unengaged sessions |
| Engagement Rate | Percent of engaged sessions |
| Avg Session Duration | How long users stay |
| Pages per Session | Depth of visit |
| Traffic Source | Organic, direct, referral, social, paid |
| Top Pages | Most visited pages |
| Events | Button clicks, form submits, video plays |
| Conversions | Completed business goals |
| Devices | Mobile, desktop, tablet |
| Countries / Cities | User locations |
| Real-time Users | Current active users |
| Revenue | Ecommerce revenue if configured |

Most useful GA4 dimensions for this project:

- `landingPagePlusQueryString`
- `pagePath`
- `pageLocation`
- `sessionDefaultChannelGroup`
- `sessionSourceMedium`
- `deviceCategory`
- `country`
- `city`
- `date`

Most useful GA4 metrics:

- `sessions`
- `totalUsers`
- `newUsers`
- `screenPageViews`
- `bounceRate`
- `engagementRate`
- `averageSessionDuration`
- `conversions`
- `eventCount`
- `totalRevenue`

## What Can Be Combined

The shared bridge between GSC and GA4 is the page URL.

| GSC Data | GA4 Data | Combined Insight |
|---|---|---|
| Keyword -> Page | Page -> Sessions | Which keywords drive visits to which landing pages |
| Page -> Clicks | Page -> Bounce Rate | High clicks but poor landing page experience |
| Page -> Position | Page -> Conversions | Ranking page is converting or not |
| Page -> Impressions | Page -> Avg Duration | People see the page in search, then do they read it? |
| Device breakdown | Device breakdown | Search device vs website behavior by device |
| Country breakdown | Country breakdown | Search country vs website audience behavior |

Best combined example:

```text
GSC keyword -> landing page
GA4 landing page -> sessions, bounce rate, conversions
Insight -> keyword brings traffic, page fails or succeeds after click
```

## What Should Not Be Combined

Some data does not have a meaningful common key and should stay as separate report sections.

GSC-only:

| GSC Data | Why It Should Not Be Combined With GA4 |
|---|---|
| Index Coverage | GA4 has no concept of indexing |
| Sitemaps | GA4 does not know about submitted sitemaps |
| Search Type | GA4 does not know if the click came from web/image/video/news search in the same way |
| Core Web Vitals | Different data source and measurement model |

GA4-only:

| GA4 Data | Why It Should Not Be Combined With GSC |
|---|---|
| Real-time Users | GSC has no real-time data |
| Events | GSC does not track on-site behavior |
| Revenue | GSC does not know purchases |
| Traffic Source | GSC only covers Google organic search |
| New vs Returning | GSC does not track individual users |

## Recommended Architecture

Add GA4 as a parallel integration beside GSC.

New files:

```text
src/services/ga4Service.js
src/routes/ga4.js
src/workers/ga4Sync.js
src/services/seoPerformanceService.js
src/utils/urlNormalize.js
```

Existing files to extend:

```text
src/services/gscService.js
src/routes/gsc.js
src/workers/gscSync.js
src/routes/projectDashboard.js
src/services/reportService.js
src/routes/alerts.js
src/services/taskService.js
src/db/index.js
index.js
public/js/app.js
views/index.ejs
```

## Database Plan

## Extend `seo_clients`

Add GA4 connection fields:

```sql
ALTER TABLE seo_clients
ADD COLUMN IF NOT EXISTS ga4_property_id TEXT,
ADD COLUMN IF NOT EXISTS ga4_property_name TEXT,
ADD COLUMN IF NOT EXISTS ga4_connected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ga4_last_synced_at TIMESTAMPTZ;
```

Existing `gsc_site_url` should remain.

## Create `ga4_page_analytics`

Stores landing page analytics by client and sync window.

```sql
CREATE TABLE IF NOT EXISTS ga4_page_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
    client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
    property_id TEXT NOT NULL,
    date_start DATE NOT NULL,
    date_end DATE NOT NULL,
    page_path TEXT,
    page_url TEXT,
    normalized_url TEXT,
    landing_page TEXT,
    source_medium TEXT,
    channel_group TEXT,
    device_category TEXT,
    country TEXT,
    city TEXT,
    sessions INTEGER DEFAULT 0,
    users INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    bounce_rate NUMERIC DEFAULT 0,
    engagement_rate NUMERIC DEFAULT 0,
    avg_session_duration NUMERIC DEFAULT 0,
    conversions NUMERIC DEFAULT 0,
    event_count INTEGER DEFAULT 0,
    revenue NUMERIC DEFAULT 0,
    raw JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Recommended indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_client ON ga4_page_analytics(client_id);
CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_window ON ga4_page_analytics(client_id, date_start, date_end);
CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_url ON ga4_page_analytics(client_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_ga4_page_analytics_source ON ga4_page_analytics(client_id, source_medium, channel_group);
```

## Create `ga4_sync_runs`

Stores sync status and errors.

```sql
CREATE TABLE IF NOT EXISTS ga4_sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
    client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
    property_id TEXT,
    sync_type TEXT DEFAULT 'manual',
    status TEXT NOT NULL,
    rows_synced INTEGER DEFAULT 0,
    date_start DATE,
    date_end DATE,
    error_message TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Recommended indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_ga4_sync_runs_client ON ga4_sync_runs(client_id);
CREATE INDEX IF NOT EXISTS idx_ga4_sync_runs_created ON ga4_sync_runs(created_at DESC);
```

## Extend GSC Storage

The current GSC service fetches separate `query`, `page`, `device`, and `country` rows. Add a combined dimension:

```text
query_page -> dimensions ['query', 'page']
```

Store it in `gsc_search_analytics` using:

```text
dimension_type = 'query_page'
query = keys[0]
page = keys[1]
```

This is essential for keyword-to-page-to-GA4 reporting.

Also add a normalized URL column if possible:

```sql
ALTER TABLE gsc_search_analytics
ADD COLUMN IF NOT EXISTS normalized_url TEXT;
```

Then populate it for page and query_page rows.

## URL Normalization

URL normalization is the most important technical requirement because GSC and GA4 represent URLs differently.

GSC example:

```text
https://example.com/services/web-design/
```

GA4 example:

```text
/services/web-design
```

Both must normalize to the same key:

```text
example.com/services/web-design
```

Create:

```text
src/utils/urlNormalize.js
```

Recommended exports:

```js
normalizeDomain(value)
normalizePath(value)
normalizeUrl(value, baseUrl)
buildAbsoluteUrl(pathOrUrl, baseUrl)
```

Rules:

- Lowercase hostname.
- Remove `www.`.
- Remove trailing slash except root.
- Remove hash fragments.
- Remove common tracking query parameters.
- Optionally remove all query parameters by default.
- Decode safe URL characters.
- Treat `http` and `https` as the same for matching.
- Store normalized URL without protocol.

Example:

```text
https://www.Example.com/services/web-design/?utm_source=google
-> example.com/services/web-design
```

## GA4 Service Plan

Create `src/services/ga4Service.js`.

Responsibilities:

- Read service account JSON from env.
- Create Google Analytics Data API client.
- Run GA4 reports.
- Sync page analytics into PostgreSQL.
- Provide route helper queries.
- Build summaries for dashboards and reports.

Use package:

```text
@google-analytics/data
```

Authentication:

```text
GoogleAuth with analytics.readonly scope
```

Required scope:

```text
https://www.googleapis.com/auth/analytics.readonly
```

Core service functions:

```js
getAuthClient()
runReport({ propertyId, startDate, endDate, dimensions, metrics, limit })
syncGa4Performance(db, { clientId, userId, agencyId, propertyId, baseUrl, days })
getOverview(db, clientId)
getTopPages(db, clientId, limit)
getLandingPageMetrics(db, clientId, limit)
getDeviceBreakdown(db, clientId)
getCountryBreakdown(db, clientId)
getSourceBreakdown(db, clientId)
```

Recommended sync windows:

- Default: last 30 days.
- End date: yesterday.
- Start date: `days - 1` before end date.

GA4 can have fresher data than GSC, but combined reports should align to a common date window.

## GA4 Routes Plan

Create `src/routes/ga4.js`.

Routes:

```http
GET /api/ga4/clients
GET /api/ga4/sync-log
POST /api/ga4/connect
DELETE /api/ga4/disconnect/:clientId
POST /api/ga4/sync/:clientId
POST /api/ga4/sync-all
GET /api/ga4/overview/:clientId
GET /api/ga4/top-pages/:clientId
GET /api/ga4/devices/:clientId
GET /api/ga4/countries/:clientId
GET /api/ga4/sources/:clientId
```

Connect body:

```json
{
  "clientId": "uuid",
  "propertyId": "123456789",
  "propertyName": "Client GA4 Property"
}
```

All routes should:

- Require authentication.
- Use `getAgencyContext`.
- Verify the client belongs to the agency.
- Record sync runs for success and failure.

## GA4 Worker Plan

Create `src/workers/ga4Sync.js`.

Schedule:

```text
Daily at 5:00 AM server time
```

Reason:

- Rank tracker runs earlier.
- GSC worker currently runs at 4:00 AM.
- GA4 can run after GSC to avoid overlap.

Worker behavior:

- Skip if no service account env exists.
- Fetch clients with `ga4_property_id`.
- Sync each client.
- Delay between clients to reduce API pressure.
- Record sync result in `ga4_sync_runs`.
- Update `seo_clients.ga4_last_synced_at`.

## Combined SEO Performance Service

Create `src/services/seoPerformanceService.js`.

Purpose:

Join GSC and GA4 data by normalized page URL and produce actionable insights.

Main functions:

```js
getPagePerformance(db, clientId, options)
getKeywordPagePerformance(db, clientId, options)
getDevicePerformance(db, clientId, options)
getCountryPerformance(db, clientId, options)
getSeoOpportunities(db, clientId, options)
buildInsight(row)
buildRecommendedAction(insight)
```

Core join:

```text
gsc_search_analytics.normalized_url = ga4_page_analytics.normalized_url
```

Recommended combined output:

```json
{
  "page": "https://example.com/services/web-design",
  "normalizedUrl": "example.com/services/web-design",
  "clicks": 200,
  "impressions": 8000,
  "ctrPct": 2.5,
  "avgPosition": 7.2,
  "sessions": 180,
  "users": 150,
  "bounceRate": 68.2,
  "avgSessionDuration": 41.5,
  "conversions": 0,
  "insightType": "high_clicks_high_bounce",
  "priority": "high",
  "recommendedAction": "Improve landing page intro, CTA, trust signals, and internal links."
}
```

## Insight Rules

## High Clicks + High Bounce

Condition:

```text
clicks >= 100
bounce_rate >= 65
```

Insight:

```text
Search traffic is working, but landing page engagement is weak.
```

Action:

```text
Improve above-the-fold content, match search intent, add stronger CTA, improve page speed, add trust elements.
```

## High Impressions + Low CTR

Condition:

```text
impressions >= 1000
ctr < 0.02
avg_position <= 20
```

Insight:

```text
Page is visible in search but not earning enough clicks.
```

Action:

```text
Rewrite title tag and meta description, add stronger value proposition, test rich result/schema opportunities.
```

## Page Two Opportunity

Condition:

```text
avg_position between 8 and 20
impressions >= 300
```

Insight:

```text
Keyword/page is close to page-one or top-five growth.
```

Action:

```text
Refresh content, add internal links, improve topical depth, build authority links.
```

## Ranking But Not Converting

Condition:

```text
clicks >= 50
sessions >= 50
conversions = 0
```

Insight:

```text
SEO is bringing users, but the page is not producing business outcomes.
```

Action:

```text
Add conversion block, contact form, sticky CTA, offer section, proof, FAQs, and lead magnet.
```

## Good SEO Performer

Condition:

```text
clicks >= 50
bounce_rate < 50
conversions > 0
```

Insight:

```text
This page is both ranking and converting.
```

Action:

```text
Protect rankings, add internal links from weaker pages, use as model for other landing pages.
```

## Mobile Problem

Condition:

```text
mobile_bounce_rate - desktop_bounce_rate >= 20
```

Insight:

```text
Mobile search users behave worse than desktop users.
```

Action:

```text
Review mobile UX, speed, CTA visibility, layout, forms, and Core Web Vitals.
```

## Country Mismatch

Condition:

```text
GSC target country has high impressions/clicks,
but GA4 engagement/conversions from that country are weak.
```

Insight:

```text
Search demand exists in the target country, but landing page relevance or offer may be weak.
```

Action:

```text
Localize content, pricing, proof, examples, phone number, testimonials, and service areas.
```

## Dashboard Plan

Add a new navigation item:

```text
SEO Performance
```

Suggested dashboard sections:

- Organic search overview.
- GA4 organic traffic overview.
- Combined page performance.
- Keyword-to-page journey.
- Landing page problems.
- Conversion opportunities.
- CTR opportunities.
- Device mismatch.
- Country mismatch.
- Recommended actions.

Cards:

```text
Organic Clicks
Organic Sessions
SEO Conversions
Average CTR
Average Position
High-Impact Issues
Pages Needing Conversion Fixes
Pages With CTR Opportunities
```

Tables:

```text
Top SEO Pages
Keyword -> Page -> Behavior
High Clicks, High Bounce
High Impressions, Low CTR
Ranking Pages With Zero Conversions
Best Converting SEO Pages
Device Comparison
Country Comparison
```

## Project Dashboard Enhancements

Extend `src/routes/projectDashboard.js` to include combined metrics for the project client.

Add:

- Organic sessions.
- SEO conversions.
- Best converting SEO pages.
- Pages with high clicks and high bounce.
- Pages with high impressions and low CTR.
- Target keywords mapped to GSC query-page rows.
- Recommended actions from combined insights.

This makes the project dashboard more business-focused, not only rank-focused.

## Reports Plan

Extend `src/services/reportService.js`.

New report sections:

- Search visibility summary.
- Website behavior summary.
- Keyword-to-page performance.
- Landing page conversion issues.
- Best SEO pages.
- Worst SEO pages.
- CTR opportunities.
- Page-two growth opportunities.
- Device and country insights.
- Recommended next actions.
- AI-generated executive summary.

Client-friendly report example:

```text
"The keyword 'web design bangalore' generated 200 clicks to /services/web-design.
The page received 180 sessions but had a 68% bounce rate and no conversions.
This suggests the ranking is valuable, but the landing page needs stronger offer clarity and conversion elements."
```

## Alerts Plan

Extend the alerts system to generate performance alerts.

New alert types:

```text
high_clicks_high_bounce
high_impressions_low_ctr
ranking_no_conversions
organic_sessions_drop
seo_conversions_drop
mobile_engagement_problem
country_engagement_problem
page_two_opportunity
```

Examples:

```text
High clicks but high bounce on /services/web-design.
Page has 8,000 impressions but CTR is only 1.2%.
Keyword/page is ranking at position 11.4 and has conversion potential.
Organic sessions dropped by 35% compared to previous period.
```

## Task Automation Plan

Use combined insights to create SEO tasks automatically or semi-automatically.

Task examples:

| Insight | Task |
|---|---|
| High impressions, low CTR | Rewrite title and meta description |
| High clicks, high bounce | Improve landing page intent match and CTA |
| Ranking but no conversions | Add conversion block/form |
| Page two opportunity | Add internal links and refresh content |
| Mobile problem | Audit mobile UX and speed |
| Country mismatch | Localize landing page |

Task fields:

- Client.
- Project.
- Page URL.
- Keyword.
- Priority.
- Category.
- Recommended action.
- Source insight.

## API Plan For Combined Insights

Create routes in a new file:

```text
src/routes/seoPerformance.js
```

Routes:

```http
GET /api/seo-performance/overview/:clientId
GET /api/seo-performance/pages/:clientId
GET /api/seo-performance/keyword-pages/:clientId
GET /api/seo-performance/opportunities/:clientId
GET /api/seo-performance/devices/:clientId
GET /api/seo-performance/countries/:clientId
POST /api/seo-performance/create-tasks/:clientId
```

Optional query params:

```text
days=30
limit=50
minClicks=50
minImpressions=500
priority=high
```

## Frontend Plan

Existing frontend is mainly in:

```text
views/index.ejs
public/js/app.js
public/js/project-dashboard.js
public/js/reports.js
```

Recommended frontend additions:

```text
public/js/seo-performance.js
public/css/seo-performance.css
```

UI components:

- Client selector.
- Date range selector.
- Sync buttons for GSC and GA4.
- KPI cards.
- Insight filters.
- Combined performance table.
- Keyword-page table.
- Device/country comparison tabs.
- Create task buttons.

Keep the UI dense and agency-focused. This is an operational dashboard, not a marketing landing page.

## Implementation Phases

## Phase 1: Shared Google Service Account Auth

Goal:

Make GSC and GA4 use a consistent service account strategy.

Tasks:

- Add helper for reading Google service account JSON.
- Support `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Keep backward compatibility with `GSC_SERVICE_ACCOUNT_JSON`.
- Add future support for `GA4_SERVICE_ACCOUNT_JSON`.
- Do not add OAuth.

Files:

```text
src/services/gscService.js
src/services/ga4Service.js
```

## Phase 2: URL Normalization

Goal:

Make GSC and GA4 URLs join reliably.

Tasks:

- Create `src/utils/urlNormalize.js`.
- Add tests or simple validation cases.
- Normalize GSC page URLs during sync.
- Normalize GA4 page URLs during sync.

Files:

```text
src/utils/urlNormalize.js
src/services/gscService.js
src/services/ga4Service.js
```

## Phase 3: GSC Query-Page Sync

Goal:

Enable keyword-to-page reporting.

Tasks:

- Add `query_page` dimension sync in `gscService.js`.
- Store query and page together.
- Store normalized URL.
- Update GSC summaries where useful.

Files:

```text
src/services/gscService.js
src/routes/gsc.js
src/workers/gscSync.js
```

## Phase 4: GA4 Service, Tables, And Routes

Goal:

Sync real GA4 landing page analytics by service account.

Tasks:

- Add GA4 database schema.
- Add `ga4Service.js`.
- Add `ga4.js` routes.
- Add manual connect/disconnect.
- Add manual sync and sync-all.
- Add GA4 overview/top-pages endpoints.

Files:

```text
src/db/index.js
src/services/ga4Service.js
src/routes/ga4.js
index.js
```

## Phase 5: GA4 Daily Worker

Goal:

Automate daily GA4 sync.

Tasks:

- Add `src/workers/ga4Sync.js`.
- Schedule daily at 5 AM.
- Sync all clients with `ga4_property_id`.
- Record sync runs.
- Update `ga4_last_synced_at`.

Files:

```text
src/workers/ga4Sync.js
index.js
```

## Phase 6: Combined SEO Performance Service

Goal:

Generate insights from joined GSC and GA4 data.

Tasks:

- Create `seoPerformanceService.js`.
- Join by normalized URL.
- Build page-level insights.
- Build keyword-page insights.
- Build opportunity scoring.

Files:

```text
src/services/seoPerformanceService.js
src/routes/seoPerformance.js
```

## Phase 7: Dashboard UI

Goal:

Add user-facing SEO performance dashboards.

Tasks:

- Add navigation item.
- Add client selector.
- Add KPI cards.
- Add combined tables.
- Add filters.
- Add task creation actions.

Files:

```text
views/index.ejs
public/js/app.js
public/js/seo-performance.js
public/css/seo-performance.css
```

## Phase 8: Reports

Goal:

Make client reports show business impact.

Tasks:

- Include GA4 data in `gatherReportData`.
- Include combined page insights.
- Add report sections.
- Add AI summary using combined insights.

Files:

```text
src/services/reportService.js
views/report.ejs
public/js/reports.js
```

## Phase 9: Alerts And Tasks

Goal:

Make the product proactive.

Tasks:

- Add performance alert rules.
- Add task templates for insight types.
- Allow one-click task creation from insights.
- Optional: generate tasks automatically after sync.

Files:

```text
src/routes/alerts.js
src/services/taskService.js
src/services/seoPerformanceService.js
src/routes/tasks.js
```

## Phase 10: Polish And Validation

Goal:

Make the integration reliable for agency use.

Tasks:

- Add empty states when GA4/GSC is not connected.
- Add clear permission error messages.
- Add sync log UI.
- Add API error handling.
- Validate URL matching accuracy.
- Validate report numbers against GA4/GSC UI.

## Permission Setup For Clients

## GSC Permission

Client steps:

1. Open Google Search Console.
2. Select the website property.
3. Go to Settings.
4. Open Users and permissions.
5. Add the service account email.
6. Give Restricted permission.

## GA4 Permission

Client steps:

1. Open Google Analytics.
2. Select the GA4 property.
3. Go to Admin.
4. Open Property access management.
5. Add the service account email.
6. Give Viewer role.
7. Copy the GA4 property ID into Keyword Analyzer.

GA4 property ID format:

```text
123456789
```

It is not the measurement ID. Do not use values like:

```text
G-XXXXXXXXXX
```

## Pros

- Connects SEO activity to business outcomes.
- Makes reports more valuable to clients.
- Prioritizes work by impact, not only rank.
- Shows which keywords/pages produce engaged users and conversions.
- Helps agencies explain SEO clearly.
- Builds on existing GSC, report, project, and task modules.
- Makes the platform more differentiated than a basic rank tracker.

## Cons And Risks

- GA4 setup can be confusing for clients.
- URL matching can be messy without strong normalization.
- GA4 conversion data depends on correct client tracking setup.
- GSC data has a 2-3 day delay.
- GA4 and GSC numbers will not match exactly.
- Keyword-to-session attribution is inferred through landing page, not direct keyword tracking.
- Low-volume data may be limited or thresholded.
- More synced data means more storage and query optimization work.

## Important Data Interpretation Notes

GSC clicks and GA4 sessions will not be identical.

Reasons:

- GSC counts Google Search clicks.
- GA4 counts website sessions.
- Users may block analytics.
- Pages may load without GA4 firing.
- GSC and GA4 use different time zones and attribution models.
- GSC data is delayed.
- GA4 may apply privacy thresholds.

Reports should say:

```text
GSC and GA4 are directional comparison sources. They should be used to identify patterns and opportunities, not expected to match one-to-one.
```

## Success Metrics

The integration is successful when the app can answer:

- Which keywords bring traffic to which pages?
- Which SEO pages get traffic but fail to engage users?
- Which SEO pages convert?
- Which ranking opportunities are closest to business impact?
- Which pages need title/meta improvements?
- Which pages need landing page conversion improvements?
- Which countries/devices are underperforming?
- What should the agency do next for each client?

## Final Product Outcome

After this plan is implemented, Keyword Analyzer should be positioned as:

```text
An agency SEO intelligence platform that connects rankings, search visibility, user behavior, conversions, and action plans.
```

The strongest product feature should be:

```text
Keyword Performance Journey:
Keyword -> Page -> Clicks -> Sessions -> Engagement -> Conversions -> Action
```

