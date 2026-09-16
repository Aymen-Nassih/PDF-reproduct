// Serper.dev — Google SERP scraping API. ~$0.001/query, $50 = 50k credits.
// Unlocks: People-Also-Ask question clusters + related searches per seed —
// the highest-quality "what do people actually need" data available.
import { fetchJson } from './http'

export interface SerperResult {
  peopleAlsoAsk: string[] // real PAA question clusters
  relatedSearches: string[] // Google's related-search suggestions
  organicCount: number // how many organic results (competition proxy)
  ok: boolean
}

export async function probeSerper(seed: string, apiKey: string): Promise<SerperResult> {
  const empty: SerperResult = { peopleAlsoAsk: [], relatedSearches: [], organicCount: 0, ok: false }
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: seed, gl: 'us', hl: 'en', num: 10 })
    })
    if (!res.ok) return empty
    const data = (await res.json()) as any
    const peopleAlsoAsk = (data?.peopleAlsoAsk ?? [])
      .map((q: any) => String(q?.question ?? '').trim().toLowerCase())
      .filter(Boolean)
    const relatedSearches = (data?.relatedSearches ?? [])
      .map((r: any) => String(r?.query ?? '').trim().toLowerCase())
      .filter(Boolean)
    const organicCount = Array.isArray(data?.organic) ? data.organic.length : 0
    return { peopleAlsoAsk, relatedSearches, organicCount, ok: true }
  } catch {
    return empty
  }
}
