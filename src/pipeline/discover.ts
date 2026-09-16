// Discover pipeline v2 — market-data-driven.
// Every global trend is probed against live search engines (Google + Bing
// autocomplete) and its PDF potential is computed from MEASURED analytics:
//   - search breadth  = how many distinct real searches contain the term
//   - questions       = real questions people ask about it
//   - buyer formats   = "printable/template/pdf/…" demand confirmed by BOTH engines
// Small residual weights: evergreen niche match + multi-platform presence.
// News/celebrity/sports patterns get demoted because they don't sell PDFs.
import { fetchAllGlobal, type GlobalTrend } from '../sources/global'
import { mapLimit } from '../sources/http'
import { googleSuggest, bingSuggest, youtubeSuggest, ebaySuggest } from '../sources/suggest'
import { fetchYouTubeMostPopular } from '../sources/youtube'
import type { ApiKeys } from '../sources/keys'
import { FORMAT_KEYWORDS } from './market'

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)))

async function hashId(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// Patterns that almost never convert into sellable PDF guides
const NEWSY = [
  /\b(dies|died|dead|death|killed|shooting|shot|arrest|arrested|charged|verdict|trial|lawsuit|sued)\b/,
  /\b(football|nfl|nba|mlb|nhl|soccer|match|score|playoffs?|super bowl|world cup)\b/,
  /\b(trump|biden|harris|election|senate|congress|impeach|indict)\b/,
  /\b(trailer|episode|season \d|box office|concert|tour dates?)\b/
]

const EVERGREEN = [
  /\b(recipes?|cooking|baking|meal|diet|keto|vegan|weight loss|fitness|workout|yoga)\b/,
  /\b(money|budget|saving|debt|invest|credit|tax|retire|side hustle|passive income)\b/,
  /\b(wedding|baby|pregnancy|parenting|toddler|homeschool|kids activities?)\b/,
  /\b(garden|plants?|clean(ing)?|organiz|declutter|diy|crafts?|crochet|knit|sew)\b/,
  /\b(dog|puppy|cat|pet|training|grooming)\b/,
  /\b(resume|job interview|career|small business|etsy|shopify|marketing)\b/,
  /\b(mental health|anxiety|sleep|meditation|habit|journal|self care|adhd|autism)\b/,
  /\b(travel|camping|hiking|rv|road trip|itinerary)\b/,
  /\b(excel|notion|spreadsheet|template|planner|printable)\b/,
  /\b(learn|course|tutorial|guide|beginner|language|piano|guitar|drawing)\b/
]

const QUESTION_RE = /^(how|what|why|can|is|are|when|where|which|who|does|do|should|will)\b/i

export interface TrendMetrics {
  probed: boolean
  breadth: number // distinct real searches containing the term (google+bing, deduped)
  questionCount: number
  buyerFormats: string[] // format words confirmed by BOTH engines
  googleSuggestions: string[]
  bingSuggestions: string[]
  questions: string[]
  youtubeSuggestions: string[] // real YouTube searches for this term
  ebaySuggestions: string[] // real eBay purchase searches for this term
}

async function probeTrend(term: string): Promise<TrendMetrics> {
  const [g, b, yt, eb] = await Promise.all([
    googleSuggest(term),
    bingSuggest(term),
    youtubeSuggest(term),
    ebaySuggest(term)
  ])
  const all = [...new Set([...g, ...b])].filter((s) => s.includes(term.split(' ')[0]))
  const gFormats = FORMAT_KEYWORDS.filter((f) => g.some((s) => s.includes(f)))
  const bFormats = FORMAT_KEYWORDS.filter((f) => b.some((s) => s.includes(f)))
  const buyerFormats = gFormats.filter((f) => bFormats.includes(f))
  const questions = all.filter((s) => QUESTION_RE.test(s)).slice(0, 6)
  return {
    probed: true,
    breadth: all.length,
    questionCount: all.filter((s) => QUESTION_RE.test(s)).length,
    buyerFormats,
    googleSuggestions: g.slice(0, 6),
    bingSuggestions: b.slice(0, 6),
    questions,
    youtubeSuggestions: yt.slice(0, 6),
    ebaySuggestions: eb.slice(0, 6)
  }
}

const UNPROBED: TrendMetrics = {
  probed: false,
  breadth: 0,
  questionCount: 0,
  buyerFormats: [],
  googleSuggestions: [],
  bingSuggestions: [],
  questions: [],
  youtubeSuggestions: [],
  ebaySuggestions: []
}

interface Entry {
  term: string
  source: GlobalTrend['source']
  sources: GlobalTrend['source'][]
  traffic?: string
  url?: string
  metrics: TrendMetrics
  score: number
  reasons: string[]
  lastSeen?: string | null // preserved from prior sightings for week-window aging
}

function scoreFromMetrics(e: Entry): void {
  const m = e.metrics
  const reasons: string[] = []

  // Residual signals (small weight now)
  const multiScore = Math.min(100, (e.sources.length - 1) * 50)
  if (e.sources.length > 1) reasons.push(`Trending on ${e.sources.length} platforms at once (${e.sources.join(' + ')})`)
  const evergreenScore = EVERGREEN.some((re) => re.test(e.term)) ? 100 : 0
  if (evergreenScore) reasons.push('Evergreen niche — people routinely buy guides/templates here')

  let score: number
  if (m.probed) {
    // MEASURED market analytics carry 90% of the score
    const buyerScore = Math.min(100, m.buyerFormats.length * 20)
    const breadthScore = Math.min(100, (m.breadth / 15) * 100)
    const questionScore = Math.min(100, m.questionCount * 25)
    const ytScore = Math.min(100, m.youtubeSuggestions.length * 20)
    const ebayScore = Math.min(100, m.ebaySuggestions.length * 34)

    reasons.unshift(`${m.breadth} distinct real searches found across Google + Bing`)
    if (m.buyerFormats.length)
      reasons.push(`Buyer demand verified on BOTH engines: "${e.term}" + ${m.buyerFormats.slice(0, 5).join(' / ')}`)
    else reasons.push('No printable/template/pdf demand detected on either engine')
    if (m.questionCount) reasons.push(`${m.questionCount} real questions people ask (e.g. "${m.questions[0] ?? ''}")`)
    if (m.youtubeSuggestions.length)
      reasons.push(`YouTube search demand (${m.youtubeSuggestions.length} matches, e.g. "${m.youtubeSuggestions[0]}")`)
    if (m.ebaySuggestions.length)
      reasons.push(`eBay purchase-search demand (${m.ebaySuggestions.length} matches, e.g. "${m.ebaySuggestions[0]}")`)

    // Verified trends are marked +30 so they always outrank unprobed preliminary
    // scores — real market data beats guesses. (Score clamps at 100.)
    const verifiedBoost = m.buyerFormats.length > 0 ? 30 : 0
    score =
      verifiedBoost +
      0.35 * buyerScore +
      0.25 * breadthScore +
      0.12 * questionScore +
      0.1 * ytScore +
      0.08 * ebayScore +
      0.1 * evergreenScore +
      0.05 * multiScore
  } else {
    // Not market-probed this refresh — preliminary score, capped low so
    // market-verified trends always outrank it.
    reasons.push('Not market-probed yet — score is preliminary (refresh to deepen)')
    score = Math.min(39, 0.6 * evergreenScore + 0.4 * multiScore + (e.traffic ? 8 : 0))
  }

  if (e.traffic) reasons.push(`Platform volume: ${e.traffic}`)

  if (NEWSY.some((re) => re.test(e.term))) {
    score *= 0.5
    reasons.push('News/celebrity/sports pattern — low evergreen PDF demand (demoted)')
  }

  e.score = clamp(score)
  e.reasons = reasons
}

// Probe ONE trend on demand ("Probe market data" button) — returns metrics,
// recomputed score and reasons without running a full refresh.
export async function probeSingleTrend(
  term: string,
  sources: string[],
  traffic?: string
): Promise<{ metrics: TrendMetrics; score: number; reasons: string[] }> {
  const e: Entry = {
    term,
    source: (sources[0] as GlobalTrend['source']) ?? 'google',
    sources: sources as GlobalTrend['source'][],
    traffic,
    url: undefined,
    metrics: UNPROBED,
    score: 0,
    reasons: []
  }
  e.metrics = await probeTrend(term)
  scoreFromMetrics(e)
  return { metrics: e.metrics, score: e.score, reasons: e.reasons }
}

export async function refreshGlobalTrends(
  db: D1Database,
  keys: ApiKeys = {}
): Promise<{ fetched: number; stored: number; probed: number }> {
  // Snapshot start time — rows not refreshed by this run are stale trends and get pruned
  const refreshStart = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const all = await fetchAllGlobal()

  // With a YouTube Data API key, pull the TRUE trending chart (mostPopular)
  // — richer and more reliable than scraping search pages
  if (keys.youtubeApiKey) {
    const popular = await fetchYouTubeMostPopular(keys.youtubeApiKey).catch(() => [])
    for (const v of popular) {
      all.push({
        term: v.title.toLowerCase(),
        source: 'youtube',
        traffic: `${(v.views / 1e6).toFixed(1)}M views`,
        url: v.url
      })
    }
  }

  // 7-day persistence merge: trends that were seen within the last week but
  // missing from THIS fetch get carried over with their stored metrics —
  // this is what makes X/Twitter (and all current-feed sources) effectively
  // "last 7 days" instead of "last snapshot".
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const normKey = (term: string) => term.replace(/[^a-z0-9\s#]/g, ' ').replace(/\s+/g, ' ').trim()
  const freshKeys = new Set(all.map((t) => normKey(t.term)).filter(Boolean))
  const storedRecent = await db
    .prepare(`SELECT * FROM trends WHERE last_seen >= ?`)
    .bind(weekAgo)
    .all<any>()
  // Map stored rows by normalized key — used to preserve previously-probed
  // market metrics for trends that aren't re-probed this cycle.
  const storedByKey = new Map<string, any>()
  for (const r of storedRecent.results) storedByKey.set(normKey(String(r.term)), r)
  for (const r of storedRecent.results) {
    const key = normKey(String(r.term))
    if (freshKeys.has(key)) continue // already in this fetch — will be upserted
    all.push({
      term: String(r.term),
      source: r.source as GlobalTrend['source'],
      traffic: r.traffic ?? undefined,
      url: (JSON.parse(r.extra || '{}') as any).url ?? undefined
    })
  }

  // Group by normalized term across sources
  const groups = new Map<string, { rep: GlobalTrend; sources: Set<GlobalTrend['source']> }>()
  for (const t of all) {
    const key = t.term.replace(/[^a-z0-9\s#]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!key || key.length < 3 || key.length > 90) continue
    if (!groups.has(key)) groups.set(key, { rep: t, sources: new Set() })
    const g = groups.get(key)!
    g.sources.add(t.source)
    if (!g.rep.traffic && t.traffic) g.rep = t
  }

  const entries: Entry[] = [...groups.values()].map((g) => {
    const stored = storedByKey.get(normKey(g.rep.term))
    const storedMetrics = stored ? (JSON.parse(stored.metrics || '{}') as TrendMetrics) : null
    const storedSources: string[] = stored ? (JSON.parse(stored.extra || '{}') as any).sources ?? [] : []
    return {
      term: g.rep.term,
      source: g.rep.source,
      // Merge sources from prior sightings (week persistence) with this fetch
      sources: [...new Set([...g.sources, ...storedSources])] as GlobalTrend['source'][],
      traffic: g.rep.traffic ?? stored?.traffic ?? undefined,
      url: g.rep.url,
      // Preserve previously-probed market metrics unless re-probed below
      metrics: storedMetrics?.probed ? storedMetrics : UNPROBED,
      score: 0,
      reasons: [],
      lastSeen: stored?.last_seen ?? null
    }
  })

  // Market-probe the most promising terms. Evergreen niches and how-to-shaped
  // phrases get priority — those are the ones that can actually have buyer
  // demand. Celebrity/news terms (common among multi-platform trends) are
  // deprioritized; probing them wastes subrequests. Capped at 40 terms.
  // Already-probed entries keep their stored metrics — no re-probe needed.
  const priority = (e: Entry) => {
    let p = 0
    if (EVERGREEN.some((re) => re.test(e.term))) p += 4
    if (/^(how to|what is|best|learn)\b/.test(e.term)) p += 3
    if (e.sources.length > 1) p += 2
    if (NEWSY.some((re) => re.test(e.term))) p -= 3
    const words = e.term.split(/\s+/).length
    if (words >= 2 && words <= 4) p += 1
    return p
  }
  const toProbe = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => !e.metrics.probed)
    .sort((a, b) => priority(b.e) - priority(a.e))
    .slice(0, 40)

  await mapLimit(toProbe, 5, async ({ e }) => {
    e.metrics = await probeTrend(e.term)
  })

  for (const e of entries) scoreFromMetrics(e)
  entries.sort((a, b) => b.score - a.score)

  let stored = 0
  for (const e of entries) {
    const id = await hashId([...e.sources].sort().join('+') + ':' + e.term)
    // Carried-over (not freshly-fetched) trends keep their ORIGINAL last_seen so
    // they age out of the 7-day window; fresh sightings reset the clock.
    const lastSeen = e.lastSeen ?? null
    await db
      .prepare(
        `INSERT INTO trends (id, term, source, traffic, pdf_potential, reasons, extra, metrics, buyer_formats, first_seen, last_seen, seen_count)
         VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'), 1)
         ON CONFLICT(id) DO UPDATE SET
           traffic=excluded.traffic, pdf_potential=excluded.pdf_potential, reasons=excluded.reasons,
           extra=excluded.extra, metrics=excluded.metrics, buyer_formats=excluded.buyer_formats,
           last_seen=CASE WHEN ? IS NULL THEN datetime('now') ELSE last_seen END,
           seen_count=seen_count+1`
      )
      .bind(
        id,
        e.term,
        e.source,
        e.traffic ?? null,
        e.score,
        JSON.stringify(e.reasons),
        JSON.stringify({ url: e.url ?? null, sources: e.sources }),
        JSON.stringify(e.metrics),
        e.metrics.buyerFormats.length,
        lastSeen
      )
      .run()
    stored++
  }

  // Prune anything older than the 7-day window (and anything from before this
  // run that wasn't carried over)
  await db.prepare('DELETE FROM trends WHERE last_seen < ?').bind(weekAgo).run()

  return { fetched: all.length, stored, probed: toProbe.length }
}
