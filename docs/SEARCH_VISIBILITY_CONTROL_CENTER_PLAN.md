# Search Visibility Control Center Plan

## Purpose

This document explains how to turn Keyword Analyzer into the place where an agency can connect Google data, inspect search visibility problems, submit discovery signals, and convert findings into SEO actions without leaving the product.

The current GSC + GA4 integration is the performance intelligence layer:

```text
Keyword -> Page -> Clicks -> Sessions -> Engagement -> Conversions -> Action
```

The next layer should be the operational control center:

```text
Connect Google -> Sync GSC/GA4 -> Inspect URL -> Submit sitemap/IndexNow -> Monitor search and behavior data -> Create task
```

Important product rule:

```text
Do not sell this as instant Google indexing for normal blog pages.
```

Google's Indexing API is only appropriate for eligible pages containing `JobPosting` structured data or `BroadcastEvent` embedded in `VideoObject`. Normal blog, service, portfolio, and landing pages should use URL Inspection, sitemap submission, technical fixes, internal linking, IndexNow for participating search engines, and GSC monitoring.

## Research Sources

Use these official or primary sources when implementing and explaining the feature:

| Area | Source |
|---|---|
| Google Indexing API | https://developers.google.com/search/apis/indexing-api/v3/using-api |
| URL Inspection API | https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect |
| GSC Sitemap Submit API | https://developers.google.com/webmaster-tools/v1/sitemaps/submit |
| Ask Google to recrawl | https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl |
| Google sitemaps guide | https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview |
| GA4 Data API | https://developers.google.com/analytics/devguides/reporting/data/v1 |
| IndexNow protocol | https://www.indexnow.org/documentation |

## Product Vision

The product should move from generic analytics display to an agency workflow that helps users act.

Current generic workflow:

```text
Open GSC -> check performance
Open GA4 -> check sessions and conversions
Open Search Console -> inspect URLs
Open sitemap report -> submit sitemap
Open another tool -> create SEO task
```

Target workflow inside Keyword Analyzer:

```text
Select client
Check GSC and GA4 connection health
Sync search and analytics data
Inspect a blog or landing page URL
See indexability/canonical/robots problems
Submit sitemap or IndexNow notification where appropriate
Create a task from the issue
Track later performance in GSC + GA4
```

This makes Keyword Analyzer more than a reporting tool. It becomes the SEO operations workspace for agencies.

## What We Already Implemented

The project already has the foundation for this control center:

- Service-account-only Google authentication.
- `GOOGLE_SERVICE_ACCOUNT_JSON` as the preferred shared credential.
- Backward-compatible `GSC_SERVICE_ACCOUNT_JSON` and `GA4_SERVICE_ACCOUNT_JSON`.
- Real GSC integration through `src/services/gscService.js`.
- GSC routes through `src/routes/gsc.js`.
- Daily GSC worker through `src/workers/gscSync.js`.
- GSC query, page, device, country, and `query_page` sync.
- Normalized URL storage for joining GSC and GA4.
- Real GA4 integration through `src/services/ga4Service.js`.
- GA4 routes through `src/routes/ga4.js`.
- Daily GA4 worker through `src/workers/ga4Sync.js`.
- Combined SEO performance service through `src/services/seoPerformanceService.js`.
- SEO performance routes through `src/routes/seoPerformance.js`.
- SEO Performance dashboard UI through `public/js/seo-performance.js`.
- Combined insights in reports.
- Task and alert generation from GSC + GA4 performance issues.
- Agency scoping and resource ownership checks across sensitive routes.

The missing piece is not more generic metrics. The missing piece is an operational surface where users can connect, inspect, submit, monitor, and act.

## Problem With Generic GSC And GA4

GSC and GA4 data is valuable, but generic dashboards create three problems:

1. Users still need to leave the app to take action.
2. Clients care about business outcomes, not raw clicks and sessions.
3. Agencies need one workflow that connects problem discovery to task execution.

Bad generic output:

```text
Page has 200 clicks and 68% bounce rate.
```

Better agency output:

```text
/services/web-design receives 200 Google clicks but has 68% bounce rate and 0 conversions.
The page is indexed and visible, so the main issue is landing page intent and conversion quality.
Create a task to improve above-the-fold content, CTA, proof, and internal links.
```

Best operational output:

```text
This new blog URL is not indexed.
Google selected a different canonical and the page is missing from the sitemap.
Submit the sitemap, add internal links, fix canonical, then inspect again after Google recrawls.
```

## Search Visibility Control Center

Add a new app area named:

```text
Search Visibility
```

Recommended navigation label:

```text
Search Visibility
```

Recommended page title:

```text
Search Visibility Control Center
```

This page should be dense, operational, and agency-focused. It should not feel like a marketing page.

Core sections:

| Section | Purpose |
|---|---|
| Client selector | Choose the client/project context |
| Connection status | Show GSC, GA4, sitemap, and IndexNow readiness |
| Google sync controls | Manual GSC and GA4 sync buttons |
| URL Inspection | Inspect a URL through Search Console URL Inspection API |
| Sitemap tools | List submitted sitemaps and submit a sitemap URL |
| IndexNow tools | Submit normal blog/service URLs to participating search engines |
| Google Indexing API tools | Strictly guarded for eligible job/livestream pages only |
| Recent actions | Show inspection, sitemap, IndexNow, and indexing attempts |
| Recommended fixes | Convert findings into tasks |

## Accurate Indexing Strategy

## Normal Blog And Service Pages

For normal website pages, use this flow:

```text
Inspect URL
Check indexed status
Check Google-selected canonical
Check user-declared canonical
Check robots/noindex issues
Check page fetch status
Check sitemap presence
Submit sitemap if needed
Submit URL to IndexNow if configured
Create technical/content task if blockers exist
Monitor later in GSC
```

Do not use Google Indexing API for normal blog pages.

Safe UI labels:

- Inspect URL
- Submit Sitemap
- Request Discovery
- Notify IndexNow
- Monitor in GSC
- Create SEO Task

Unsafe UI labels:

- Instant Google Index
- Force Index Blog
- Guaranteed Indexing
- Google Index Any URL

## Eligible Google Indexing API Pages

Only expose Google Indexing API submit actions when the user explicitly selects one of these page types:

```text
job_posting
broadcast_event_video
```

Allowed notification types:

```text
URL_UPDATED
URL_DELETED
```

Required guard:

```text
If pageType is not job_posting or broadcast_event_video, block the request.
```

Recommended error:

```text
Google Indexing API is only available for eligible JobPosting pages or livestream BroadcastEvent pages. For normal pages, use URL Inspection, sitemap submission, IndexNow, and GSC monitoring.
```

## API Architecture

Create a new route module:

```text
src/routes/searchVisibility.js
```

Register it in:

```text
index.js
```

All routes must:

- Require authentication.
- Use `getAgencyContext`.
- Verify `clientId` belongs to the active agency.
- Reject URLs outside the client website or connected GSC property.
- Store important user actions in `indexing_actions`.
- Return clear setup and permission errors.

Recommended endpoints:

```http
GET /api/search-visibility/status/:clientId
POST /api/search-visibility/inspect
GET /api/search-visibility/sitemaps/:clientId
POST /api/search-visibility/sitemaps/submit
POST /api/search-visibility/indexnow/submit
POST /api/search-visibility/google-indexing/notify
GET /api/search-visibility/actions/:clientId
```

## Endpoint Details

## `GET /api/search-visibility/status/:clientId`

Purpose:

Return connection readiness for a client.

Response shape:

```json
{
  "ok": true,
  "client": {
    "id": "uuid",
    "name": "Client Name",
    "websiteUrl": "https://example.com",
    "gscSiteUrl": "https://example.com/",
    "ga4PropertyId": "123456789"
  },
  "status": {
    "gscConnected": true,
    "ga4Connected": true,
    "googleServiceAccountConfigured": true,
    "indexNowConfigured": false,
    "lastGscSyncAt": "2026-06-12T00:00:00.000Z",
    "lastGa4SyncAt": "2026-06-12T00:00:00.000Z"
  },
  "nextActions": [
    "Add IndexNow key to enable non-Google URL discovery notifications"
  ]
}
```

## `POST /api/search-visibility/inspect`

Purpose:

Inspect a URL through Search Console URL Inspection API.

Request:

```json
{
  "clientId": "uuid",
  "inspectionUrl": "https://example.com/blog/new-post",
  "languageCode": "en-US"
}
```

Rules:

- `inspectionUrl` must be fully qualified.
- URL must belong to the client domain or connected GSC property.
- `siteUrl` should come from `seo_clients.gsc_site_url`.
- Use Search Console scope `https://www.googleapis.com/auth/webmasters.readonly`.

Store action:

```text
provider = google_search_console
action_type = url_inspection
status = success or failed
```

## `GET /api/search-visibility/sitemaps/:clientId`

Purpose:

List submitted sitemaps from GSC.

Rules:

- Requires connected `gsc_site_url`.
- Use existing GSC service account auth.
- Return raw GSC sitemap status plus a simplified summary.

## `POST /api/search-visibility/sitemaps/submit`

Purpose:

Submit a sitemap URL to Google Search Console.

Request:

```json
{
  "clientId": "uuid",
  "sitemapUrl": "https://example.com/sitemap.xml"
}
```

Rules:

- Requires Search Console write scope `https://www.googleapis.com/auth/webmasters`.
- Sitemap URL must be on the same client domain unless the GSC property allows it.
- Successful Google response may have an empty body.
- Store action as `sitemap_submit`.

Important wording:

```text
Sitemap submission helps Google discover URLs. It does not guarantee crawling or indexing.
```

## `POST /api/search-visibility/indexnow/submit`

Purpose:

Submit changed URLs to participating IndexNow search engines.

Request:

```json
{
  "clientId": "uuid",
  "urls": [
    "https://example.com/blog/new-post"
  ]
}
```

Rules:

- URLs must belong to the same host.
- Max 10,000 URLs per request.
- Client must have an IndexNow key configured.
- Key should be hosted at the root when possible:

```text
https://example.com/{key}.txt
```

Store action:

```text
provider = indexnow
action_type = indexnow_submit
```

Important wording:

```text
IndexNow notifies participating search engines. It is not a Google indexing request.
```

## `POST /api/search-visibility/google-indexing/notify`

Purpose:

Notify Google Indexing API for eligible URLs only.

Request:

```json
{
  "clientId": "uuid",
  "url": "https://example.com/careers/developer",
  "type": "URL_UPDATED",
  "pageType": "job_posting"
}
```

Rules:

- `type` must be `URL_UPDATED` or `URL_DELETED`.
- `pageType` must be `job_posting` or `broadcast_event_video`.
- Reject normal blog/service pages.
- Use Google Indexing API endpoint:

```text
https://indexing.googleapis.com/v3/urlNotifications:publish
```

Store action:

```text
provider = google_indexing_api
action_type = google_indexing_publish
```

## `GET /api/search-visibility/actions/:clientId`

Purpose:

Show recent search visibility actions.

Recommended query params:

```text
limit=50
provider=google_search_console|indexnow|google_indexing_api
actionType=url_inspection|sitemap_submit|indexnow_submit|google_indexing_publish
status=success|failed|blocked
```

## Service Plan

Create:

```text
src/services/searchVisibilityService.js
```

Responsibilities:

- Read Google service account auth through existing helper.
- Inspect URLs through Search Console URL Inspection API.
- List and submit sitemaps through Search Console API.
- Submit IndexNow notifications.
- Submit guarded Google Indexing API notifications.
- Normalize and validate URLs.
- Store all user-triggered actions.
- Translate raw API responses into useful recommendations.

Recommended functions:

```js
getConnectionStatus(db, clientId, agencyId)
inspectUrl(db, { clientId, agencyId, userId, inspectionUrl, languageCode })
listSitemaps(db, { clientId, agencyId })
submitSitemap(db, { clientId, agencyId, userId, sitemapUrl })
submitIndexNow(db, { clientId, agencyId, userId, urls })
notifyGoogleIndexing(db, { clientId, agencyId, userId, url, type, pageType })
getActions(db, { clientId, agencyId, limit, provider, actionType, status })
recordIndexingAction(db, action)
buildUrlInspectionRecommendations(result)
```

## Database Plan

Extend `seo_clients`:

```sql
ALTER TABLE seo_clients
ADD COLUMN IF NOT EXISTS indexnow_key TEXT,
ADD COLUMN IF NOT EXISTS indexnow_key_location TEXT,
ADD COLUMN IF NOT EXISTS indexnow_connected_at TIMESTAMPTZ;
```

Create `indexing_actions`:

```sql
CREATE TABLE IF NOT EXISTS indexing_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    agency_id UUID REFERENCES agencies(id) ON DELETE SET NULL,
    client_id UUID REFERENCES seo_clients(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    action_type TEXT NOT NULL,
    status TEXT NOT NULL,
    url TEXT,
    normalized_url TEXT,
    site_url TEXT,
    sitemap_url TEXT,
    page_type TEXT,
    request_payload JSONB,
    response_payload JSONB,
    recommendations JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Recommended indexes:

```sql
CREATE INDEX IF NOT EXISTS idx_indexing_actions_client ON indexing_actions(client_id);
CREATE INDEX IF NOT EXISTS idx_indexing_actions_agency ON indexing_actions(agency_id);
CREATE INDEX IF NOT EXISTS idx_indexing_actions_created ON indexing_actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_indexing_actions_url ON indexing_actions(client_id, normalized_url);
CREATE INDEX IF NOT EXISTS idx_indexing_actions_provider ON indexing_actions(client_id, provider, action_type);
```

Allowed provider values:

```text
google_search_console
indexnow
google_indexing_api
system
```

Allowed action types:

```text
url_inspection
sitemap_list
sitemap_submit
indexnow_submit
google_indexing_publish
google_indexing_status
blocked_google_indexing_request
```

Allowed statuses:

```text
success
failed
blocked
pending
```

## URL Validation Rules

Before any action:

- Normalize URL using `src/utils/urlNormalize.js`.
- Require `http` or `https`.
- Reject `localhost`, private IPs, and non-web protocols.
- Reject URLs outside the client website host.
- Remove fragments.
- Keep query string only when required for the inspected URL.
- For GSC URL-prefix properties, ensure inspected URL is under the prefix.
- For GSC domain properties, ensure inspected URL host belongs to the domain.

## Recommendation Rules

When URL Inspection returns data, turn it into actions.

| Signal | Recommendation |
|---|---|
| Not indexed | Check crawlability, sitemap inclusion, internal links, content quality |
| Crawled but not indexed | Improve uniqueness, depth, internal links, and canonical clarity |
| Discovered but not crawled | Add internal links, update sitemap, check crawl budget blockers |
| Google selected different canonical | Fix canonical tag, duplicate content, redirects, and internal links |
| Blocked by robots.txt | Update robots.txt or remove the URL from indexing workflow |
| `noindex` detected | Remove `noindex` if the page should rank |
| Page fetch failed | Fix server status, redirects, timeout, DNS, or SSL issues |
| Sitemap missing | Add URL to sitemap and submit sitemap |

Recommended task categories:

```text
technical_seo
content_quality
internal_linking
indexing
conversion
```

## Frontend Plan

Add:

```text
public/js/search-visibility.js
public/css/search-visibility.css
```

Extend:

```text
views/index.ejs
public/js/app.js
```

UI sections:

- Client selector.
- Connection status cards.
- GSC and GA4 sync buttons.
- URL inspection form.
- Sitemap submit form.
- IndexNow submit form.
- Guarded Google Indexing API form.
- Recent actions table.
- Recommendations panel.
- Create task buttons.

Empty states:

| Missing item | Message |
|---|---|
| No GSC property | Connect a Search Console property before inspecting URLs |
| No GA4 property | Connect GA4 to connect traffic and conversion data |
| No service account | Add `GOOGLE_SERVICE_ACCOUNT_JSON` in `.env` |
| No IndexNow key | Add and host an IndexNow key to notify participating search engines |
| Normal page using Google Indexing API | Use URL Inspection, sitemap submission, and IndexNow instead |

## Reports Plan

Add a Search Visibility section to client reports.

Include:

- GSC connection status.
- GA4 connection status.
- Recent inspected URLs.
- Recent sitemap submissions.
- Recent IndexNow submissions.
- Google Indexing API blocked attempts, if any.
- Pages with indexing blockers.
- Pages with high visibility but weak engagement.
- Recommended next actions.

Client-safe report wording:

```text
Sitemap and URL discovery actions help search engines find important pages. They do not guarantee immediate crawling, indexing, or ranking.
```

## Alerts And Tasks Plan

New alert types:

```text
url_not_indexed
canonical_mismatch
robots_blocked
noindex_detected
sitemap_missing
page_fetch_failed
google_indexing_api_blocked
indexnow_failed
```

Task examples:

| Issue | Task |
|---|---|
| URL not indexed | Improve crawlability and internal links |
| Canonical mismatch | Fix canonical and duplicate content signals |
| Robots blocked | Update robots.txt or remove page from index target list |
| Noindex detected | Remove noindex if page should rank |
| Sitemap missing | Add URL to sitemap and submit sitemap |
| Page fetch failed | Fix server response, redirect, SSL, or timeout |
| High clicks high bounce | Improve landing page intent and conversion elements |

## Edge Cases

## Service Account Missing

Show setup guidance:

```text
Add GOOGLE_SERVICE_ACCOUNT_JSON to .env, then give the service account access to the client's GSC and GA4 properties.
```

## Permission Missing

Return:

```text
The service account does not have access to this client's Google property.
```

Include client steps to add the service account.

## GSC Property Mismatch

If the URL is not under `siteUrl`, block the request.

Example:

```text
Connected property is https://example.com/, but URL is https://blog.example.com/post.
Connect the correct GSC property or use a domain property.
```

## Domain Property Vs URL-Prefix Property

URL-prefix property:

```text
https://www.example.com/
```

Only inspect URLs under that prefix.

Domain property:

```text
sc-domain:example.com
```

Can inspect protocol and subdomain variants for that verified domain.

## Canonical Mismatch

If Google selected a different canonical, do not keep resubmitting the same URL. Fix canonical, duplicate content, redirects, internal links, and sitemap signals first.

## Robots Or Noindex Blocking

Do not submit blocked URLs as indexing targets. Create a technical SEO task first.

## Sitemap Not Reachable

Check:

- HTTP 200 response.
- XML validity.
- Correct content type where possible.
- Sitemap URL on same host.
- Not blocked by robots.txt.
- Sitemap index size limits.

## GA4 Property ID Confusion

GA4 property ID is numeric:

```text
123456789
```

It is not the measurement ID:

```text
G-XXXXXXXXXX
```

## API Quota Or Rate Limit

Record the failed action and show:

```text
Google or IndexNow rate limit reached. Wait and retry later.
```

Do not retry aggressively.

## Google Data Delay

GSC data can lag. Reports should explain that inspection, sitemap submission, and GSC performance data update on different timelines.

## IndexNow Key Failure

If IndexNow returns `403`, explain:

```text
The IndexNow key was not found or did not match the hosted key file.
```

If it returns `422`, explain:

```text
One or more URLs do not belong to the host authorized by the key.
```

## Client Setup Guide

## Google Search Console

Client steps:

1. Open Google Search Console.
2. Select the website property.
3. Open Settings.
4. Open Users and permissions.
5. Add the service account email.
6. Give Restricted permission for read/reporting features.
7. Give sufficient permission for sitemap submission if the app will submit sitemaps.

## GA4

Client steps:

1. Open Google Analytics.
2. Select the GA4 property.
3. Open Admin.
4. Open Property access management.
5. Add the service account email.
6. Give Viewer role.
7. Copy the numeric GA4 property ID into Keyword Analyzer.

## IndexNow

Client steps:

1. Generate an IndexNow key.
2. Host the key file at the website root when possible.
3. Example:

```text
https://example.com/{key}.txt
```

4. File content should be the key.
5. Add the key and key location to Keyword Analyzer.

## What Cannot Be Guaranteed

Tell clients:

```text
Submitting a sitemap or discovery notification does not guarantee that a page will be crawled, indexed, or ranked. These actions help search engines discover and evaluate URLs. Indexing depends on crawlability, content quality, canonical signals, internal links, duplication, site quality, and search engine systems.
```

## Pros

- Keeps agencies inside one product.
- Reduces context switching between GSC, GA4, and task tools.
- Connects search visibility to user behavior and conversions.
- Makes reports more action-focused.
- Helps clients understand why a page is not performing.
- Prevents inaccurate claims about instant indexing.
- Creates tasks directly from real crawl, index, and performance issues.
- Makes Keyword Analyzer stronger than a basic rank tracker.

## Cons And Risks

- Google does not guarantee indexing.
- Google Indexing API is limited to specific eligible page types.
- URL Inspection API reflects indexed-version status, not a full live test.
- Sitemaps help discovery but do not guarantee crawling.
- IndexNow does not submit URLs to Google.
- Service account permissions can confuse clients.
- Domain property and URL-prefix property matching can be tricky.
- Too many API calls can hit quota or rate limits.
- Bad UI wording can create false expectations.

## Acceptance Criteria

The implemented feature is successful when:

- Users can see GSC and GA4 connection status for each client.
- Users can sync GSC and GA4 from the same area.
- Users can inspect a URL and see readable indexability recommendations.
- Users can submit and list sitemaps from the app.
- Users can submit normal changed URLs through IndexNow when configured.
- Google Indexing API blocks normal blog/service pages.
- Every action is agency-scoped.
- Every action is recorded in `indexing_actions`.
- UI never promises instant or guaranteed Google indexing.
- Reports explain that GSC, GA4, sitemap, inspection, and IndexNow data are directional signals.

## Implementation Phases

## Phase 1: Documentation And Product Language

Goal:

Lock safe wording and define the feature accurately.

Tasks:

- Add this document.
- Add client-safe indexing language to reports.
- Use `Search Visibility Control Center` as the product name.
- Avoid `instant index` wording.

## Phase 2: Backend Services

Goal:

Add service functions for inspection, sitemaps, IndexNow, and guarded Google Indexing API.

Tasks:

- Create `searchVisibilityService.js`.
- Reuse service account auth.
- Add URL validation helpers.
- Add action recording helper.
- Add recommendation builder.

## Phase 3: Database

Goal:

Persist action history and IndexNow setup.

Tasks:

- Add `indexing_actions`.
- Add IndexNow fields to `seo_clients`.
- Add indexes.
- Add agency foreign keys with `ON DELETE SET NULL`.

## Phase 4: Routes

Goal:

Expose agency-scoped APIs.

Tasks:

- Create `searchVisibility.js` routes.
- Add ownership checks.
- Validate request bodies.
- Record success, failure, and blocked actions.

## Phase 5: Frontend

Goal:

Make the workflow usable from one page.

Tasks:

- Add Search Visibility navigation.
- Add status cards.
- Add URL inspection form.
- Add sitemap form.
- Add IndexNow form.
- Add guarded Google Indexing API form.
- Add recent actions and recommendations.

## Phase 6: Reports, Alerts, And Tasks

Goal:

Turn inspection and visibility issues into action.

Tasks:

- Add Search Visibility report section.
- Add alert types.
- Add task templates.
- Add create-task buttons from recommendations.

## Phase 7: Validation

Goal:

Make the feature reliable for agency use.

Tasks:

- Test URL ownership checks.
- Test domain vs URL-prefix properties.
- Test missing permissions.
- Test Google Indexing API guard.
- Test IndexNow key failures.
- Test sitemap submit and list.
- Test empty states.

## Final Product Outcome

After implementation, Keyword Analyzer should be positioned as:

```text
An agency SEO intelligence and search visibility operations platform.
```

The strongest workflow should be:

```text
Keyword -> Page -> Search Visibility -> User Behavior -> Conversion -> Task
```

The safest indexing promise should be:

```text
Keyword Analyzer helps search engines discover, inspect, and monitor important URLs from one agency dashboard. It does not guarantee instant Google indexing.
```
