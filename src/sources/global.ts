// Global trend sources — what the WORLD is searching/talking about right now,
// no seed required. All free, keyless endpoints (verified reachable).
import { fetchText, fetchJson, mapLimit } from './http'

export interface GlobalTrend {
  term: string
  source:
    | 'google'
    | 'twitter'
    | 'hackernews'
    | 'wikipedia'
    | 'github'
    | 'googlenews'
    | 'youtube'
    | 'applepodcasts'
    | 'stackoverflow'
    | 'medium'
  traffic?: string
  url?: string
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
}

// --- Google Trends "Trending Now" RSS (daily search trends, with traffic) ---
export async function fetchGoogleTrendsNow(): Promise<GlobalTrend[]> {
  const xml = await fetchText('https://trends.google.com/trending/rss?geo=US', 9000)
  if (!xml) return []
  const out: GlobalTrend[] = []
  const items = xml.split('<item>').slice(1)
  for (const item of items.slice(0, 40)) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    const traffic = item.match(/<ht:approx_traffic>([\s\S]*?)<\/ht:approx_traffic>/)?.[1]
    if (title) {
      out.push({
        term: xmlUnescape(title).trim().toLowerCase(),
        source: 'google',
        traffic: traffic ? xmlUnescape(traffic).trim() : undefined,
        url: item.match(/<link>([\s\S]*?)<\/link>/)?.[1]
      })
    }
  }
  return out
}

// --- X/Twitter trending topics via trends24 mirror (read-only scrape) ---
export async function fetchTwitterTrends(): Promise<GlobalTrend[]> {
  const html = await fetchText('https://trends24.in/united-states/', 9000)
  if (!html) return []
  const out: GlobalTrend[] = []
  const seen = new Set<string>()
  // trend names are embedded as twitter.com/search?q= links
  const re = /twitter\.com\/search\?q=([^"&<]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < 40) {
    const term = decodeURIComponent(m[1]).replace(/^%23/, '#').trim()
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    out.push({ term: key.replace(/^#/, ''), source: 'twitter', url: `https://twitter.com/search?q=${m[1]}` })
  }
  return out
}

// --- Hacker News front page (tech market) ---
export async function fetchHackerNews(): Promise<GlobalTrend[]> {
  const data = await fetchJson<any>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=25', 8000)
  const hits = data?.hits ?? []
  return hits
    .filter((h: any) => h?.title)
    .map((h: any) => ({
      term: String(h.title).toLowerCase(),
      source: 'hackernews' as const,
      traffic: `${h.points ?? 0} pts`,
      url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`
    }))
}

// --- Wikipedia most-viewed articles (global curiosity) ---
// Pageview data publishes with a lag — walk back up to 3 days until we hit data.
// Wikimedia API policy: browser-spoof UAs get 403; a descriptive UA is required.
const WIKIMEDIA_UA = 'PdfTrendLab/1.0 (https://pdftrendlab.app; trend-research; contact: admin@pdftrendlab.app)'

export async function fetchWikipediaTop(): Promise<GlobalTrend[]> {
  for (let back = 1; back <= 3; back++) {
    const now = new Date(Date.now() - back * 86400000)
    const y = now.getUTCFullYear()
    const mo = String(now.getUTCMonth() + 1).padStart(2, '0')
    const d = String(now.getUTCDate()).padStart(2, '0')
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/${y}/${mo}/${d}`
    const data = await fetchJson<any>(url, 9000, WIKIMEDIA_UA)
    const articles = data?.items?.[0]?.articles ?? []
    if (!articles.length) continue
    const SKIP = /^(Main_Page|Special:|Wikipedia:|File:|Portal:|Help:|Talk:|Category:|Template:)/i
    return articles
      .filter((a: any) => a?.article && !SKIP.test(a.article))
      .slice(0, 30)
      .map((a: any) => ({
        term: String(a.article).replace(/_/g, ' ').toLowerCase(),
        source: 'wikipedia' as const,
        traffic: `${(a.views / 1000).toFixed(0)}k views`,
        url: `https://en.wikipedia.org/wiki/${a.article}`
      }))
  }
  return []
}

// --- GitHub trending repos (tech market) — search API, repos created last week by stars ---
export async function fetchGitHubTrending(): Promise<GlobalTrend[]> {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
  const url = `https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=20`
  const data = await fetchJson<any>(url, 9000)
  const items = data?.items ?? []
  return items
    .filter((r: any) => r?.full_name)
    .map((r: any) => ({
      term: `${r.full_name}`.toLowerCase(),
      source: 'github' as const,
      traffic: `${r.stargazers_count ?? 0} ★`,
      url: r.html_url
    }))
}

// --- Google News top stories (general media pulse) ---
export async function fetchGoogleNews(): Promise<GlobalTrend[]> {
  const xml = await fetchText('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', 9000)
  if (!xml) return []
  const out: GlobalTrend[] = []
  const items = xml.split('<item>').slice(1)
  for (const item of items.slice(0, 25)) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]
    if (title) {
      // strip " - Publisher" suffix
      const clean = xmlUnescape(title).replace(/\s+-\s+[^-]+$/, '').trim().toLowerCase()
      if (clean) out.push({ term: clean, source: 'googlenews', url: item.match(/<link>([\s\S]*?)<\/link>/)?.[1] })
    }
  }
  return out
}

// --- YouTube: most-viewed videos this week for high-intent queries ---
// (The /feed/trending page returns an empty personalized shell for anonymous
// datacenter clients; search results pages carry full server-side data.)
// sp=CAMSBAgCEAE = uploaded this week + sorted by view count.
const YT_QUERIES = ['how to', 'tutorial', 'beginner guide']

function parseYouTubeSearch(html: string): GlobalTrend[] {
  const start = html.indexOf('var ytInitialData = ')
  if (start < 0) return []
  const i = start + 'var ytInitialData = '.length
  const jsonEnd = html.indexOf(';</script>', i)
  if (jsonEnd < 0) return []
  try {
    const data = JSON.parse(html.slice(i, jsonEnd))
    const out: GlobalTrend[] = []
    const seen = new Set<string>()
    const stack: any[] = [data]
    while (stack.length && out.length < 15) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (Array.isArray(node)) {
        stack.push(...node)
        continue
      }
      const vr = node.videoRenderer
      if (vr?.videoId && vr?.title?.runs?.[0]?.text) {
        const title = String(vr.title.runs[0].text).toLowerCase().trim()
        if (title.length > 8 && !seen.has(title)) {
          seen.add(title)
          const views = vr.viewCountText?.simpleText ?? vr.shortViewCountText?.simpleText ?? ''
          out.push({
            term: title,
            source: 'youtube',
            traffic: views || undefined,
            url: `https://www.youtube.com/watch?v=${vr.videoId}`
          })
        }
      }
      for (const k of Object.keys(node)) stack.push(node[k])
    }
    return out
  } catch {
    return []
  }
}

export async function fetchYouTubeTrending(): Promise<GlobalTrend[]> {
  const results = await mapLimit(YT_QUERIES, 2, async (q) => {
    const html = await fetchText(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAMSBAgCEAE%253D`,
      10000
    )
    return html ? parseYouTubeSearch(html) : []
  })
  return results.flat()
}

// --- Apple Podcasts top shows (media demand signal) ---
export async function fetchApplePodcasts(): Promise<GlobalTrend[]> {
  const data = await fetchJson<any>(
    'https://rss.applemarketingtools.com/api/v2/us/podcasts/top/25/podcasts.json',
    8000
  )
  const results = data?.feed?.results ?? []
  return results
    .filter((r: any) => r?.name)
    .map((r: any) => ({
      term: String(r.name).toLowerCase(),
      source: 'applepodcasts' as const,
      traffic: r.artistName ? `by ${r.artistName}` : undefined,
      url: r.url
    }))
}

// --- Stack Overflow hot questions (developer pain points) ---
export async function fetchStackOverflow(): Promise<GlobalTrend[]> {
  const data = await fetchJson<any>(
    'https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=20&filter=withbody',
    8000
  )
  const items = data?.items ?? []
  return items
    .filter((q: any) => q?.title)
    .map((q: any) => ({
      term: xmlUnescape(String(q.title)).toLowerCase(),
      source: 'stackoverflow' as const,
      traffic: `${q.score ?? 0} pts · ${q.answer_count ?? 0} answers`,
      url: q.link
    }))
}

// --- Medium topic feeds (what people read about) ---
const MEDIUM_TAGS = ['productivity', 'personal-finance', 'self-improvement', 'technology']

export async function fetchMedium(): Promise<GlobalTrend[]> {
  const results = await mapLimit(MEDIUM_TAGS, 2, async (tag) => {
    const xml = await fetchText(`https://medium.com/feed/tag/${tag}`, 8000)
    if (!xml) return [] as GlobalTrend[]
    const out: GlobalTrend[] = []
    const items = xml.split('<item>').slice(1, 8)
    for (const item of items) {
      const title = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]
      if (title) {
        out.push({
          term: xmlUnescape(title).trim().toLowerCase(),
          source: 'medium' as const,
          url: item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim()
        })
      }
    }
    return out
  })
  return results.flat()
}

export async function fetchAllGlobal(): Promise<GlobalTrend[]> {
  const [google, twitter, hn, wiki, gh, news, youtube, podcasts, stackoverflow, medium] = await Promise.all([
    fetchGoogleTrendsNow().catch(() => []),
    fetchTwitterTrends().catch(() => []),
    fetchHackerNews().catch(() => []),
    fetchWikipediaTop().catch(() => []),
    fetchGitHubTrending().catch(() => []),
    fetchGoogleNews().catch(() => []),
    fetchYouTubeTrending().catch(() => []),
    fetchApplePodcasts().catch(() => []),
    fetchStackOverflow().catch(() => []),
    fetchMedium().catch(() => [])
  ])
  return [...google, ...twitter, ...hn, ...wiki, ...gh, ...news, ...youtube, ...podcasts, ...stackoverflow, ...medium]
}
