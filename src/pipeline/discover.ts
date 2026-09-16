// Discover pipeline v2 — market-data-driven.
// Every global trend is probed against live search engines (Google + Bing
// autocomplete) and its PDF potential is computed from MEASURED analytics:
//   - search breadth  = how many distinct real searches contain the term
//   - questions       = real questions people ask about it
//   - buyer formats   = "printable/template/pdf/…" demand confirmed by BOTH engines
// Small residual weights: evergreen niche match + multi-platform presence.
// News/celebrity/sports patterns get demoted because they don't sell PDFs.
import { fetchAllGlobal, type GlobalTrend } from '../sources/global'
import { fetchJson, mapLimit } from '../sources/http'
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
}

async function googleSuggest(q: string): Promise<string[]> {
  const data = await fetchJson<any>(
    `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`,
    5000
  )
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s).toLowerCase()) : []
}

async function bingSuggest(q: string): Promise<string[]> {
  const data = await fetchJson<any>(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`, 5000)
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s).toLowerCase()) : []
}

async function probeTrend(term: string): Promise<TrendMetrics> {
  const [g, b] = await Promise.all([googleSuggest(term), bingSuggest(term)])
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
    questions
  }
}

const UNPROBED: TrendMetrics = {
  probed: false,
  breadth: 0,
  questionCount: 0,
  buyerFormats: [],
  googleSuggestions: [],
  bingSuggestions: [],
  questions: []
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
    // MEASURED market analytics carry 85% of the score
    const buyerScore = Math.min(100, m.buyerFormats.length * 20)
    const breadthScore = Math.min(100, (m.breadth / 15) * 100)
    const questionScore = Math.min(100, m.questionCount * 25)

    reasons.unshift(`${m.breadth} distinct real searches found across Google + Bing`)
    if (m.buyerFormats.length)
      reasons.push(`Buyer demand verified on BOTH engines: "${e.term}" + ${m.buyerFormats.slice(0, 5).join(' / ')}`)
    else reasons.push('No printable/template/pdf demand detected on either engine')
    if (m.questionCount) reasons.push(`${m.questionCount} real questions people ask (e.g. "${m.questions[0] ?? ''}")`)

    // Verified trends are marked +30 so they always outrank unprobed preliminary
    // scores — real market data beats guesses. (Score clamps at 100.)
    const verifiedBoost = m.buyerFormats.length > 0 ? 30 : 0
    score = verifiedBoost + 0.4 * buyerScore + 0.3 * breadthScore + 0.15 * questionScore + 0.1 * evergreenScore + 0.05 * multiScore
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

export async function refreshGlobalTrends(db: D1Database): Promise<{ fetched: number; stored: number; probed: number }> {
  // Snapshot start time — rows not refreshed by this run are stale trends and get pruned
  const refreshStart = new Date().toISOString().slice(0, 19).replace('T', ' ')
  const all = await fetchAllGlobal()

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

  const entries: Entry[] = [...groups.values()].map((g) => ({
    term: g.rep.term,
    source: g.rep.source,
    sources: [...g.sources],
    traffic: g.rep.traffic,
    url: g.rep.url,
    metrics: UNPROBED,
    score: 0,
    reasons: []
  }))

  // Market-probe the most promising terms (multi-source + evergreen first).
  // Capped to stay inside Worker subrequest budgets (40 terms × 2 engines).
  const priority = (e: Entry) =>
    (e.sources.length > 1 ? 2 : 0) + (EVERGREEN.some((re) => re.test(e.term)) ? 1 : 0)
  const toProbe = entries
    .map((e, i) => ({ e, i }))
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
    await db
      .prepare(
        `INSERT INTO trends (id, term, source, traffic, pdf_potential, reasons, extra, metrics, buyer_formats, first_seen, last_seen, seen_count)
         VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), datetime('now'), 1)
         ON CONFLICT(id) DO UPDATE SET
           traffic=excluded.traffic, pdf_potential=excluded.pdf_potential, reasons=excluded.reasons,
           extra=excluded.extra, metrics=excluded.metrics, buyer_formats=excluded.buyer_formats,
           last_seen=datetime('now'), seen_count=seen_count+1`
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
        e.metrics.buyerFormats.length
      )
      .run()
    stored++
  }

  // Prune trends that disappeared from all sources (they kept old scores
  // and would otherwise pollute the ranking with stale data)
  await db.prepare('DELETE FROM trends WHERE last_seen < ?').bind(refreshStart).run()

  return { fetched: all.length, stored, probed: toProbe.length }
}
