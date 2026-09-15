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
    trend_series: JSON.parse(r.trend_series || '[]')
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
  const sort = ['opportunity', 'momentum', 'interest', 'demand', 'updated_at'].includes(c.req.query('sort') ?? '')
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
  const header = 'title,category,opportunity,difficulty,interest,momentum,competition,buyer_intent,demand,rising,seed,updated_at'
  const lines = rows.results.map((r: any) =>
    [r.title, r.category, r.opportunity, r.difficulty, r.interest, r.momentum, r.competition, r.buyer_intent, r.demand, r.rising ? 'yes' : 'no', r.seed, r.updated_at].map(esc).join(',')
  )
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
