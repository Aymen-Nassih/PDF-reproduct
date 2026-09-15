// Bing autocomplete source — free osjson endpoint, very permissive.
// Used as a SECOND search engine: a buyer-intent keyword confirmed by both
// Google and Bing is a much stronger demand signal than either alone.
import { fetchJson, mapLimit } from './http'

const PREFIXES = ['how to', 'what is', 'best', 'free', 'printable', 'template', 'pdf', 'digital']

async function suggest(q: string): Promise<string[]> {
  const url = `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`
  const data = await fetchJson<any>(url, 6000)
  if (!data || !Array.isArray(data[1])) return []
  return data[1] as string[]
}

export interface BingResult {
  suggestions: string[]
}

export async function expandSeedBing(seed: string): Promise<BingResult> {
  // 9 calls — prefixes chosen to surface purchase/format intent
  const queries = [seed, ...PREFIXES.map((p) => `${p} ${seed}`), ...PREFIXES.map((p) => `${seed} ${p}`)]
  const batches = await mapLimit(queries, 6, (q) => suggest(q))

  const all = new Set<string>()
  for (const list of batches) {
    for (const s of list) {
      const clean = String(s).trim().toLowerCase()
      if (clean && clean.length > 3 && clean.length < 120) all.add(clean)
    }
  }
  return { suggestions: [...all] }
}
