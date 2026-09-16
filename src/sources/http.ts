// Shared fetch helper with timeout + browser-like UA (Google/Reddit block default workers UA)
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export async function fetchText(url: string, timeoutMs = 8000, userAgent = UA): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': userAgent,
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

export async function fetchJson<T = any>(url: string, timeoutMs = 8000, userAgent = UA): Promise<T | null> {
  const text = await fetchText(url, timeoutMs, userAgent)
  if (!text) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

// Concurrency-limited map (Workers isolate has no thread pool; keep it gentle)
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
