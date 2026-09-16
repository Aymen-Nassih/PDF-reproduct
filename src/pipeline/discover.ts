// Discover pipeline: global trends -> dedupe across sources -> PDF-potential
// score -> top candidates probed against autocomplete for buyer-format demand.
import { fetchAllGlobal, type GlobalTrend } from '../sources/global'
import { fetchJson, mapLimit } from '../sources/http'
import { FORMAT_KEYWORDS } from './market'

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)))

async function hashId(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

// Patterns that almost never convert into sellable PDF guides:
// breaking news, celebrity names, sports fixtures, tickers, hashtags-as-events
const LOW_PDF = [
  /\b(dies|died|dead|death|killed|shooting|shot|arrest|arrested|charged|verdict|trial|lawsuit|sued)\b/,
  /\b(football|nfl|nba|mlb|nhl|soccer|match|score|playoffs?|super bowl|world cup|vs\.?)\b/,
  /\b(trump|biden|harris|election|senate|congress|impeach|indict)\b/,
  /\b(iphone|android|trailer|movie|film|episode|season \d|netflix|spotify|concert|tour dates?)\b/,
  /\b(stock|stocks|nasdaq|dow jones|s&p|earnings|ticker)\b/,
  /^(who|what|when|where|why|how|is|did|does)\b.{0,60}\??$/ // raw news questions
]

// Evergreen topic hints — things people routinely buy guides/templates for
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

interface Scored {
  term: string
  source: GlobalTrend['source']
  sources: GlobalTrend['source'][]
  traffic?: string
  url?: string
  score: number
  reasons: string[]
}

function heuristic(t: GlobalTrend, allSources: GlobalTrend['source'][]): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 30

  const extraSources = allSources.length - 1
  if (extraSources > 0) {
    score += Math.min(30, extraSources * 15)
    reasons.push(`Trending on ${allSources.length} platforms simultaneously (${allSources.join(', ')})`)
  }

  const words = t.term.split(/\s+/).filter(Boolean).length
  if (words >= 2 && words <= 4) {
    score += 15
    reasons.push('Multi-word topic phrase — good PDF-guide shape')
  } else if (words === 1) {
    score += 5
  } else if (words > 7) {
    score -= 10
  }

  if (t.traffic) {
    const num = parseInt(t.traffic.replace(/[^0-9]/g, ''), 10) || 0
    if (t.source === 'google' && num >= 10000) {
      score += 10
      reasons.push(`High Google search volume: ${t.traffic} searches`)
    } else if (t.source === 'google' && num >= 2000) {
      score += 6
      reasons.push(`Google search volume: ${t.traffic} searches`)
    }
    if (t.source === 'hackernews' && num >= 200) {
      score += 5
      reasons.push(`Hot on Hacker News (${t.traffic})`)
    }
    if (t.source === 'wikipedia' && num >= 100) {
      score += 5
      reasons.push(`Heavy Wikipedia readership (${t.traffic})`)
    }
  }

  if (EVERGREEN.some((re) => re.test(t.term))) {
    score += 20
    reasons.push('Evergreen niche — people routinely buy guides/templates here')
  }
  if (LOW_PDF.some((re) => re.test(t.term))) {
    score -= 25
    reasons.push('News/celebrity/event pattern — low evergreen PDF potential')
  }

  return { score: clamp(score), reasons }
}

// Probe autocomplete once per term: do buyers append format words to it?
async function probeFormatDemand(term: string): Promise<{ hits: number; formats: string[] }> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(term)}`
  const data = await fetchJson<any>(url, 5000)
  const suggestions: string[] = Array.isArray(data?.[1]) ? data[1] : []
  const formats = FORMAT_KEYWORDS.filter((f) => suggestions.some((s) => String(s).toLowerCase().includes(f)))
  return { hits: formats.length, formats }
}

export async function refreshGlobalTrends(db: D1Database): Promise<{ fetched: number; stored: number }> {
  const all = await fetchAllGlobal()

  // Group by normalized term, tracking every source it appeared on
  const groups = new Map<string, { rep: GlobalTrend; sources: Set<GlobalTrend['source']> }>()
  for (const t of all) {
    const key = t.term.replace(/[^a-z0-9\s#]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!key || key.length < 3 || key.length > 90) continue
    if (!groups.has(key)) groups.set(key, { rep: t, sources: new Set() })
    groups.get(key)!.sources.add(t.source)
    // Prefer the rep that carries traffic info
    if (!groups.get(key)!.rep.traffic && t.traffic) groups.get(key)!.rep = t
  }

  // Heuristic scoring
  const scored: Scored[] = [...groups.values()].map((g) => {
    const srcs = [...g.sources]
    const h = heuristic(g.rep, srcs)
    return { term: g.rep.term, source: g.rep.source, sources: srcs, traffic: g.rep.traffic, url: g.rep.url, ...h }
  })
  scored.sort((a, b) => b.score - a.score)

  // Autocomplete format-probe on the top 12 candidates only (cheap, high value)
  await mapLimit(scored.slice(0, 12), 4, async (s) => {
    const probe = await probeFormatDemand(s.term)
    if (probe.hits > 0) {
      s.score = clamp(s.score + Math.min(20, probe.hits * 5))
      s.reasons.push(`Buyers already search "${s.term}" + ${probe.formats.slice(0, 4).join('/')} (Google Autocomplete)`)
    }
  })

  // Upsert
  let stored = 0
  for (const s of scored) {
    const id = await hashId([...s.sources].sort().join('+') + ':' + s.term)
    await db
      .prepare(
        `INSERT INTO trends (id, term, source, traffic, pdf_potential, reasons, extra, first_seen, last_seen, seen_count)
         VALUES (?,?,?,?,?,?,?, datetime('now'), datetime('now'), 1)
         ON CONFLICT(id) DO UPDATE SET
           traffic=excluded.traffic, pdf_potential=excluded.pdf_potential, reasons=excluded.reasons,
           extra=excluded.extra, last_seen=datetime('now'), seen_count=seen_count+1`
      )
      .bind(
        id,
        s.term,
        s.source,
        s.traffic ?? null,
        s.score,
        JSON.stringify(s.reasons),
        JSON.stringify({ url: s.url ?? null, sources: s.sources })
      )
      .run()
    stored++
  }
  return { fetched: all.length, stored }
}
