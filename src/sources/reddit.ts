// Reddit source — two modes:
//   A) OAuth (when REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET secrets are set):
//      official API, reliable, 100 req/min free tier. Register a "script" app
//      at https://www.reddit.com/prefs/apps to get the credentials.
//   B) Fallback (no keys): public search.json endpoints + pullpush.io mirror.
//      Works but gets rate-limited from datacenter IPs intermittently.
import { fetchJson, mapLimit } from './http'

interface RedditPost {
  title: string
  subreddit: string
  score: number
  numComments: number
}

const PROBLEM_QUERIES = ['how do i {seed}', '{seed} help', 'struggling with {seed}', '{seed} tips', 'best {seed}']

export interface RedditResult {
  questions: string[]
  posts: RedditPost[]
  totalEngagement: number
  mode: 'oauth' | 'fallback'
}

interface RedditKeys {
  redditClientId?: string
  redditClientSecret?: string
  redditUserAgent?: string
}

// --- OAuth mode ---
let cachedToken: { token: string; expiresAt: number } | null = null

async function getRedditToken(keys: RedditKeys): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token
  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${keys.redditClientId}:${keys.redditClientSecret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': keys.redditUserAgent ?? 'PdfTrendLab/1.0'
      },
      body: 'grant_type=client_credentials'
    })
    if (!res.ok) return null
    const data = (await res.json()) as any
    if (!data?.access_token) return null
    cachedToken = { token: data.access_token, expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 }
    return cachedToken.token
  } catch {
    return null
  }
}

async function searchOAuth(seed: string, keys: RedditKeys): Promise<RedditPost[]> {
  const token = await getRedditToken(keys)
  if (!token) return []
  const queries = PROBLEM_QUERIES.map((q) => q.replace('{seed}', seed))
  const results = await mapLimit(queries, 3, async (q) => {
    const url = `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=relevance&limit=12&t=year`
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': keys.redditUserAgent ?? 'PdfTrendLab/1.0' }
      })
      return res.ok ? await res.json() : null
    } catch {
      return null
    }
  })
  return results
    .filter(Boolean)
    .flatMap((data: any) =>
      (data?.data?.children ?? []).map((c: any) => ({
        title: String(c?.data?.title ?? '').trim(),
        subreddit: String(c?.data?.subreddit ?? ''),
        score: Number(c?.data?.score ?? 0),
        numComments: Number(c?.data?.num_comments ?? 0)
      }))
    )
}

// --- Fallback mode (current behavior) ---
const ENDPOINTS = [
  (q: string) => `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&limit=12&t=year`,
  (q: string) => `https://old.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=relevance&limit=12&t=year`,
  (q: string) => `https://api.reddit.com/search?q=${encodeURIComponent(q)}&sort=relevance&limit=12&t=year`
]

async function searchOne(q: string): Promise<RedditPost[]> {
  for (const build of ENDPOINTS) {
    const data = await fetchJson<any>(build(q), 7000)
    const children = data?.data?.children
    if (Array.isArray(children) && children.length) {
      return children.map((c: any) => ({
        title: String(c?.data?.title ?? '').trim(),
        subreddit: String(c?.data?.subreddit ?? ''),
        score: Number(c?.data?.score ?? 0),
        numComments: Number(c?.data?.num_comments ?? 0)
      }))
    }
  }
  return []
}

async function searchPullPush(seed: string): Promise<RedditPost[]> {
  const url = `https://api.pullpush.io/reddit/search/submission/?q=${encodeURIComponent(seed)}&size=25&sort=desc&sort_type=score`
  const data = await fetchJson<any>(url, 9000)
  const items = data?.data ?? []
  if (!Array.isArray(items)) return []
  return items
    .filter((p: any) => p?.title && !p?.over_18)
    .map((p: any) => ({
      title: String(p.title).trim(),
      subreddit: String(p.subreddit ?? ''),
      score: Number(p.score ?? 0),
      numComments: Number(p.num_comments ?? 0)
    }))
}

export async function mineReddit(seed: string, keys: RedditKeys = {}): Promise<RedditResult> {
  let posts: RedditPost[] = []
  let mode: RedditResult['mode'] = 'fallback'

  if (keys.redditClientId && keys.redditClientSecret) {
    try {
      posts = await searchOAuth(seed, keys)
      if (posts.length) mode = 'oauth'
    } catch { /* fall through to fallback */ }
  }

  if (!posts.length) {
    try {
      const results = await mapLimit(PROBLEM_QUERIES.map((q) => q.replace('{seed}', seed)), 3, searchOne)
      posts = results.flat()
      if (!posts.length) posts = await searchPullPush(seed)
    } catch {
      try {
        posts = await searchPullPush(seed)
      } catch { /* give up silently */ }
    }
  }

  // Relevance gate: the pullpush fallback can return off-topic hits
  // (e.g. "budget" matching political news) — require at least one seed token.
  const seedTokens = seed.toLowerCase().split(/\s+/).filter((t) => t.length > 2)
  const seen = new Set<string>()
  const deduped: RedditPost[] = []
  for (const p of posts) {
    if (!p.title || p.title.length < 10 || p.title.length > 200) continue
    const key = p.title.toLowerCase()
    if (seen.has(key)) continue
    if (seedTokens.length && !seedTokens.some((t) => key.includes(t))) continue
    seen.add(key)
    deduped.push(p)
  }

  const QUESTION_RE = /^(how|what|why|can|is|are|when|where|which|who|does|do|should|will|anyone|any)\b/i
  const questions = deduped.filter((p) => QUESTION_RE.test(p.title)).map((p) => p.title)
  const totalEngagement = deduped.reduce((a, p) => a + p.score + p.numComments * 2, 0)

  return { questions: questions.slice(0, 20), posts: deduped.slice(0, 25), totalEngagement, mode }
}
