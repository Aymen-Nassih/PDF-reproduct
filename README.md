# PDF Trend Lab

A self-hosted clone of "PDF Trend Lab" — a trending-topic / problem-discovery tool that surfaces
real questions people search for, clusters them into PDF-guide ideas, and scores each idea for
**opportunity, difficulty, competition, interest, momentum and buyer intent**.

Built for personal use. No paid APIs required.

## Project Overview
- **Goal**: type a niche seed keyword → get scored PDF-guide ideas backed by real search behavior
- **Stack**: Hono (TypeScript) on Cloudflare Pages + D1 (SQLite) + vanilla JS frontend (Tailwind CDN, Chart.js, Axios)
- **Cost**: $0 — all data sources are free public endpoints

## How it works (the core loop)
```
seed keyword
  → expand: Google Autocomplete (seed + question prefixes + a–z suffixes; DuckDuckGo fallback)
  → enrich: Google Trends (pytrends-style widget/token flow over HTTP) + Reddit search (pullpush.io fallback)
  → cluster: token-Jaccard agglomerative clustering (seed tokens excluded from similarity)
  → score: opportunity = 0.30·demand + 0.25·momentum + 0.20·competition + 0.15·buyer_intent + 0.10·interest
  → store in D1 (12h freshness cache per seed, lazy refresh on browse)
```
Every score component is stored in `ideas.explain` and shown in UI tooltips — the "why" is transparent.

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
| GET | `/api/stats` | Dashboard header numbers |
| POST/DELETE | `/api/ideas/:id/favorite` | Save / unsave (no auth — personal use) |
| GET | `/api/favorites` | Saved ideas |
| GET | `/api/export.csv` | CSV export (respects `q`, `min`) |
| GET | `/api/refresh-stale` | Lazy-refresh seeds older than 12h (background, waitUntil) |

## Data model (D1)
- `seeds(keyword, status, fetched_at)` — freshness cache + pipeline lock
- `ideas(id, title, seed, category, opportunity, difficulty, interest, momentum, competition, buyer_intent, demand, rising, cluster_size, example_keywords[], sample_questions[], sources{}, explain{}, trend_series[], updated_at)`
- `favorites(idea_id, created_at)`

## User guide
1. Enter a niche seed (e.g. `dog training`, `budget planner`, `menopause`) → **Discover Ideas**
2. Browse idea cards — hover any badge for the score explanation
3. Filter by category, difficulty, rising-only, min opportunity; sort by any score
4. Click an idea → trend chart, example keywords, real questions, Reddit pain points
5. **Generate PDF Outline** → algorithmic chapter outline from real questions → Print / Save as PDF
6. Star ideas to favorites; export everything to CSV

## Not yet implemented / known limitations
- **Google Trends + Reddit are rate-limited from datacenter IPs** (429/403 in the sandbox) — they
  degrade gracefully (interest/momentum default to neutral; no crash). On a residential IP or via a
  proxy/SerpAPI key they light up fully. Code paths are live and ready.
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
