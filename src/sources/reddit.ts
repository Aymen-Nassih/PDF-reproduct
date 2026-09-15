// Reddit source — public search JSON endpoints, no OAuth needed for read-only search.
// Pulls problem statements ("how do I", "struggling with", ...) across reddit.
// Falls back across endpoints because reddit rate-limits datacenter IPs aggressively.
import { fetchJson, fetchText, mapLimit } from './http'

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
}

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

// Fallback when reddit blocks datacenter IPs: pull question-like posts via
// the pushshift-style public pullpush.io mirror (read-only, no auth).
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

export async function mineReddit(seed: string): Promise<RedditResult> {
  let posts: RedditPost[] = []
  try {
    const results = await mapLimit(PROBLEM_QUERIES.map((q) => q.replace('{seed}', seed)), 3, searchOne)
    posts = results.flat()
    if (!posts.length) posts = await searchPullPush(seed)
  } catch {
    try {
      posts = await searchPullPush(seed)
    } catch { /* give up silently */ }
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

  return { questions: questions.slice(0, 20), posts: deduped.slice(0, 25), totalEngagement }
}
