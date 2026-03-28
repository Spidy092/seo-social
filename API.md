# Keyword Analyzer API Documentation

## Overview

Keyword Analyzer is an advanced SEO tool for keyword research, competitor analysis, and domain comparison. It provides search volume estimation, SERP analysis, keyword intent detection, and comprehensive page analysis.

## Base URL

```
http://localhost:4000
```

---

## Table of Contents

1. [Keyword Research](#keyword-research)
2. [Competitor Analysis](#competitor-analysis)
3. [Analysis & Comparison](#analysis--comparison)
4. [Alerts & Tracking](#alerts--tracking)
5. [Domains & Rankings](#domains--rankings)
6. [Utilities](#utilities)

---

## Keyword Research

### 1. Advanced Keyword Research

**POST** `/api/keywords/advanced-research`

Perform comprehensive keyword research with location targeting, intent analysis, and SERP features.

#### Request Body

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `keyword` | string | Yes | - | Target keyword phrase |
| `location` | string | No | "India" | Location (supports: Country, City, Area) |
| `language` | string | No | "en" | Language code |
| `includeSerpFeatures` | boolean | No | true | Detect SERP features |
| `includeIntent` | boolean | No | true | Analyze keyword intent |
| `includeContentGap` | boolean | No | true | Content gap analysis |
| `includeCompetitorAnalysis` | boolean | No | true | Top pages analysis |
| `compareLocations` | array | No | - | Compare across multiple locations |
| `numResults` | integer | No | 20 | Number of SERP results (max 50) |

#### Example Request

```json
{
  "keyword": "web design company in bangalore",
  "location": "Whitefield, Bangalore",
  "includeIntent": true,
  "includeSerpFeatures": true,
  "includeContentGap": true,
  "numResults": 20
}
```

#### Response

```json
{
  "success": true,
  "id": 1,
  "keyword": "web design company in bangalore",
  "location": {
    "full": {
      "gl": "in",
      "hl": "en",
      "google": "google.co.in",
      "country": "India",
      "state": "Karnataka",
      "city": "Bangalore",
      "area": "Whitefield"
    },
    "display": "Whitefield, Bangalore, Karnataka, India"
  },
  "metrics": {
    "searchVolume": 1200,
    "competition": "medium",
    "cpc": {
      "estimated": 1.50,
      "range": { "min": 0.50, "max": 2.50 }
    },
    "difficulty": 45,
    "opportunityScore": 68,
    "resultCount": 1250000
  },
  "intent": {
    "primary": "commercial",
    "secondary": "transactional",
    "breakdown": {
      "informational": 2,
      "navigational": 0,
      "commercial": 5,
      "transactional": 3
    },
    "stage": "consideration",
    "description": "Users are researching before buying. Best for comparison pages, reviews, and buying guides."
  },
  "serpFeatures": {
    "detected": {
      "featuredSnippet": false,
      "peopleAlsoAsk": true,
      "localPack": true,
      "imagePack": false,
      "videoResults": false,
      "shoppingResults": true
    },
    "details": {
      "peopleAlsoAskCount": 5,
      "localPackCount": 3,
      "shoppingAds": 4
    },
    "competition": "high",
    "richResultsOpportunity": "medium"
  },
  "contentGaps": {
    "questionsNotAnswered": [
      "How much does web design cost in Bangalore?",
      "What is the timeline for website development?",
      "Do you provide SEO services with web design?"
    ],
    "topicsToCover": ["pricing", "portfolio", "process", "technology", "support"],
    "targetLength": 2500,
    "missingElements": [
      {
        "element": "FAQ Schema",
        "reason": "Multiple questions detected - FAQ schema can win PAA boxes",
        "impact": "high"
      }
    ]
  },
  "topPagesAnalysis": {
    "averageWordCount": 1850,
    "avgH2Count": 8,
    "commonHeadings": ["Services", "Portfolio", "Pricing", "Contact"],
    "avgDA": 35,
    "recommendations": [
      {
        "type": "content_length",
        "message": "Competitors average 1850 words. Target at least 2200 words.",
        "priority": "high"
      }
    ]
  },
  "relatedKeywords": [
    { "keyword": "website design company bangalore", "type": "related", "intent": { "primary": "commercial" } },
    { "keyword": "best web development company in bangalore", "type": "related", "intent": { "primary": "commercial" } }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

---

### 2. Keyword Research (Legacy)

**POST** `/api/keywords/research`

Basic keyword research endpoint.

#### Request Body

```json
{
  "keyword": "web design",
  "location": "India"
}
```

#### Response

```json
{
  "success": true,
  "keyword": {
    "id": 1,
    "keyword": "web design",
    "location": "India",
    "searchVolume": 2400,
    "competition": "medium",
    "cpc": 2.50,
    "difficulty": 55,
    "relatedSearches": ["web design company", "web design services", "web developer"]
  },
  "intent": {
    "primary": "commercial",
    "secondary": "transactional",
    "stage": "consideration"
  },
  "relatedKeywords": [
    { "keyword": "web design company", "type": "autocomplete", "source": "google" }
  ],
  "competitors": [
    {
      "position": 1,
      "domain": "example.com",
      "url": "https://example.com/web-design",
      "title": "Professional Web Design Services",
      "description": "Award-winning web design company..."
    }
  ],
  "totalResults": 20,
  "totalRelated": 15
}
```

---

### 3. Keyword Suggestions

**POST** `/api/keywords/suggestions`

Get keyword suggestions based on a seed keyword.

#### Request Body

```json
{
  "seed": "web design",
  "location": "India"
}
```

#### Response

```json
{
  "seed": "web design",
  "suggestions": [
    { "keyword": "web design company", "type": "autocomplete", "source": "google" },
    { "keyword": "web design services near me", "type": "autocomplete", "source": "google" },
    { "keyword": "what is web design", "type": "question", "source": "serp" }
  ],
  "total": 15,
  "byType": {
    "autocomplete": 10,
    "related": 3,
    "questions": 2
  }
}
```

---

### 4. Get Keyword Details

**GET** `/api/keywords/:id`

Get details of a saved keyword.

```
GET /api/keywords/1
```

---

### 5. List Keywords

**GET** `/api/keywords`

List all saved keywords with pagination.

#### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | 50 | Results per page |
| `offset` | integer | 0 | Pagination offset |
| `search` | string | - | Search in keyword name |

#### Example

```
GET /api/keywords?limit=10&offset=0&search=web
```

---

### 6. Get Available Locations

**GET** `/api/locations`

Get list of supported locations for keyword research.

#### Response

```json
{
  "success": true,
  "locations": {
    "countries": [
      { "id": "india", "name": "India", "gl": "in" },
      { "id": "usa", "name": "United States", "gl": "us" }
    ],
    "india": {
      "cities": [
        { "id": "bangalore", "name": "Bangalore", "state": "Karnataka" },
        { "id": "mumbai", "name": "Mumbai", "state": "Maharashtra" }
      ],
      "areas": {
        "bangalore": ["Whitefield", "Marathahalli", "Koramangala", "HSR Layout"],
        "mumbai": ["Andheri", "Bandra", "Juhu", "Powai"]
      }
    }
  }
}
```

---

## Competitor Analysis

### 1. Analyze Competitor Page

**POST** `/api/competitors/analyze`

Analyze a competitor's page for SEO metrics.

#### Request Body

```json
{
  "url": "https://competitor.com/web-design",
  "keyword": "web design company",
  "keywordId": 1
}
```

#### Response

```json
{
  "success": true,
  "analysis": {
    "domain": "competitor.com",
    "url": "https://competitor.com/web-design",
    "domainAuthority": 35,
    "content": {
      "wordCount": 2150,
      "keywordAnalysis": {
        "exactMatches": 12,
        "wordCounts": {
          "web": 15,
          "design": 12,
          "company": 8
        },
        "density": 1.63
      }
    },
    "seo": {
      "hasH1": true,
      "h1Text": "Web Design Company",
      "hasMetaDescription": true,
      "metaDescription": "Professional web design services...",
      "headings": { "h1": 1, "h2": 8, "h3": 12 },
      "images": 24,
      "imagesWithAlt": 24,
      "internalLinks": 15,
      "externalLinks": 5,
      "hasSchema": true,
      "schemaDetails": {
        "hasSchema": true,
        "count": 2,
        "detectedTypes": ["LocalBusiness", "WebSite"],
        "isValid": true,
        "errors": []
      },
      "pageType": {
        "primary": "Service",
        "all": ["Service", "LocalBusiness"]
      },
      "schemaSuggestions": [
        {
          "type": "FAQPage",
          "priority": "HIGH",
          "reason": "FAQ content detected - FAQ schema can show rich snippets",
          "fields": ["mainEntity"]
        }
      ]
    }
  }
}
```

---

### 2. Compare Multiple Competitors

**POST** `/api/competitors/compare`

Compare multiple domains side-by-side.

#### Request Body

```json
{
  "domains": ["competitor1.com", "competitor2.com", "competitor3.com"],
  "keyword": "web design company"
}
```

---

### 3. Get Top Competitors

**GET** `/api/competitors/top`

Get top competitors across all tracked keywords.

```
GET /api/competitors/top?limit=20
```

---

## Analysis & Comparison

### 1. Multi-Competitor Analysis

**POST** `/api/analysis/multi-competitor`

Analyze multiple competitors at once with benchmarks and patterns.

#### Request Body

```json
{
  "domains": ["competitor1.com", "competitor2.com"],
  "keyword": "web design company in bangalore",
  "location": "India"
}
```

#### Response Highlights

```json
{
  "success": true,
  "analysis": {
    "benchmarks": {
      "averageWordCount": 1850,
      "averageDA": 32,
      "bestDA": 45,
      "bestWordCount": 2400
    },
    "comparisonTable": {
      "domainAuthority": [
        { "domain": "competitor1.com", "value": 45, "rank": 1 },
        { "domain": "competitor2.com", "value": 35, "rank": 2 }
      ],
      "wordCount": [...],
      "seoScore": [...]
    },
    "patterns": {
      "commonStrengths": [
        "All competitors have H1 tags",
        "Common schema types: LocalBusiness, WebSite"
      ],
      "commonWeaknesses": [
        {
          "factor": "Low content volume",
          "detail": "Average word count is 1850 words..."
        }
      ],
      "recommendations": [
        {
          "priority": "HIGH",
          "action": "Improve internal linking",
          "detail": "Average internal links: 3. Aim for 10+ per page."
        }
      ]
    }
  }
}
```

---

### 2. Gap Analysis

**POST** `/api/analysis/gap-analysis`

Compare your domain against competitors to find gaps.

#### Request Body

```json
{
  "myDomain": "mysite.com",
  "competitorDomains": ["competitor1.com", "competitor2.com"],
  "keyword": "web design company"
}
```

#### Response Highlights

```json
{
  "success": true,
  "gapAnalysis": {
    "gaps": [
      {
        "category": "Content Length",
        "myValue": 1200,
        "competitorAvg": 2100,
        "gap": 900,
        "priority": "HIGH",
        "recommendation": "Add approximately 1000 more words..."
      },
      {
        "category": "H1 Tag",
        "myValue": "Missing",
        "competitorAvg": "3/3 have H1",
        "gap": "Missing",
        "priority": "HIGH",
        "recommendation": "Add H1 tag with target keyword"
      }
    ],
    "summary": {
      "totalGaps": 5,
      "highPriority": 2,
      "mediumPriority": 2,
      "lowPriority": 1,
      "topRecommendation": "Add approximately 1000 more words to match..."
    }
  }
}
```

---

### 3. Compare Domains

**POST** `/api/analysis/compare`

Compare your domain vs a competitor.

#### Request Body

```json
{
  "myDomain": "mysite.com",
  "competitorDomain": "competitor.com",
  "keyword": "web design",
  "myUrl": "https://mysite.com/services/web-design",
  "competitorUrl": "https://competitor.com/web-design"
}
```

---

### 4. Full Keyword Report

**POST** `/api/analysis/report`

Generate comprehensive report for a keyword.

```json
{
  "keyword": "web design company",
  "myDomain": "mysite.com",
  "location": "India"
}
```

---

### 5. Page Analysis

**POST** `/api/analysis/page`

Analyze a single page.

```json
{
  "url": "https://example.com/web-design",
  "keyword": "web design company"
}
```

---

### 6. Get Suggestions

**POST** `/api/analysis/suggestions`

Get SEO improvement suggestions for a domain/keyword.

```json
{
  "myDomain": "mysite.com",
  "keyword": "web design",
  "myUrl": "https://mysite.com/services"
}
```

---

## Alerts & Tracking

### 1. Get Alerts

**GET** `/api/alerts`

Get all alerts with optional filters.

```
GET /api/alerts?unreadOnly=true&limit=20
```

---

### 2. Mark Alert as Read

**PUT** `/api/alerts/:id/read`

Mark a single alert as read.

---

### 3. Mark All Alerts as Read

**PUT** `/api/alerts/read-all`

Mark all alerts as read.

---

### 4. Get Unread Count

**GET** `/api/alerts/unread-count`

Get count of unread alerts.

---

## Domains & Rankings

### 1. Add Domain to Track

**POST** `/api/domains`

Add a domain for rank tracking.

```json
{
  "domain": "mysite.com",
  "name": "My Website"
}
```

---

### 2. Get My Domains

**GET** `/api/domains`

List all tracked domains.

---

### 3. Get Domain Rankings

**GET** `/api/rankings/:domain`

Get all rankings for a domain.

---

### 4. Manual Rank Check

**POST** `/api/rankings/check`

Manually trigger rank check for a domain.

```json
{
  "domain": "mysite.com"
}
```

---

## Utilities

### 1. Health Check

**GET** `/health`

Check server and database status.

```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 3600.5
}
```

---

### 2. Dashboard Stats

**GET** `/api/stats`

Get dashboard statistics.

```json
{
  "totalKeywords": 25,
  "totalCompetitors": 150,
  "unreadAlerts": 5,
  "topRankings": 12
}
```

---

## Location Hierarchy

The API supports hierarchical location targeting:

### Countries
- India, United States, United Kingdom, Canada, Australia, Germany, France, UAE, Singapore

### Indian Cities
- Bangalore, Mumbai, Delhi, Chennai, Hyderabad, Pune, Kolkata, Ahmedabad, Jaipur, Kochi

### City Areas (Examples)

**Bangalore Areas:**
Whitefield, Marathahalli, Koramangala, HSR Layout, Indiranagar, Jayanagar, Electronic City, MG Road, BTM Layout, JP Nagar, Banashankari, Malleshwaram, Hebbal, Yelahanka, Hennur, K.R. Puram

**Mumbai Areas:**
Andheri, Bandra, Juhu, Powai, Malad, Goregaon, Thane, Navi Mumbai

**Delhi/NCR Areas:**
Gurgaon, Noida, Dwarka, Saket, Lajpat Nagar, Rohini, Janakpuri, Connaught Place

**Hyderabad Areas:**
Gachibowli, Hitech City, Kukatpally, Jubilee Hills, Banjara Hills

---

## Keyword Intent Types

| Intent | Stage | Description |
|--------|-------|-------------|
| `informational` | Awareness | Users seeking information/answers |
| `navigational` | Loyalty | Users looking for specific websites |
| `commercial` | Consideration | Users researching before buying |
| `transactional` | Decision | Users ready to purchase |

---

## SERP Feature Types

| Feature | Description |
|---------|-------------|
| `featuredSnippet` | Quick answer box at top of results |
| `peopleAlsoAsk` | Expandable question boxes |
| `localPack` | Map with local businesses |
| `imagePack` | Image carousel |
| `videoResults` | Video thumbnails |
| `shoppingResults` | Product listings with prices |
| `knowledgeGraph` | Entity information panel |
| `topStories` | News articles |
| `jobListing` | Job postings |
| `eventListing` | Event information |

---

## Schema Markup Types

The analyzer detects and suggests these schema types:

| Type | When Suggested |
|------|----------------|
| `FAQPage` | FAQ content or questions in headings |
| `Article` | Blog posts, news articles |
| `LocalBusiness` | Local business content |
| `Service` | Service pages |
| `Organization` | About/company pages |
| `WebSite` | All pages (base schema) |
| `BreadcrumbList` | Navigation structure |
| `Product` | E-commerce products |

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `200` - Success
- `400` - Bad Request (validation error)
- `404` - Not Found
- `500` - Internal Server Error

---

## Rate Limiting

The API includes built-in rate limiting:
- SERP requests: 2-3 second delay between calls
- Rank tracking: Configurable interval (default 24 hours)
- API calls: Artificial delays to prevent abuse

---

## Environment Variables

Configure the application via `.env` file:

```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/keyword_analyzer
DB_HOST=localhost
DB_PORT=5432
DB_NAME=keyword_analyzer
DB_USER=keyword_user
DB_PASSWORD=keyword_pass

# APIs
SERPER_API_KEY=your_serper_api_key
GOOGLE_CSE_API_KEY=your_google_cse_key
OPENPAGERANK_API_KEY=your_openpagerank_key

# Rank Tracking
CHECK_INTERVAL=86400
RANK_DROP_THRESHOLD=5
RANK_IMPROVEMENT_THRESHOLD=10
RATE_LIMIT_DELAY=3000
ALERT_WEBHOOK_URL=https://your-webhook.com

# Server
PORT=4000
HOST=0.0.0.0
```

---

## Support

For issues or feature requests, please open an issue at the project repository.

---

## Changelog

### v1.0.1 — March 2026

**Bug Fixes:**
- Fixed `PUT /api/alerts/read-all` routing conflict with `PUT /api/alerts/:id/read` — route order corrected so static route takes priority over dynamic
- Fixed `checkDomainRankings()` frontend function that was a stub (showed fake spinner, never called API) — now correctly calls `POST /api/rankings/check`
- Fixed Competitors page "View" button — detail panel was appearing off-screen below the list; replaced with a proper centered modal

**New Routes Added:**
- `GET /api/domains` — List all tracked domains (alias for `/api/alerts/domains`)
- `POST /api/domains` — Add a domain to track
- `POST /api/rankings/check` — Trigger a manual rank check for a domain
- `GET /api/rankings/:domain` — Get all current rankings for a domain
- `GET /api/alerts/unread-count` — Get count of unread alerts

**UI Improvements:**
- Added `<meta name="description">` and favicon to HTML `<head>`
- Added description banner to Competitors page explaining what it does
- Added tooltip hints to Competitors table column headers
- Added `text-muted`, `text-center`, `.page-description` and `.header-hint` CSS utilities
- Alerts page title changed from "Rank Drop Alerts" to "Alerts" (covers all alert types)
