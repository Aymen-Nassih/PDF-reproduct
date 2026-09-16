// Shared autocomplete suggest clients — Google, Bing, YouTube, eBay.
// These are the "what do people actually search" primitives used by both
// the seed pipeline (sellability) and the global Discover probe.
import { fetchJson, fetchText } from './http'

function parseJsonp(text: string): any | null {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start + 1, end))
  } catch {
    return null
  }
}

export async function googleSuggest(q: string): Promise<string[]> {
  const data = await fetchJson<any>(
    `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(q)}`,
    5000
  )
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s).toLowerCase()) : []
}

export async function bingSuggest(q: string): Promise<string[]> {
  const data = await fetchJson<any>(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(q)}`, 5000)
  return Array.isArray(data?.[1]) ? data[1].map((s: any) => String(s).toLowerCase()) : []
}

export async function youtubeSuggest(q: string): Promise<string[]> {
  const text = await fetchText(
    `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(q)}`,
    5000
  )
  if (!text) return []
  const list = parseJsonp(text)?.[1]
  if (!Array.isArray(list)) return []
  return list.map((s: any) => String(Array.isArray(s) ? s[0] : s).toLowerCase())
}

export async function ebaySuggest(q: string): Promise<string[]> {
  const text = await fetchText(`https://autosug.ebay.com/autosug?kwd=${encodeURIComponent(q)}&sId=0`, 5000)
  if (!text) return []
  const list = parseJsonp(text)?.res?.sug
  if (!Array.isArray(list)) return []
  return list.map((s: any) => String(s).toLowerCase())
}
