// Google Trends source — replicates pytrends' two-step widget/token flow
// over plain HTTP (no Node deps, Worker-safe).
import { fetchText, fetchJson } from './http'

interface TrendsResult {
  series: number[] // weekly interest 0-100, trailing ~12 months
  avgInterest: number
  momentumRaw: number // slope of last 90d vs prior 90d
  risingQueries: string[]
  ok: boolean
}

function extractJson(raw: string): any | null {
  // Trends responses are prefixed with ")]}'" — strip first line
  const idx = raw.indexOf('\n')
  const body = idx >= 0 ? raw.slice(idx + 1) : raw
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

export async function getTrends(keyword: string): Promise<TrendsResult> {
  const empty: TrendsResult = { series: [], avgInterest: 0, momentumRaw: 0, risingQueries: [], ok: false }
  try {
    // Step 1: explore -> widgets + request tokens
    const req = {
      comparisonItem: [{ keyword, geo: '', time: 'today 12-m' }],
      category: 0,
      property: ''
    }
    const exploreUrl =
      'https://trends.google.com/trends/api/explore?hl=en-US&tz=0&req=' + encodeURIComponent(JSON.stringify(req))
    const exploreRaw = await fetchText(exploreUrl, 9000)
    if (!exploreRaw) return empty
    const explore = extractJson(exploreRaw)
    const widgets: any[] = explore?.widgets ?? []

    const widgetOf = (id: string) => widgets.find((w) => w.id === id)
    const timeWidget = widgetOf('TIMESERIES')
    const relatedWidget = widgetOf('RELATED_QUERIES')

    const jobs: Promise<void>[] = []
    let series: number[] = []
    let risingQueries: string[] = []

    if (timeWidget) {
      const url =
        'https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=0&req=' +
        encodeURIComponent(JSON.stringify(timeWidget.request)) +
        '&token=' +
        encodeURIComponent(timeWidget.token)
      jobs.push(
        fetchText(url, 9000).then((raw) => {
          if (!raw) return
          const data = extractJson(raw)
          const rows = data?.default?.timelineData ?? []
          series = rows.map((r: any) => Number(r?.value?.[0] ?? 0))
        })
      )
    }

    if (relatedWidget) {
      const url =
        'https://trends.google.com/trends/api/widgetdata/relatedsearches?hl=en-US&tz=0&req=' +
        encodeURIComponent(JSON.stringify(relatedWidget.request)) +
        '&token=' +
        encodeURIComponent(relatedWidget.token)
      jobs.push(
        fetchText(url, 9000).then((raw) => {
          if (!raw) return
          const data = extractJson(raw)
          const ranked = data?.default?.rankedList ?? []
          for (const list of ranked) {
            for (const item of list?.rankedKeyword ?? []) {
              if (item?.query) risingQueries.push(String(item.query).toLowerCase())
            }
          }
        })
      )
    }

    await Promise.all(jobs)

    if (!series.length) return empty

    const avg = series.reduce((a, b) => a + b, 0) / series.length
    // momentum: last ~13 weeks (90d) mean vs the 13 weeks before that
    const n = series.length
    const w = Math.min(13, Math.floor(n / 2))
    let momentumRaw = 0
    if (w >= 4) {
      const recent = series.slice(n - w)
      const prior = series.slice(n - 2 * w, n - w)
      const rMean = recent.reduce((a, b) => a + b, 0) / recent.length
      const pMean = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0
      momentumRaw = pMean > 0 ? ((rMean - pMean) / pMean) * 100 : rMean > 0 ? 50 : 0
    }

    return { series, avgInterest: avg, momentumRaw, risingQueries: risingQueries.slice(0, 25), ok: true }
  } catch {
    return empty
  }
}

// Batched trends probe for many keywords (one per call — Trends compares max 5,
// but separate calls keep cache granularity). mapLimit keeps it polite.
export async function probeKeywords(keywords: string[], limit = 6): Promise<Map<string, TrendsResult>> {
  const out = new Map<string, TrendsResult>()
  const { mapLimit } = await import('./http')
  await mapLimit(keywords, limit, async (kw) => {
    out.set(kw, await getTrends(kw))
  })
  return out
}
