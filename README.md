# PDF Trend Lab

A self-hosted clone of "PDF Trend Lab" — a trending-topic / problem-discovery tool that surfaces
real questions people search for, clusters them into PDF-guide ideas, and scores each idea for
**opportunity, difficulty, competition, interest, momentum and buyer intent**.

Two modes:
1. **Dashboard (seed mode)** — you enter a niche seed; the engine mines it.
2. **Discover (global mode)** — no seed needed: the app pulls what's trending worldwide across
   Google Trends, X/Twitter, Hacker News, Wikipedia, GitHub and Google News, scores each trend for
   PDF-guide potential, and lets you one-click **Mine this trend** into the full seed pipeline.

Built for personal use. No paid APIs required.

## Project Overview
- **Goal**: type a niche seed keyword → get scored PDF-guide ideas backed by real search behavior
- **Stack**: Hono (TypeScript) on Cloudflare Pages + D1 (SQLite) + vanilla JS frontend (Tailwind CDN, Chart.js, Axios)
- **Cost**: $0 — all data sources are free public endpoints

## How it works (the core loop)
```
seed keyword
  → expand: Google Autocomplete (seed + question prefixes + a–z suffixes; DuckDuckGo fallback)
           + Bing autocomplete (buyer-intent prefixes: printable/template/pdf/digital…)
  → enrich: Google Trends (pytrends-style widget/token flow over HTTP) + Reddit search (pullpush.io fallback)
  → cluster: token-Jaccard agglomerative clustering (seed tokens excluded from similarity)
  → score: opportunity = 0.30·demand + 0.25·momentum + 0.20·competition + 0.15·buyer_intent + 0.10·interest
  → market: sellability score (cross-engine format-keyword confirmation + buyer intent + audience fit)
           + concrete PDF product idea (format, price range, audience, title suggestions, marketplace links)
  → store in D1 (12h freshness cache per seed, lazy refresh on browse)
```
Every score component is stored in `ideas.explain` / `ideas.sell_reasons` and shown in UI tooltips — the "why" is transparent.

### Sellability (will it actually sell?)
Sellability = format-keyword demand across TWO engines (Google + Bing, 40pts)
+ cross-engine confirmed format words like `printable/template/pdf/digital` (25pts)
+ buyer-intent carry-over (20pts) + clear buyer audience (15pts).
Grades: A ≥ 70 "Strong seller", B ≥ 50 "Likely seller", C ≥ 30 "Niche bet", else "Research more".

### Trending Search Words (`/api/trending-words`, nav → Trend Words)
Aggregates every word across all mined ideas, split into **format words**
(what PDF buyers type: printable, template, workbook…) and **topic words**,
each with idea count, spread across seeds, avg opportunity and avg sellability.

### Score definitions
| Score | Meaning |
|---|---|
| interest | Avg Google Trends interest, trailing 12 months (0–100) |
| momentum | Last-90d trend vs prior-90d (>15% growth ⇒ "Rising" pill) |
| demand | Distinct real queries in the idea cluster, log-scaled |
| competition | Inverse of query crowding + cluster breadth (higher = easier) |
| buyer intent | Share of queries matching `how to / guide / checklist / printable / template…` (seed phrases excluded) |
| difficulty | competition ≥ 70 → Easy, ≥ 40 → Medium, else Hard |

## URLs
- **Local dev**: http://localhost:3000
- **Production**: not deployed yet (see Deployment)

## API endpoints
| Method | Path | Description |
|---|---|---|
| POST | `/api/search` | `{ "seed": "budget planner" }` — run the full pipeline (cached 12h) |
| GET | `/api/ideas` | Filters: `q, category, difficulty, rising=1, min, sort, limit` |
| GET | `/api/ideas/:id` | Single idea + favorite state |
| GET | `/api/trending` | Rising ideas, newest first |
| GET | `/api/trending-words` | Format + topic word analytics across all ideas |
| GET | `/api/stats` | Dashboard header numbers |
| POST/DELETE | `/api/ideas/:id/favorite` | Save / unsave (no auth — personal use) |
| GET | `/api/favorites` | Saved ideas |
| GET | `/api/export.csv` | CSV export (respects `q`, `min`) |
| GET | `/api/refresh-stale` | Lazy-refresh seeds older than 12h (background, waitUntil) |
| GET | `/api/discover?source=&min=&q=&verified=1` | Global trends with live market metrics (auto-refreshes if >30 min stale) |
| POST | `/api/discover/refresh` | Force re-fetch + market-probe of all global trend sources |
| POST | `/api/trends/:id/probe` | On-demand market probe (Google/Bing/YouTube/eBay) for one trend |

### Discover scoring is market-data-driven
Every global trend is **probed live against Google + Bing autocomplete** and scored from measured
analytics — not guesses:
- **buyer formats (40%)** — `printable/template/pdf/digital/…` demand confirmed on BOTH engines
- **search breadth (30%)** — count of distinct real searches containing the term
- **questions (15%)** — real question searches ("how to…", "what is…")
- **evergreen niche (10%)** + **multi-platform presence (5%)** — small residual signals
- News/celebrity/sports patterns are demoted ×0.5 (they don't sell PDFs)
- Trends with verified buyer demand get +30 so they always outrank unprobed preliminary scores
  (preliminary scores are capped at 39); each card shows the actual searches found
- Stale trends (gone from all sources) are pruned every refresh — the feed is always current

## Global discovery sources (Discover mode)
| Source | What it gives | Notes |
|---|---|---|
| Google Trends | Trending-now searches + traffic (`10k+`) | official RSS |
| X/Twitter | Trending hashtags/topics | via trends24 mirror (no free X API exists) |
| YouTube | Most-viewed videos this week (how-to/tutorial/guide queries) | search pages, server-side data + view counts |
| Hacker News | Front-page tech topics + points | Algolia API |
| Wikipedia | Most-viewed articles + view counts | pageviews API (~1–2 day publish lag) |
| GitHub | Repos created this week, by stars | search API |
| Stack Overflow | Hot questions (developer pain points) | official API |
| Apple Podcasts | Top 25 shows (media demand) | official charts feed |
| Medium | Latest articles in 4 evergreen tags | RSS feeds |
| Google News | Top stories | RSS |
| Amazon | *(deep-links only)* | pages are JS-rendered shells server-side |
| Pinterest / TikTok / Product Hunt / Quora / LinkedIn | *(blocked)* | 403/401 from datacenter IPs; no keyless API — documented, not silently skipped |

### Market probes run everywhere
- **Per trend (Discover)**: Google + Bing + **YouTube** + **eBay** autocomplete — search breadth,
  real questions, cross-engine buyer formats, video demand, commerce demand. Top 40 trends probed
  per refresh (evergreen/how-to prioritized); any trend can be probed on demand via
  `POST /api/trends/:id/probe` ("Probe market data" button on unprobed cards).
- **Per seed (Dashboard)**: sellability now includes YouTube search demand (+8) and eBay
  purchase-search demand (+7) alongside Google/Bing format demand.

Each trend's **PDF potential** score: multi-platform presence (trending on 2+ sources at once) +
topic-phrase shape + search volume + evergreen-niche match + live autocomplete probe (do buyers
append `printable/template/pdf` to this term?) − news/celebrity/sports penalty. Hover any score for
the full reason list.

## Data model (D1)
- `seeds(keyword, status, fetched_at)` — freshness cache + pipeline lock
- `ideas(id, title, seed, category, opportunity, difficulty, interest, momentum, competition, buyer_intent, demand, rising, cluster_size, example_keywords[], sample_questions[], sources{}, explain{}, trend_series[], sellability, sell_grade, sell_reasons[], product_idea{}, cross_formats[], updated_at)`
- `favorites(idea_id, created_at)`

## User guide
1. Enter a niche seed (e.g. `dog training`, `budget planner`, `menopause`) → **Discover Ideas**
2. Browse idea cards — hover any badge for the score explanation
3. Filter by category, difficulty, rising-only, min opportunity; sort by any score
4. Click an idea → trend chart, example keywords, real questions, Reddit pain points
5. **Generate PDF Outline** → algorithmic chapter outline from real questions → Print / Save as PDF
6. Star ideas to favorites; export everything to CSV

## Optional API keys (drop-in upgrades)
All features work without keys. Adding any of these as Worker secrets (Deploy panel) or in
`.dev.vars` locally upgrades the corresponding data source — no code changes, features light up
automatically. Check which are live via `GET /api/keys/status` (booleans only, values never exposed).
See `.dev.vars.example` for step-by-step registration instructions.

| Secret(s) | Unlocks | Cost |
|---|---|---|
| `YOUTUBE_API_KEY` | True trending videos (mostPopular) in Discover; view-count demand in seed scores | Free (10k units/day) |
| `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | Reliable Reddit mining via official OAuth API | Free (100 req/min) |
| `SERPER_API_KEY` | People-Also-Ask question clusters + related searches merged into clustering | ~$0.001/query |
| `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | REAL monthly search volumes + CPC in demand scores | ~$0.05/1k keywords |

## Not yet implemented / known limitations
- **Google Trends + Reddit are rate-limited from datacenter IPs** (429/403) without keys — they
  degrade gracefully. Reddit has an official OAuth path now (free, see above); Trends historical
  data lights up with a Serper key or from friendlier IPs.
- **Etsy/Amazon SERP scraping is IP-blocked** — instead, sellability uses cross-engine format-keyword
  confirmation, and each product idea ships marketplace search deep-links for manual competition checks
- Search-volume estimates (DataForSEO) not wired — demand is currently a query-count proxy
- LLM-written outline text (outline structure is algorithmic; plug in any LLM API later)
- Auth/multi-user (single-user by design)

## Deployment
- **Platform**: Cloudflare Pages (Hono + D1, hosted-deploy compatible: no KV, no cron triggers)
- **Status**: ⏳ Not yet deployed
- Deploy commands: `npm run build` → `wrangler pages deploy dist` (D1 migrations:
  `npm run db:migrate:prod` after creating the production database)

## Development
```bash
npm install
npm run build
npm run db:migrate:local
pm2 start ecosystem.config.cjs   # wrangler pages dev dist --d1=pdftrendlab-production --local --port 3000
```

Last updated: 2026-09-15
