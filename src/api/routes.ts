import { Hono } from 'hono'
import { runPipeline } from '../pipeline'

type Bindings = { DB: D1Database }

export const api = new Hono<{ Bindings: Bindings }>()

const STALE_MS = 12 * 3600_000

function parseIdea(r: any) {
  return {
    ...r,
    rising: !!r.rising,
    example_keywords: JSON.parse(r.example_keywords || '[]'),
    sample_questions: JSON.parse(r.sample_questions || '[]'),
    sources: JSON.parse(r.sources || '{}'),
    explain: JSON.parse(r.explain || '{}'),
    trend_series: JSON.parse(r.trend_series || '[]'),
    sell_reasons: JSON.parse(r.sell_reasons || '[]'),
    product_idea: JSON.parse(r.product_idea || '{}'),
    cross_formats: JSON.parse(r.cross_formats || '[]')
  }
}

// POST /api/search { seed } -> runs pipeline (cached 12h via seeds table)
api.post('/search', async (c) => {
  const { seed } = await c.req.json<{ seed?: string }>().catch(() => ({ seed: undefined }))
  if (!seed || typeof seed !== 'string') return c.json({ error: 'seed is required' }, 400)
  const result = await runPipeline(seed, c.env.DB)
  return c.json({ seed: seed.trim().toLowerCase(), ...result })
})

// GET /api/search?seed= -> same as POST (convenience)
api.get('/search', async (c) => {
  const seed = c.req.query('seed') ?? ''
  if (!seed.trim()) return c.json({ error: 'seed is required' }, 400)
  const result = await runPipeline(seed, c.env.DB)
  return c.json({ seed: seed.trim().toLowerCase(), ...result })
})

// GET /api/ideas?q=&category=&difficulty=&rising=1&min=60&sort=opportunity&limit=
api.get('/ideas', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const category = c.req.query('category') ?? ''
  const difficulty = c.req.query('difficulty') ?? ''
  const rising = c.req.query('rising') === '1'
  const min = Math.max(0, Math.min(100, parseInt(c.req.query('min') ?? '0', 10) || 0))
  const sort = ['opportunity', 'momentum', 'interest', 'demand', 'sellability', 'updated_at'].includes(c.req.query('sort') ?? '')
    ? c.req.query('sort')!
    : 'opportunity'
  const limit = Math.min(200, Math.max(1, parseInt(c.req.query('limit') ?? '60', 10) || 60))

  const where: string[] = ['opportunity >= ?']
  const params: any[] = [min]
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(seed) LIKE ? OR LOWER(example_keywords) LIKE ?)')
    params.push(`%${q}%`, `%${q}%`, `%${q}%`)
  }
  if (category) {
    where.push('category = ?')
    params.push(category)
  }
  if (difficulty) {
    where.push('difficulty = ?')
    params.push(difficulty)
  }
  if (rising) where.push('rising = 1')

  const rows = await c.env.DB
    .prepare(`SELECT * FROM ideas WHERE ${where.join(' AND ')} ORDER BY ${sort} DESC LIMIT ?`)
    .bind(...params, limit)
    .all()

  return c.json({ count: rows.results.length, ideas: rows.results.map(parseIdea) })
})

// GET /api/ideas/:id -> single idea with favorite state
api.get('/ideas/:id', async (c) => {
  const id = c.req.param('id')
  const row = await c.env.DB.prepare('SELECT * FROM ideas WHERE id = ?').bind(id).first<any>()
  if (!row) return c.json({ error: 'Not found' }, 404)
  const fav = await c.env.DB.prepare('SELECT idea_id FROM favorites WHERE idea_id = ?').bind(id).first()
  return c.json({ idea: { ...parseIdea(row), favorited: !!fav } })
})

// GET /api/trending-words -> which search words/modifiers dominate the mined data.
// Aggregates tokens across all ideas' example keywords + sample questions,
// split into "format" words (marketplace buyer intent) vs topic words.
api.get('/trending-words', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT title, example_keywords, sample_questions, opportunity, sellability, seed, updated_at FROM ideas')
    .all<any>()

  const FORMAT_WORDS = new Set([
    'printable', 'template', 'pdf', 'digital', 'download', 'planner', 'workbook',
    'worksheet', 'checklist', 'tracker', 'bundle', 'kit', 'ebook', 'guide',
    'journal', 'calendar', 'spreadsheet', 'excel', 'notion', 'free'
  ])
  const STOP = new Set(
    'the and for with how what why can are you your from that this into near best top free'.split(' ')
  )

  interface WordStat { word: string; count: number; avgOpp: number; avgSell: number; seeds: Set<string>; isFormat: boolean }
  const stats = new Map<string, WordStat>()

  for (const r of rows.results) {
    const texts: string[] = [r.title, ...JSON.parse(r.example_keywords || '[]'), ...JSON.parse(r.sample_questions || '[]')]
    const words = new Set<string>()
    for (const t of texts) {
      for (const w of String(t).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
        if (w.length > 2 && !STOP.has(w)) words.add(w)
      }
    }
    for (const w of words) {
      if (!stats.has(w)) stats.set(w, { word: w, count: 0, avgOpp: 0, avgSell: 0, seeds: new Set(), isFormat: FORMAT_WORDS.has(w) })
      const s = stats.get(w)!
      s.count++
      s.avgOpp += r.opportunity
      s.avgSell += r.sellability ?? 0
      s.seeds.add(r.seed)
    }
  }

  const out = [...stats.values()]
    .filter((s) => s.count >= 2)
    .map((s) => ({
      word: s.word,
      ideas: s.count,
      seeds: s.seeds.size,
      avgOpportunity: Math.round(s.avgOpp / s.count),
      avgSellability: Math.round(s.avgSell / s.count),
      isFormat: s.isFormat
    }))
    .sort((a, b) => b.ideas - a.ideas)

  return c.json({
    formatWords: out.filter((w) => w.isFormat).slice(0, 15),
    topicWords: out.filter((w) => !w.isFormat).slice(0, 40)
  })
})

// GET /api/trending -> newest + rising ideas (the "Trending Now" feed)
api.get('/trending', async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT * FROM ideas WHERE rising = 1 ORDER BY updated_at DESC LIMIT 24`)
    .all()
  return c.json({ ideas: rows.results.map(parseIdea) })
})

// GET /api/stats -> dashboard header numbers
api.get('/stats', async (c) => {
  const db = c.env.DB
  const ideas = await db.prepare('SELECT COUNT(*) n FROM ideas').first<any>()
  const rising = await db.prepare('SELECT COUNT(*) n FROM ideas WHERE rising = 1').first<any>()
  const seeds = await db.prepare("SELECT COUNT(*) n FROM seeds WHERE status = 'done'").first<any>()
  const cats = await db.prepare('SELECT DISTINCT category c FROM ideas ORDER BY c').all<any>()
  return c.json({
    ideas: ideas?.n ?? 0,
    rising: rising?.n ?? 0,
    seeds: seeds?.n ?? 0,
    categories: cats.results.map((r: any) => r.c)
  })
})

// Favorites (no auth — personal use)
api.post('/ideas/:id/favorite', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('INSERT OR IGNORE INTO favorites (idea_id) VALUES (?)').bind(id).run()
  return c.json({ favorited: true })
})
api.delete('/ideas/:id/favorite', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM favorites WHERE idea_id = ?').bind(id).run()
  return c.json({ favorited: false })
})
api.get('/favorites', async (c) => {
  const rows = await c.env.DB
    .prepare('SELECT i.* FROM ideas i JOIN favorites f ON f.idea_id = i.id ORDER BY f.created_at DESC')
    .all()
  return c.json({ ideas: rows.results.map(parseIdea) })
})

// CSV export (respects same filters as /api/ideas)
api.get('/export.csv', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase()
  const min = Math.max(0, Math.min(100, parseInt(c.req.query('min') ?? '0', 10) || 0))
  const where: string[] = ['opportunity >= ?']
  const params: any[] = [min]
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(seed) LIKE ?)')
    params.push(`%${q}%`, `%${q}%`)
  }
  const rows = await c.env.DB
    .prepare(`SELECT * FROM ideas WHERE ${where.join(' AND ')} ORDER BY opportunity DESC LIMIT 500`)
    .bind(...params)
    .all()

  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = 'title,category,opportunity,sellability,sell_grade,difficulty,interest,momentum,competition,buyer_intent,demand,rising,format,price_min,price_max,seed,updated_at'
  const lines = rows.results.map((r: any) => {
    const p = JSON.parse(r.product_idea || '{}')
    return [
      r.title, r.category, r.opportunity, r.sellability ?? 0, r.sell_grade ?? '', r.difficulty,
      r.interest, r.momentum, r.competition, r.buyer_intent, r.demand, r.rising ? 'yes' : 'no',
      p.format ?? '', p.priceRange?.[0] ?? '', p.priceRange?.[1] ?? '', r.seed, r.updated_at
    ].map(esc).join(',')
  })
  return new Response([header, ...lines].join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pdf-trend-ideas.csv"'
    }
  })
})

// Lazy refresh: stale seeds (>12h) re-run pipeline in background on any browse
api.get('/refresh-stale', async (c) => {
  const cutoff = new Date(Date.now() - STALE_MS).toISOString().slice(0, 19).replace('T', ' ')
  const stale = await c.env.DB
    .prepare(`SELECT keyword FROM seeds WHERE status = 'done' AND fetched_at < ? ORDER BY fetched_at ASC LIMIT 3`)
    .bind(cutoff)
    .all<any>()
  const seeds = stale.results.map((r: any) => r.keyword)
  c.executionCtx.waitUntil(Promise.all(seeds.map((s: string) => runPipeline(s, c.env.DB))))
  return c.json({ refreshing: seeds })
})
