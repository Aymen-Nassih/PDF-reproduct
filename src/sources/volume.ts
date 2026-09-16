// DataForSEO — keyword metrics API. ~$0.05 per 1,000 keywords (labs/live).
// Unlocks REAL search volumes + competition indices for seed keywords —
// replacing the query-count demand proxy with hard numbers.
import { fetchText } from './http'

export interface VolumeMetrics {
  searchVolume: number // monthly searches (0 if unknown)
  cpc: number // cost per click, USD (commercial value signal)
  competition: number // 0-1 paid competition index
  ok: boolean
}

export async function probeSearchVolume(
  keywords: string[],
  login: string,
  password: string
): Promise<Map<string, VolumeMetrics>> {
  const out = new Map<string, VolumeMetrics>()
  if (!keywords.length) return out
  try {
    const res = await fetch(
      'https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live',
      {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + btoa(`${login}:${password}`),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([
          {
            keywords: keywords.slice(0, 20),
            location_name: 'United States',
            language_name: 'English'
          }
        ])
      }
    )
    if (!res.ok) return out
    const data = (await res.json()) as any
    const items = data?.tasks?.[0]?.result ?? []
    for (const item of items) {
      if (!item?.keyword) continue
      out.set(String(item.keyword).toLowerCase(), {
        searchVolume: Number(item.search_volume ?? 0),
        cpc: Number(item.cpc ?? 0),
        competition: Number(item.competition_index ?? item.competition ?? 0),
        ok: true
      })
    }
  } catch {
    /* no key / network error → empty map, callers degrade gracefully */
  }
  return out
}
