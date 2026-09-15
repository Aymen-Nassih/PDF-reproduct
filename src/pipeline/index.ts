// Core engine: seed -> expand -> cluster -> score -> store.
// The whole "product" loop from the plan, Worker-compatible.
import { expandSeed } from '../sources/autocomplete'
import { expandSeedBing } from '../sources/bing'
import { getTrends } from '../sources/trends'
import { mineReddit } from '../sources/reddit'
import { clusterTexts, tokenize } from './clustering'
import { computeScores } from './scoring'
import { analyzeMarket, computeSellability, generateProductIdea } from './market'

export interface IdeaRow {
  id: string
  title: string
  seed: string
  category: string
  opportunity: number
  difficulty: string
  interest: number
  momentum: number
  competition: number
  buyer_intent: number
  demand: number
  rising: number
  cluster_size: number
  example_keywords: string
  sample_questions: string
  sources: string
  explain: string
  trend_series: string
  sellability: number
  sell_grade: string
  sell_reasons: string
  product_idea: string
  cross_formats: string
}

async function hashId(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

const CATEGORY_HINTS: [RegExp, string][] = [
  [/dog|puppy|cat|pet|horse|fish|reptile/, 'Pets & Animals'],
  [/keto|diet|weight|fitness|workout|yoga|muscle|menopause|sleep|anxiety|health|nutrition|meal/, 'Health & Fitness'],
  [/money|budget|invest|crypto|stock|debt|save|finance|passive income|side hustle|tax/, 'Money & Finance'],
  [/baby|toddler|kid|child|parent|homeschool|teen|pregnancy/, 'Parenting & Family'],
  [/recipe|cook|bake|coffee|sourdough|vegan|air fryer|meal prep/, 'Food & Cooking'],
  [/resume|job|career|interview|freelance|business|marketing|etsy|shopify|notion/, 'Career & Business'],
  [/garden|plant|home|clean|organiz|declutter|diy|craft|crochet|knit|sew/, 'Home & Crafts'],
  [/travel|camp|hike|rv|van life|backpack/, 'Travel & Outdoors'],
  [/wedding|party|event|birthday|holiday|christmas/, 'Events & Holidays'],
  [/learn|study|language|piano|guitar|code|excel|draw|photography/, 'Skills & Learning'],
  [/relationship|dating|wedding plan|self care|journal|habit|productivity|adhd|autism/, 'Self-Improvement'],
  [/game|minecraft|fortnite|anime|movie|book|music/, 'Entertainment']
]

function categorize(members: string[], centroidTokens: string[]): string {
  // Score every category across all cluster members; first match wins ties.
  const haystack = members.join(' ') + ' ' + centroidTokens.join(' ')
  let bestCat = 'General'
  let bestHits = 0
  for (const [re, cat] of CATEGORY_HINTS) {
    // NOTE: match() needs the global flag — without it only the first match
    // is returned, every category ties at 1, and first-listed wins.
    const hits = (haystack.match(new RegExp(re.source, 'g')) ?? []).length
    if (hits > bestHits) {
      bestHits = hits
      bestCat = cat
    }
  }
  return bestCat
}

const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(And|Or|For|To|In|On|With|A|An|The|Of|Vs)\b/g, (w) => w.toLowerCase())

function titleFrom(members: string[], centroidTokens: string[], seed: string): string {
  // Pick the most representative real query: highest overlap with centroid
  // tokens, ties broken toward shorter (punchier) titles.
  const centroid = new Set(centroidTokens.slice(0, 6))
  let best = members[0] ?? seed
  let bestScore = -1
  for (const m of members) {
    const overlap = tokenize(m).filter((t) => centroid.has(t)).length
    const score = overlap - m.length / 500
    if (score > bestScore) {
      bestScore = score
      best = m
    }
  }
  const titled = titleCase(best)
  return titled.length > 70 ? titled.slice(0, 67) + '…' : titled
}

export async function runPipeline(seed: string, db: D1Database): Promise<{ ideas: number; error?: string }> {
  const cleanSeed = seed.trim().toLowerCase()
  if (cleanSeed.length < 2 || cleanSeed.length > 60) return { ideas: 0, error: 'Invalid seed' }

  // Deduplicate concurrent work
  const existing = await db.prepare('SELECT status, fetched_at FROM seeds WHERE keyword = ?').bind(cleanSeed).first<any>()
  if (existing?.status === 'processing') return { ideas: 0, error: 'Already processing — try again in a minute' }
  const isFresh = existing?.fetched_at && Date.now() - new Date(existing.fetched_at + 'Z').getTime() < 12 * 3600_000
  if (isFresh) return { ideas: 0, error: 'Fresh data already exists' }

  await db
    .prepare(
      `INSERT INTO seeds (keyword, status, fetched_at) VALUES (?, 'processing', datetime('now'))
       ON CONFLICT(keyword) DO UPDATE SET status='processing', error=NULL, fetched_at=datetime('now')`
    )
    .bind(cleanSeed)
    .run()

  try {
    // 1. Pull all sources in parallel
    const [ac, trends, reddit, bing] = await Promise.all([
      expandSeed(cleanSeed),
      getTrends(cleanSeed),
      mineReddit(cleanSeed),
      expandSeedBing(cleanSeed)
    ])

    const allTexts = [...new Set([...ac.suggestions, ...reddit.posts.map((p) => p.title.toLowerCase())])]
    const distinctQueries = allTexts.length + (trends.ok ? trends.risingQueries.length : 0)

    // Market signals for the whole seed (format-keyword demand across engines)
    const marketSeed = analyzeMarket(cleanSeed, ac.suggestions, bing.suggestions, ac.suggestions)

    // 2. Cluster into ideas — seed tokens are excluded from similarity
    // (they appear in nearly every suggestion and would merge all clusters)
    const clusters = clusterTexts(allTexts, 0.4, tokenize(cleanSeed))
      .filter((c) => c.members.length >= 2)
      .sort((a, b) => b.members.length - a.members.length)
      .slice(0, 40)

    // 3. Score + persist each cluster
    let stored = 0
    for (const cluster of clusters) {
      const texts = cluster.members
      const scores = computeScores({
        trendsAvg: trends.ok ? trends.avgInterest : 25,
        momentumRaw: trends.ok ? trends.momentumRaw : 0,
        distinctQueries,
        clusterSize: cluster.members.length,
        redditEngagement: reddit.totalEngagement,
        clusterTexts: texts,
        seed: cleanSeed
      })

      const title = titleFrom(cluster.members, cluster.centroidTokens, cleanSeed)
      const id = await hashId(cleanSeed + ':' + cluster.centroidTokens.slice(0, 4).join(':'))

      // Market-intent for THIS cluster + sellability + concrete PDF product idea
      const market = analyzeMarket(cleanSeed, ac.suggestions, bing.suggestions, texts)
      const sell = computeSellability(market, texts, scores.demand, scores.buyerIntent)
      const product = generateProductIdea(title, texts, market)

      const sampleQuestions = texts.filter((t) => /^(how|what|why|can|is|are|when|where|which|should)\b/.test(t)).slice(0, 8)
      const exampleKeywords = cluster.centroidTokens
        .slice(0, 8)
        .map((t) => `${t} ${cleanSeed.split(' ')[0]}`.trim())

      const row: IdeaRow = {
        id,
        title,
        seed: cleanSeed,
        category: categorize(cluster.members, cluster.centroidTokens),
        opportunity: scores.opportunity,
        difficulty: scores.difficulty,
        interest: scores.interest,
        momentum: scores.momentum,
        competition: scores.competition,
        buyer_intent: scores.buyerIntent,
        demand: scores.demand,
        rising: scores.rising ? 1 : 0,
        cluster_size: cluster.members.length,
        example_keywords: JSON.stringify(exampleKeywords),
        sample_questions: JSON.stringify(sampleQuestions.length ? sampleQuestions : texts.slice(0, 6)),
        sources: JSON.stringify({
          autocomplete: ac.suggestions.length,
          autocompleteQuestions: ac.questions.length,
          bingSuggestions: bing.suggestions.length,
          redditPosts: reddit.posts.length,
          redditQuestions: reddit.questions.length,
          trendsOk: trends.ok,
          redditSample: reddit.posts.slice(0, 6)
        }),
        explain: JSON.stringify(scores.explain),
        trend_series: JSON.stringify(trends.series),
        sellability: sell.score,
        sell_grade: sell.grade,
        sell_reasons: JSON.stringify(sell.reasons),
        product_idea: JSON.stringify(product),
        cross_formats: JSON.stringify(market.crossEngineFormats)
      }

      await db
        .prepare(
          `INSERT INTO ideas (id, title, seed, category, opportunity, difficulty, interest, momentum,
             competition, buyer_intent, demand, rising, cluster_size, example_keywords, sample_questions,
             sources, explain, trend_series, sellability, sell_grade, sell_reasons, product_idea,
             cross_formats, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))
           ON CONFLICT(id) DO UPDATE SET
             title=excluded.title, opportunity=excluded.opportunity, difficulty=excluded.difficulty,
             interest=excluded.interest, momentum=excluded.momentum, competition=excluded.competition,
             buyer_intent=excluded.buyer_intent, demand=excluded.demand, rising=excluded.rising,
             cluster_size=excluded.cluster_size, example_keywords=excluded.example_keywords,
             sample_questions=excluded.sample_questions, sources=excluded.sources,
             explain=excluded.explain, trend_series=excluded.trend_series,
             sellability=excluded.sellability, sell_grade=excluded.sell_grade,
             sell_reasons=excluded.sell_reasons, product_idea=excluded.product_idea,
             cross_formats=excluded.cross_formats, updated_at=datetime('now')`
        )
        .bind(
          row.id, row.title, row.seed, row.category, row.opportunity, row.difficulty, row.interest,
          row.momentum, row.competition, row.buyer_intent, row.demand, row.rising, row.cluster_size,
          row.example_keywords, row.sample_questions, row.sources, row.explain, row.trend_series,
          row.sellability, row.sell_grade, row.sell_reasons, row.product_idea, row.cross_formats
        )
        .run()
      stored++
    }

    // Ideas belonging to this seed but no longer produced -> leave them; freshness handled by updated_at
    await db
      .prepare(`UPDATE seeds SET status='done', fetched_at=datetime('now') WHERE keyword = ?`)
      .bind(cleanSeed)
      .run()

    return { ideas: stored }
  } catch (e: any) {
    await db
      .prepare(`UPDATE seeds SET status='error', error=? WHERE keyword = ?`)
      .bind(String(e?.message ?? e), cleanSeed)
      .run()
    return { ideas: 0, error: String(e?.message ?? e) }
  }
}
