// Opportunity scoring — transparent weighted formula from the plan:
//
// interest     = normalize(google_trends_avg_12mo)                0-100
// momentum     = % change of last-90d trend vs prior-90d          0-100 (rising)
// demand       = normalize(# of distinct real queries found)      0-100
// competition  = 100 - normalize(query crowding + niche breadth)  0-100
// buyer_intent = keyword matches on purchase-intent phrases       0-100
//
// opportunity  = .30*demand + .25*momentum + .20*competition
//              + .15*buyer_intent + .10*interest
//
// Every component is stored in `explain` so the UI can show WHY (the
// differentiator reviewers asked for).

export const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(v)))

const BUYER_PHRASES = [
  'how to',
  'guide',
  'checklist',
  'printable',
  'template',
  'pdf',
  'planner',
  'workbook',
  'tracker',
  'sheet',
  'worksheet',
  'ebook',
  'course',
  'plan',
  'routine',
  'for beginners',
  'step by step',
  'example',
  'sample',
  'free'
]

export interface ScoreInput {
  trendsAvg: number // 0-100 raw trends average
  momentumRaw: number // % change last 90d vs prior 90d (can be negative)
  momentumSource?: 'google_trends' | 'fallback_signals' // transparency for explain
  distinctQueries: number // total distinct suggestions + questions + reddit posts
  clusterSize: number // members of this cluster
  redditEngagement: number // upvotes + 2*comments
  clusterTexts: string[] // texts in this cluster (for buyer intent)
  seed: string // seed keyword — phrases contained in it are excluded from buyer-intent matching
  realVolume?: number // DataForSEO monthly search volume for the seed (0 = unknown)
  realCpc?: number // DataForSEO CPC in USD (commercial value signal)
  youtubeTotalViews?: number // total views across top YouTube videos for the seed
  youtubeTotalResults?: number // how many videos exist for this search
}

export interface ScoreOutput {
  opportunity: number
  difficulty: 'Easy' | 'Medium' | 'Hard'
  interest: number
  momentum: number
  competition: number
  buyerIntent: number
  demand: number
  rising: boolean
  explain: Record<string, string | number>
}

export function computeScores(input: ScoreInput): ScoreOutput {
  const interest = clamp(input.trendsAvg)

  // Map momentum %change: -50% .. +100%  ->  0 .. 100
  const momentum = clamp(((input.momentumRaw + 50) / 150) * 100)

  // Demand: real monthly search volume when DataForSEO is wired in
  // (log scale: 100 → 1M searches/mo), else the query-count proxy.
  let demand: number
  let demandNote: string
  if (input.realVolume && input.realVolume > 0) {
    demand = clamp((Math.log10(1 + input.realVolume) / Math.log10(1 + 1_000_000)) * 100)
    demandNote = `REAL monthly search volume: ${input.realVolume.toLocaleString()} searches (DataForSEO)${input.realCpc ? `, CPC $${input.realCpc.toFixed(2)}` : ''} + ${input.clusterSize} queries in this cluster`
  } else {
    demand = clamp((Math.log10(1 + input.clusterSize) / Math.log10(1 + 60)) * 100)
    demandNote = `${input.clusterSize} distinct real queries in this idea cluster (${input.distinctQueries} total for the seed) across Google Autocomplete + Reddit`
  }
  // YouTube consumption demand lifts the score slightly — people watching
  // how-to videos for this niche are the PDF-guide audience.
  if (input.youtubeTotalViews && input.youtubeTotalViews > 0) {
    const ytBoost = Math.min(10, Math.log10(1 + input.youtubeTotalViews) * 1.5)
    demand = clamp(demand + ytBoost)
    demandNote += ` + YouTube: ${(input.youtubeTotalViews / 1e6).toFixed(1)}M views across top videos`
  }

  // Competition proxy: dominated by cluster breadth (a big cluster = a
  // well-covered sub-topic = harder to rank a new PDF), with a mild global
  // crowding term. Note: raw query count is mostly a *demand* signal, and
  // nearly every seed saturates the expansion (~350 ceiling), so it must
  // not dominate — weight it lightly.
  const crowding = Math.min(1, input.distinctQueries / 350)
  const breadth = Math.min(1, input.clusterSize / 15)
  const competition = clamp(100 - (0.3 * crowding + 0.7 * breadth) * 100)

  // Buyer intent: share of cluster texts containing purchase-intent phrasing.
  // Phrases already contained in the seed are excluded — otherwise a seed like
  // "budget planner" would make every text match "planner" and saturate at 100.
  const phrases = BUYER_PHRASES.filter((p) => !input.seed.includes(p))
  let hits = 0
  for (const t of input.clusterTexts) {
    if (phrases.some((p) => t.includes(p))) hits++
  }
  const buyerIntent = clamp((hits / Math.max(1, input.clusterTexts.length)) * 100 * 1.25)

  const opportunity = clamp(
    0.3 * demand + 0.25 * momentum + 0.2 * competition + 0.15 * buyerIntent + 0.1 * interest
  )

  const difficulty: ScoreOutput['difficulty'] = competition >= 70 ? 'Easy' : competition >= 40 ? 'Medium' : 'Hard'

  return {
    opportunity,
    difficulty,
    interest,
    momentum,
    competition,
    buyerIntent,
    demand,
    rising: input.momentumRaw > 15,
    explain: {
      formula: '0.30*demand + 0.25*momentum + 0.20*competition + 0.15*buyer_intent + 0.10*interest',
      distinctQueries: input.distinctQueries,
      clusterSize: input.clusterSize,
      redditEngagement: input.redditEngagement,
      trendsAvg12mo: Math.round(input.trendsAvg),
      momentumPctChange: Math.round(input.momentumRaw),
      momentumNote:
        input.momentumSource === 'fallback_signals'
          ? 'Momentum estimated from live signals: presence in the global 7-day trend feed, YouTube view velocity, Reddit engagement (Google Trends rate-limited from this IP)'
          : 'Momentum from Google Trends: last 90 days vs prior 90 days',
      demandNote,
      competitionNote:
        competition >= 70
          ? 'Low crowding — few overlapping queries, room for a new PDF guide'
          : competition >= 40
            ? 'Moderate crowding — differentiated angle recommended'
            : 'High crowding — many overlapping queries, competitive niche',
      difficultyRule: 'competition >= 70 = Easy, >= 40 = Medium, else Hard'
    }
  }
}
