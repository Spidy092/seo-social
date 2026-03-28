# 📚 Keyword Analyzer - Complete Feature Documentation

## Table of Contents
1. [Keyword Research](#1-keyword-research)
2. [Related Keywords](#2-related-keywords)
3. [Competitor Discovery](#3-competitor-discovery)
4. [Page Analysis](#4-page-analysis)
5. [Domain Comparison](#5-domain-comparison)
6. [Improvement Suggestions](#6-improvement-suggestions)
7. [Rank Tracking](#7-rank-tracking)
8. [Alerts System](#8-alerts-system)
9. [API Reference](#9-api-reference)

---

## 1. 🔍 Keyword Research

### What It Does
Research any keyword to get search volume, competition, and top ranking pages.

### How to Use
1. Go to **Keyword Research** page
2. Enter your keyword (e.g., "web design company in bengaluru")
3. Select location (optional)
4. Click **Research**

### Data Provided
| Metric | Description | Source |
|--------|-------------|--------|
| Search Volume | Estimated monthly searches | Calculated from SERP data |
| Competition | Low/Medium/High | Based on ad presence |
| CPC | Cost Per Click ($) | Estimated from ads |
| Difficulty | 0-100 score | Domain authority of top results |

### Example Output
```
Keyword: "web design company in bengaluru"
├── Search Volume: 2,400/month
├── Competition: Medium
├── CPC: $1.85
├── Difficulty: 58/100
└── Top 20 Ranking Pages
```

### API Endpoint
```http
POST /api/keywords/research
Content-Type: application/json

{
  "keyword": "web design company in bengaluru",
  "location": "Bengaluru"
}
```

---

## 2. 🔗 Related Keywords

### What It Does
Finds related keywords, autocomplete suggestions, and "People Also Ask" questions.

### Sources
1. **Google Autocomplete** - Real-time suggestions
2. **Google SERP Related Searches** - "Searches related to" section
3. **Bing Suggestions** - Fallback source
4. **People Also Ask** - Question-based keywords

### How to Use
- Automatically shown after keyword research
- Click any related keyword to research it
- Use `/api/keywords/related/:keyword` for quick lookup

### Example Output
```
Keyword: "web design company"

Related Keywords (18 found):
├── Autocomplete:
│   ├── web design company in bangalore
│   ├── web design company near me
│   └── web design company in india
├── Related Searches:
│   ├── website design services
│   ├── web development company
│   └── best web design agencies
└── Questions:
    ├── How much does web design cost?
    └── How to choose a web design company?
```

### API Endpoints
```http
# Get related keywords (included in research)
POST /api/keywords/research

# Quick related keywords lookup
GET /api/keywords/related/:keyword

# Get suggestions with types
POST /api/keywords/suggestions
{
  "seed": "web design",
  "location": "India"
}
```

---

## 3. 🏆 Competitor Discovery

### What It Does
Automatically discovers who ranks for your target keywords.

### How to Use
1. Research a keyword
2. View the **Ranking Pages** table
3. See domain, position, title, and description
4. Click **Analyze** to deep-dive into any competitor

### Data Provided
| Field | Description |
|-------|-------------|
| Position | Ranking position (1-100) |
| Domain | Website domain |
| URL | Full page URL |
| Title | Page title tag |
| Description | Meta description |

### API Endpoint
```http
# Get competitors for a keyword
GET /api/competitors/keyword/:keywordId

# Get all rankings for a domain
GET /api/competitors/:domain

# Get top competitors across all keywords
GET /api/competitors/top?limit=20
```

---

## 4. 📊 Page Analysis

### What It Does
Analyzes any ranking page to understand why it ranks well.

### How to Use
1. Research a keyword
2. Click **Analyze** button on any competitor
3. View detailed page analysis

### Metrics Analyzed

#### Content Metrics
| Metric | Description |
|--------|-------------|
| Word Count | Total words on page |
| Keyword Count | Times keyword appears |
| Keyword Density | Percentage of keyword usage |

#### SEO Elements
| Element | Check |
|---------|-------|
| H1 Tag | Present/Not present |
| Meta Description | Present/Not present |
| Schema Markup | Structured data detected |
| Images | Total images count |
| Image Alt Text | Images with alt attributes |

#### Link Analysis
| Metric | Description |
|--------|-------------|
| Internal Links | Links to same domain |
| External Links | Links to other domains |

#### Authority
| Metric | Description |
|--------|-------------|
| Domain Authority | 0-100 score |

### Example Output
```
Page: competitor.com/web-design-bangalore

Content:
├── Word Count: 2,450
├── Keyword Count: 12
└── Keyword Density: 1.8%

SEO Elements:
├── H1 Tag: ✅ "Web Design Company in Bangalore"
├── Meta Description: ✅ Present
├── Schema Markup: ✅ LocalBusiness
└── Images: 8 (6 with alt text)

Links:
├── Internal: 24
└── External: 5

Domain Authority: 65/100
```

### API Endpoint
```http
POST /api/competitors/analyze
{
  "url": "https://competitor.com/page",
  "keyword": "web design company",
  "keywordId": 123
}
```

---

## 5. ⚖️ Domain Comparison

### What It Does
Compares your domain vs a competitor to understand ranking differences.

### How to Use
1. Go to **Compare & Analyze** page
2. Enter your domain
3. Enter competitor domain
4. Enter your page URL (optional)
5. Enter competitor page URL (optional)
6. Enter target keyword
7. Click **Compare & Analyze**

### Comparison Metrics

#### Domain Authority
```
Your Domain: mywebsite.com
├── DA: 35/100

Competitor: competitor.com
├── DA: 65/100

Gap: -30 points (competitor stronger)
```

#### Content Comparison
```
Word Count:
├── Yours: 1,200 words
├── Competitor: 2,450 words
└── Gap: +1,250 words needed

Keyword Density:
├── Yours: 0.8%
├── Competitor: 1.8%
└── Gap: +1.0% needed
```

#### SEO Elements
```
H1 Tag:
├── Yours: ❌ Missing
└── Competitor: ✅ Present

Meta Description:
├── Yours: ✅ Present
└── Competitor: ✅ Present
```

### API Endpoint
```http
POST /api/analysis/compare
{
  "myDomain": "mywebsite.com",
  "competitorDomain": "competitor.com",
  "keyword": "web design company",
  "myUrl": "https://mywebsite.com/web-design",
  "competitorUrl": "https://competitor.com/web-design"
}
```

---

## 6. 💡 Improvement Suggestions

### What It Does
Generates prioritized suggestions to improve your rankings.

### Suggestion Categories

#### HIGH Priority
| Suggestion | When Triggered |
|------------|----------------|
| Add more content | Competitor has 500+ more words |
| Improve keyword usage | Keyword density too low |
| Add H1 tag | Missing H1 |
| Build backlinks | Lower DA than competitor |

#### MEDIUM Priority
| Suggestion | When Triggered |
|------------|----------------|
| Add meta description | Missing meta description |
| Add schema markup | Competitor has it, you don't |
| Add internal links | Fewer internal links |

#### LOW Priority
| Suggestion | When Triggered |
|------------|----------------|
| Optimize images | Missing alt text |
| Build domain authority | Long-term strategy |

### Example Output
```
Suggestions for mywebsite.com:

🔴 HIGH PRIORITY
├── Add 1,250 more words to your content
│   ├── Add detailed sections
│   ├── Include FAQs
│   └── Add case studies
│   └── Impact: +5-10 positions
│
└── Add H1 tag with target keyword
    ├── Use only one H1
    ├── Include "web design company"
    └── Impact: +5-15 positions

🟡 MEDIUM PRIORITY
├── Add meta description
└── Add schema markup

🟢 LOW PRIORITY
└── Add alt text to 2 images
```

### API Endpoint
```http
POST /api/analysis/suggestions
{
  "myDomain": "mywebsite.com",
  "keyword": "web design company",
  "myUrl": "https://mywebsite.com/page"
}
```

---

## 7. 📈 Rank Tracking

### What It Does
Tracks your domain's ranking positions over time.

### How to Use
1. Go to **Rank Tracking** page
2. Enter your domain
3. Click **Add Domain**
4. System checks rankings daily at 3 AM

### Tracked Data
| Metric | Description |
|--------|-------------|
| Current Position | Latest ranking |
| Previous Position | Last check position |
| Change | Up/Down/Same/New/Lost |
| History | Full position history |

### Manual Check
Click **Check** button to trigger immediate rank check.

### API Endpoints
```http
# Add domain to track
POST /api/alerts/track
{
  "domain": "mywebsite.com"
}

# Get tracked domains
GET /api/alerts/domains

# Get rank history
GET /api/alerts/rank-history?domain=mywebsite.com&days=30

# Get summary
GET /api/alerts/summary?domain=mywebsite.com
```

---

## 8. 🚨 Alerts System

### What It Does
Notifies you when rankings change significantly.

### Alert Types

#### Rank Drop 🚨
- Triggered when position drops 5+ places
- Example: "#5 → #15 (dropped 10 positions)"

#### Rank Improvement 🎉
- Triggered when position improves 10+ places
- Example: "#25 → #12 (gained 13 positions)"

#### New Ranking ✨
- Triggered when you start ranking for a keyword
- Example: "Now ranking #8 for 'web design'"

#### Lost Ranking ❌
- Triggered when you lose ranking completely
- Example: "Lost ranking for 'web design' (was #15)"

### How to Use
1. Go to **Alerts** page
2. View all alerts
3. Filter by type (drops, improvements, new, lost)
4. Mark as read when reviewed

### Webhook Notifications
Configure `ALERT_WEBHOOK_URL` in `.env` to receive alerts in:
- Telegram
- Discord
- Slack
- Custom webhook

### API Endpoints
```http
# Get all alerts
GET /api/alerts?domain=mywebsite.com&unreadOnly=true

# Mark alert as read
PUT /api/alerts/:id/read

# Mark all as read
PUT /api/alerts/read-all

# Get unread count
GET /api/alerts?unreadOnly=true
```

---

## 9. 📡 API Reference

### Base URL
```
http://localhost:3000
```

### Keywords API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/keywords/research` | Research a keyword |
| GET | `/api/keywords` | List all keywords |
| GET | `/api/keywords/:id` | Get keyword details |
| GET | `/api/keywords/related/:keyword` | Get related keywords |
| POST | `/api/keywords/suggestions` | Get suggestions |
| DELETE | `/api/keywords/:id` | Delete keyword |

### Competitors API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/competitors/analyze` | Analyze competitor page |
| GET | `/api/competitors/keyword/:id` | Get competitors for keyword |
| GET | `/api/competitors/:domain` | Get competitor details |
| POST | `/api/competitors/compare` | Compare competitors |
| GET | `/api/competitors/top` | Get top competitors |

### Analysis API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analysis/compare` | Compare domains |
| POST | `/api/analysis/report` | Generate full report |
| POST | `/api/analysis/page` | Analyze single page |
| POST | `/api/analysis/suggestions` | Get suggestions |
| GET | `/api/analysis/history` | Get analysis history |

### Alerts API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/alerts/track` | Add domain to track |
| GET | `/api/alerts/domains` | Get tracked domains |
| GET | `/api/alerts` | Get all alerts |
| PUT | `/api/alerts/:id/read` | Mark alert as read |
| PUT | `/api/alerts/read-all` | Mark all as read |
| GET | `/api/alerts/rank-history` | Get rank history |
| GET | `/api/alerts/summary` | Get summary |

### Health Check
```http
GET /health
```

Response:
```json
{
  "status": "ok",
  "database": "connected",
  "uptime": 3600
}
```

---

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `REDIS_HOST` | No | localhost | Redis host |
| `SERPER_API_KEY` | Yes* | - | Serper.dev API key |
| `OPENPAGERANK_API_KEY` | Yes* | - | OpenPageRank API key |
| `PORT` | No | 3000 | Server port |
| `CHECK_INTERVAL` | No | 86400 | Rank check interval (seconds) |
| `ALERT_WEBHOOK_URL` | No | - | Webhook for alerts |

*At least one API key required for best results

---

## 🚀 Quick Start

```bash
# Install
npm install

# Setup database
createdb keyword_analyzer

# Configure
cp .env.example .env
# Edit .env with your API keys

# Run
npm start

# Open dashboard
open http://localhost:3000
```

---

## 📊 Dashboard Pages

### 1. Dashboard
- Overview statistics
- Recent keywords
- Recent alerts

### 2. Keyword Research
- Enter keyword + location
- View search volume, competition
- See top 20 ranking pages
- View related keywords

### 3. Competitors
- Top competitors list
- Click to see their keywords
- Domain authority scores

### 4. Compare & Analyze
- Enter your domain + competitor
- Get side-by-side comparison
- See why they rank higher
- Get improvement suggestions

### 5. Rank Tracking
- Add domains to track
- View rank history
- Manual rank checks

### 6. Alerts
- View all alerts
- Filter by type
- Mark as read

---

## 🛡️ Anti-Detection

- Random User-Agent rotation (4 agents)
- Adaptive rate limiting
- Exponential backoff on errors
- 2-3 second delays between requests

---

## 📈 Metrics Tracked

- Keywords researched
- Competitors discovered
- Pages analyzed
- Rank changes
- Alerts generated

---

**Built with ❤️ by Spidy092**
