# 🔍 Keyword Analyzer

Advanced Keyword Research & Competitor Analysis Tool with Rank Tracking, SERP Features Detection, and Content Gap Analysis.

---

## ✨ Features

### 1. 🔍 Advanced Keyword Research
- Enter any keyword (e.g., "web design company in bangalore")
- **Hierarchical Location Targeting**: Country → State → City → Area
  - Countries: India, USA, UK, Canada, Australia, Germany, UAE, Singapore
  - Indian Cities: Bangalore, Mumbai, Delhi, Chennai, Hyderabad, Pune, etc.
  - Areas: Whitefield, Koramangala, Andheri, Bandra, Gachibowli, etc.
- **Search volume estimation**
- **Opportunity Score** (0-100): Combined metric based on volume, competition, CPC, and intent
- **Keyword Intent Analysis**: Informational, Commercial, Transactional, Navigational
- **SERP Features Detection**: Featured snippets, PAA, Local packs, Shopping, Videos
- **Content Gap Analysis**: Questions, topics, target word count, missing elements
- **CPC Range** estimation (min-max)
- **Keyword difficulty score**
- **Related keywords** with intent classification
- **Top 20 ranking pages** with detailed analysis

### 2. 🏆 Competitor Analysis
- **Automatic competitor discovery** from SERP
- **Domain Authority** estimation
- **Keyword count** per competitor
- **Average position** tracking
- **Best position** achieved
- Click competitor → See all their ranking keywords

### 3. 📊 Page Analysis (Click Competitor)
When you click on a competitor, you get:
- **Word count** of their page
- **Keyword density** percentage
- **Individual keyword word counts**: See count for each word (e.g., "web (15), design (12), company (8)")
- **SEO elements check**:
  - H1 tag present?
  - Meta description?
  - Schema markup with detected types
  - **Page Type detection** (Service, FAQ, Article, LocalBusiness, etc.)
- **Schema Suggestions** with field recommendations
- **Internal/External links** count
- **Domain Authority** score
- **Image optimization** check (alt text)

### 4. ⚖️ Multi-Competitor Analysis
- **Compare multiple domains** side-by-side
- **Benchmark metrics**: Average DA, word count, SEO scores
- **Ranking comparison table**: See who wins in each category
- **Pattern analysis**: Common strengths, weaknesses, opportunities
- **Gap Analysis**: Find what's missing vs competitors

### 5. 📈 Rank Tracking
- **Add your domain** to track
- **Configurable check intervals** (not just 3 AM!)
- **Rank history** for all keywords
- **Position changes** tracking
- **Manual check** option
- **Alerts**: Configurable thresholds (default: 5 position drop, 10 position gain)

### 6. 🚨 Alerts System
- **Rank drop alerts** (configurable threshold)
- **Rank improvement alerts** (configurable threshold)
- **New ranking alerts** (when you start ranking)
- **Lost ranking alerts** (when you lose ranking)
- **Filter by type**
- **Mark as read**
- **Webhook notifications** (Telegram, Discord, Slack)

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        KEYWORD ANALYZER                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  📡 FRONTEND (EJS + CSS + JS)                               │
│  ├── Dashboard                                               │
│  ├── Advanced Keyword Research (with location cascade)        │
│  ├── Competitors                                              │
│  ├── Multi-Competitor Analysis & Gap Analysis                 │
│  ├── Rank Tracking                                           │
│  └── Alerts                                                  │
│                                                              │
│  🖥️ BACKEND (Fastify + Node.js)                             │
│  ├── /api/keywords/*                                         │
│  │   ├── /api/keywords/advanced-research (NEW!)              │
│  │   └── /api/locations                                     │
│  ├── /api/competitors/*                                     │
│  ├── /api/analysis/*                                        │
│  │   ├── /api/analysis/multi-competitor (NEW!)              │
│  │   └── /api/analysis/gap-analysis (NEW!)                  │
│  └── /api/alerts/*                                          │
│                                                              │
│  🔧 SERVICES                                                │
│  ├── keywordService.js                                       │
│  │   ├── Advanced keyword research                            │
│  │   ├── SERP features detection                             │
│  │   ├── Intent analysis                                     │
│  │   └── Schema markup analysis                              │
│  ├── analysisService.js                                      │
│  │   ├── Multi-competitor comparison                         │
│  │   └── Gap analysis                                       │
│  └── rankTracker.js (configurable intervals)                 │
│                                                              │
│  🗄️ DATABASE (PostgreSQL)                                    │
│  ├── keywords                                                │
│  ├── competitors                                             │
│  ├── ranking_pages                                           │
│  ├── my_domains                                              │
│  ├── domain_rankings                                         │
│  ├── rank_history                                            │
│  ├── alerts                                                  │
│  └── analysis_reports                                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Setup Database
```bash
# Create database
createdb keyword_analyzer

# Tables are auto-created on first run
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env with your settings
```

### 4. Start Server
```bash
npm start
# or for development
npm run dev
```

### 5. Open Dashboard
```
http://localhost:3000
```

---

## 📡 API Endpoints

### Keywords
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/keywords/advanced-research` | **NEW!** Advanced keyword research with all features |
| POST | `/api/keywords/research` | Research a keyword (legacy) |
| GET | `/api/keywords` | List all keywords |
| GET | `/api/keywords/:id` | Get keyword details |
| POST | `/api/keywords/suggestions` | Get suggestions |
| GET | `/api/locations` | **NEW!** Get supported locations |
| DELETE | `/api/keywords/:id` | Delete keyword |

### Competitors
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/competitors/analyze` | Analyze competitor page (enhanced) |
| GET | `/api/competitors/keyword/:id` | Get competitors for keyword |
| GET | `/api/competitors/:domain` | Get competitor details |
| POST | `/api/competitors/compare` | Compare competitors |
| GET | `/api/competitors/top` | Get top competitors |

### Analysis
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analysis/multi-competitor` | **NEW!** Compare multiple competitors |
| POST | `/api/analysis/gap-analysis` | **NEW!** Find gaps vs competitors |
| POST | `/api/analysis/compare` | Compare domains |
| POST | `/api/analysis/report` | Generate full report |
| POST | `/api/analysis/page` | Analyze single page |
| POST | `/api/analysis/suggestions` | Get suggestions |
| GET | `/api/analysis/history` | Get analysis history |

### Alerts
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/alerts/track` | Add domain to track |
| GET | `/api/alerts/domains` | Get tracked domains |
| GET | `/api/alerts` | Get all alerts |
| PUT | `/api/alerts/:id/read` | Mark alert as read |
| PUT | `/api/alerts/read-all` | Mark all as read |
| GET | `/api/alerts/rank-history` | Get rank history |
| GET | `/api/alerts/summary` | Get summary |

---

## 🔑 API Keys (All Free)

| Service | Purpose | Free Limit | Required |
|---------|---------|------------|----------|
| Serper.dev | SERP Search | 2,500/day | ✅ Yes |
| OpenPageRank | Domain Authority | 33,000/day | ✅ Yes |
| Google CSE | Backup Search | 100/day | Optional |

---

## 📊 Usage Examples

### Advanced Keyword Research
```bash
curl -X POST http://localhost:3000/api/keywords/advanced-research \
  -H "Content-Type: application/json" \
  -d '{
    "keyword": "web design company in bangalore",
    "location": "Whitefield, Bangalore",
    "includeIntent": true,
    "includeSerpFeatures": true,
    "includeContentGap": true,
    "numResults": 20
  }'
```

### Multi-Competitor Analysis
```bash
curl -X POST http://localhost:3000/api/analysis/multi-competitor \
  -H "Content-Type: application/json" \
  -d '{
    "domains": ["competitor1.com", "competitor2.com", "competitor3.com"],
    "keyword": "web design company in bangalore",
    "location": "India"
  }'
```

### Gap Analysis
```bash
curl -X POST http://localhost:3000/api/analysis/gap-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "myDomain": "mysite.com",
    "competitorDomains": ["competitor1.com", "competitor2.com"],
    "keyword": "web design company"
  }'
```

### Compare Domains
```bash
curl -X POST http://localhost:3000/api/analysis/compare \
  -H "Content-Type: application/json" \
  -d '{
    "myDomain": "mywebsite.com",
    "competitorDomain": "competitor.com",
    "keyword": "web design company",
    "myUrl": "https://mywebsite.com/web-design",
    "competitorUrl": "https://competitor.com/web-design"
  }'
```

### Track Your Domain
```bash
curl -X POST http://localhost:3000/api/alerts/track \
  -H "Content-Type: application/json" \
  -d '{"domain": "mywebsite.com"}'
```

---

## 🎯 Workflow Example

1. **Advanced Research** → Enter "web design company in Whitefield, Bangalore"
2. **View Intent** → See it's Commercial/Transactional (users ready to buy)
3. **Check SERP Features** → Local pack shows, People Also Ask shows
4. **See Content Gaps** → Questions to answer, target word count
5. **Multi-Competitor** → Compare 3 top competitors side-by-side
6. **Gap Analysis** → Find what's missing vs competitors
7. **Click Competitor** → Detailed page analysis with keyword word counts
8. **Track** → Add your domain to monitor rankings
9. **Get Alerts** → When your rank drops or improves

---

## 🛡️ Anti-Detection

- Random User-Agent rotation
- Adaptive rate limiting
- Exponential backoff
- Request delays between searches
- Self-signed certificate support (configurable)

---

## 📈 New Metrics

### Opportunity Score (0-100)
- Volume factor: 30 points max
- Difficulty factor: 25 points max (lower difficulty = higher score)
- Competition factor: 20 points max
- CPC factor: 15 points max
- Intent factor: 10 points max
- SERP feature opportunity: 10 points max

### Keyword Intent Detection
- **Informational**: how, what, why, tutorial, guide → Awareness stage
- **Navigational**: brand names, near me → Loyalty stage
- **Commercial**: best, top, review, vs → Consideration stage
- **Transactional**: buy, price, order → Decision stage

### SERP Features Detected
- Featured Snippet
- People Also Ask (PAA)
- Local Pack
- Image Pack
- Video Results
- Shopping Results
- Knowledge Graph
- Rich Results Opportunity indicator

---

## 🔄 Configurable Rank Tracking

New environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `CHECK_INTERVAL` | 86400 | Seconds between rank checks |
| `WEBHOOK_TIMEOUT` | 5000 | Webhook request timeout (ms) |
| `RANK_DROP_THRESHOLD` | 5 | Positions to trigger drop alert |
| `RANK_IMPROVEMENT_THRESHOLD` | 10 | Positions to trigger improvement |
| `RATE_LIMIT_DELAY` | 3000 | Delay between API calls (ms) |

---

## 📱 Dashboard Features

- **Responsive design** (works on mobile)
- **Location cascade selector**: Country → City → Area
- **Real-time updates**
- **Filter alerts** by type
- **Search keywords**
- **Intent visualization** with breakdown bars
- **SERP feature badges**

---

## 🚀 Deployment

### Docker
```bash
docker-compose up -d
```

### Manual
```bash
# Install PostgreSQL
# Configure .env
npm start
```

---

## 📄 Documentation

For detailed API documentation, see [API.md](./API.md)

---

## 📄 License

ISC

---

**Built with ❤️**
