# 📡 Keyword Analyzer - API Documentation

## Base URL
```
http://localhost:3000
```

---

## 🔍 Keywords API

### Research a Keyword
```http
POST /api/keywords/research
Content-Type: application/json

{
  "keyword": "web design company in bengaluru",
  "location": "Bengaluru"
}
```

**Response:**
```json
{
  "success": true,
  "keyword": {
    "id": 1,
    "keyword": "web design company in bengaluru",
    "location": "Bengaluru",
    "searchVolume": 2400,
    "competition": "medium",
    "cpc": "1.85",
    "difficulty": 58,
    "relatedSearches": ["web design bangalore", "website designer"]
  },
  "relatedKeywords": [
    { "keyword": "web design company in bangalore", "type": "autocomplete", "source": "google" },
    { "keyword": "website design services", "type": "related", "source": "google_serp" }
  ],
  "competitors": [
    {
      "domain": "competitor.com",
      "position": 1,
      "url": "https://competitor.com/web-design",
      "title": "Web Design Company in Bangalore",
      "description": "Leading web design agency..."
    }
  ],
  "totalResults": 20,
  "totalRelated": 15
}
```

### Get Related Keywords (Quick)
```http
GET /api/keywords/related/:keyword
```

**Example:**
```http
GET /api/keywords/related/web%20design
```

**Response:**
```json
{
  "keyword": "web design",
  "related": [
    "web design company",
    "web design services",
    "web design near me",
    "web design cost",
    "web design agency"
  ],
  "total": 15
}
```

### List All Keywords
```http
GET /api/keywords?limit=50&offset=0&search=design
```

### Get Keyword Details
```http
GET /api/keywords/:id
```

### Delete Keyword
```http
DELETE /api/keywords/:id
```

---

## 🏆 Competitors API

### Analyze Competitor Page
```http
POST /api/competitors/analyze
Content-Type: application/json

{
  "url": "https://competitor.com/page",
  "keyword": "web design company",
  "keywordId": 1
}
```

**Response:**
```json
{
  "success": true,
  "analysis": {
    "domain": "competitor.com",
    "url": "https://competitor.com/page",
    "domainAuthority": 65,
    "content": {
      "wordCount": 2450,
      "keywordAnalysis": {
        "exactMatches": 12,
        "density": 1.8
      }
    },
    "seo": {
      "hasH1": true,
      "hasMetaDescription": true,
      "hasSchema": true,
      "internalLinks": 24,
      "externalLinks": 5
    }
  }
}
```

### Get Competitors for Keyword
```http
GET /api/competitors/keyword/:keywordId
```

### Get Competitor Details
```http
GET /api/competitors/:domain
```

### Compare Competitors
```http
POST /api/competitors/compare
Content-Type: application/json

{
  "domains": ["domain1.com", "domain2.com", "domain3.com"],
  "keyword": "web design"
}
```

### Get Top Competitors
```http
GET /api/competitors/top?limit=20
```

---

## ⚖️ Analysis API

### Compare Domains
```http
POST /api/analysis/compare
Content-Type: application/json

{
  "myDomain": "mywebsite.com",
  "competitorDomain": "competitor.com",
  "keyword": "web design company",
  "myUrl": "https://mywebsite.com/web-design",
  "competitorUrl": "https://competitor.com/web-design"
}
```

**Response:**
```json
{
  "success": true,
  "comparison": {
    "keyword": "web design company",
    "myDomain": "mywebsite.com",
    "competitorDomain": "competitor.com",
    "scores": {
      "domainAuthority": {
        "mine": 35,
        "competitor": 65,
        "difference": 30
      },
      "content": {
        "wordCount": {
          "mine": 1200,
          "competitor": 2450,
          "difference": 1250,
          "winner": "competitor"
        }
      }
    },
    "whyCompetitorRanks": [
      {
        "factor": "Domain Authority",
        "impact": "HIGH",
        "explanation": "Competitor has DA 65 vs your DA 35",
        "gap": "+30 DA points"
      }
    ],
    "suggestions": [
      {
        "priority": "HIGH",
        "category": "Content",
        "action": "Add 1,250 more words to your content",
        "details": ["Add detailed sections", "Include FAQs"],
        "estimatedImpact": "Could improve ranking by 5-10 positions"
      }
    ]
  }
}
```

### Get Suggestions
```http
POST /api/analysis/suggestions
Content-Type: application/json

{
  "myDomain": "mywebsite.com",
  "keyword": "web design company",
  "myUrl": "https://mywebsite.com/page"
}
```

### Generate Full Report
```http
POST /api/analysis/report
Content-Type: application/json

{
  "keyword": "web design company",
  "myDomain": "mywebsite.com",
  "location": "India"
}
```

---

## 🚨 Alerts API

### Add Domain to Track
```http
POST /api/alerts/track
Content-Type: application/json

{
  "domain": "mywebsite.com"
}
```

### Get Tracked Domains
```http
GET /api/alerts/domains
```

### Get All Alerts
```http
GET /api/alerts?domain=mywebsite.com&unreadOnly=true&limit=50
```

**Response:**
```json
{
  "alerts": [
    {
      "id": 1,
      "domain": "mywebsite.com",
      "keyword": "web design",
      "alert_type": "rank_drop",
      "message": "🚨 Rank dropped for \"web design\": #5 → #15 (dropped 10 positions)",
      "old_value": "5",
      "new_value": "15",
      "is_read": false,
      "created_at": "2026-03-16T15:30:00Z"
    }
  ],
  "total": 10,
  "unreadCount": 3
}
```

### Mark Alert as Read
```http
PUT /api/alerts/:id/read
```

### Mark All as Read
```http
PUT /api/alerts/read-all
Content-Type: application/json

{
  "domain": "mywebsite.com"  // optional
}
```

### Get Rank History
```http
GET /api/alerts/rank-history?domain=mywebsite.com&keywordId=1&days=30
```

### Get Summary
```http
GET /api/alerts/summary?domain=mywebsite.com
```

---

## 🏥 Health Check

```http
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 3600.5
}
```

---

## 🔑 Authentication

Currently no authentication required. For production, add:
- API key authentication
- Rate limiting per user
- JWT tokens

---

## 📊 Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/keywords/research` | 10/minute |
| `/api/competitors/analyze` | 20/minute |
| `/api/keywords/related` | 30/minute |
| Other endpoints | 60/minute |

---

## ❌ Error Responses

### 400 Bad Request
```json
{
  "error": "keyword is required"
}
```

### 404 Not Found
```json
{
  "error": "Keyword not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error message"
}
```

---

## 📝 Examples

### cURL Examples

```bash
# Research keyword
curl -X POST http://localhost:3000/api/keywords/research \
  -H "Content-Type: application/json" \
  -d '{"keyword": "web design", "location": "India"}'

# Get related keywords
curl http://localhost:3000/api/keywords/related/web%20design

# Analyze competitor
curl -X POST http://localhost:3000/api/competitors/analyze \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "keyword": "web design"}'

# Compare domains
curl -X POST http://localhost:3000/api/analysis/compare \
  -H "Content-Type: application/json" \
  -d '{
    "myDomain": "mywebsite.com",
    "competitorDomain": "competitor.com",
    "keyword": "web design"
  }'

# Track domain
curl -X POST http://localhost:3000/api/alerts/track \
  -H "Content-Type: application/json" \
  -d '{"domain": "mywebsite.com"}'

# Get alerts
curl http://localhost:3000/api/alerts?unreadOnly=true
```

### JavaScript Examples

```javascript
// Research keyword
const response = await fetch('/api/keywords/research', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    keyword: 'web design company',
    location: 'Bengaluru'
  })
});
const data = await response.json();

// Get related keywords
const related = await fetch('/api/keywords/related/web%20design');
const suggestions = await related.json();

// Compare domains
const comparison = await fetch('/api/analysis/compare', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    myDomain: 'mywebsite.com',
    competitorDomain: 'competitor.com',
    keyword: 'web design'
  })
});
```

---

**Built with ❤️ by Spidy092**
