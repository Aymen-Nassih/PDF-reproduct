// Google Autocomplete source — free, unofficial suggestqueries endpoint.
// Expands a seed with question prefixes + alphabet suffixes (AnswerThePublic-style).
// Falls back to DuckDuckGo autocomplete when Google throttles.
import { fetchJson, mapLimit } from './http'

const QUESTION_PREFIXES = ['how to', 'what is', 'why', 'can', 'is', 'best', 'vs', 'when to']
const ALPHA = 'abcdefghijklmnopqrstuvwxyz'.split('')

async function suggestGoogle(q: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`
  const data = await fetchJson<any>(url, 6000)
  if (!data || !Array.isArray(data[1])) return []
  return data[1] as string[]
}

async function suggestDDG(q: string): Promise<string[]> {
  const url = `https://duckduckgo.com/ac/?q=${encodeURIComponent(q)}&type=list`
  const data = await fetchJson<any>(url, 6000)
  if (!data || !Array.isArray(data[1])) return []
  return data[1] as string[]
}

async function suggest(q: string): Promise<string[]> {
  const g = await suggestGoogle(q)
  if (g.length) return g
  return suggestDDG(q)
}

export interface AutocompleteResult {
  suggestions: string[]
  questions: string[]
}

const QUESTION_RE = /^(how|what|why|can|is|are|when|where|which|who|does|do|should|will)\b/i

export async function expandSeed(seed: string): Promise<AutocompleteResult> {
  const queries = [seed, ...QUESTION_PREFIXES.map((p) => `${p} ${seed}`), ...ALPHA.map((a) => `${seed} ${a}`)]
  // ~35 calls, 6 concurrent — each is a tiny JSON response
  const batches = await mapLimit(queries, 6, (q) => suggest(q))

  const all = new Set<string>()
  for (const list of batches) {
    for (const s of list) {
      const clean = s.trim().toLowerCase()
      if (clean && clean.length > 3 && clean.length < 120) all.add(clean)
    }
  }
  const suggestions = [...all]
  const questions = suggestions.filter((s) => QUESTION_RE.test(s))
  return { suggestions, questions }
}
