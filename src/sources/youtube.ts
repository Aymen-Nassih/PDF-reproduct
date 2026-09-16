// YouTube Data API v3 — free tier: 10,000 units/day.
// Requires a Google Cloud project with "YouTube Data API v3" enabled + API key.
// Used in two places:
//   1. Seed pipeline: search demand + top videos per seed (views = real demand)
//   2. Discover: mostPopular videos (true trending) when a key is present
import { fetchJson } from './http'

const API = 'https://www.googleapis.com/youtube/v3'

export interface YouTubeVideoStat {
  title: string
  videoId: string
  views: number
  likes: number
  comments: number
  channelTitle: string
  publishedAt: string
  url: string
}

export interface YouTubeSeedResult {
  totalResults: number // search demand proxy (how much content exists for this term)
  topVideos: YouTubeVideoStat[]
  totalViews: number // views across the top videos — real consumption demand
  ok: boolean
}

// Seed-mode probe: search.list (100 units) + videos.list statistics (1 unit)
export async function probeYouTubeSeed(seed: string, apiKey: string): Promise<YouTubeSeedResult> {
  const empty: YouTubeSeedResult = { totalResults: 0, topVideos: [], totalViews: 0, ok: false }
  try {
    const search = await fetchJson<any>(
      `${API}/search?part=id&order=viewCount&type=video&maxResults=10&q=${encodeURIComponent(seed)}&key=${apiKey}`,
      8000
    )
    if (!search || search.error) return empty
    const ids = (search.items ?? []).map((i: any) => i?.id?.videoId).filter(Boolean)
    const totalResults = Number(search.pageInfo?.totalResults ?? 0)
    if (!ids.length) return { ...empty, totalResults, ok: true }

    const stats = await fetchJson<any>(
      `${API}/videos?part=snippet,statistics&id=${ids.join(',')}&key=${apiKey}`,
      8000
    )
    const videos: YouTubeVideoStat[] = (stats?.items ?? []).map((v: any) => ({
      title: String(v?.snippet?.title ?? ''),
      videoId: String(v?.id ?? ''),
      views: Number(v?.statistics?.viewCount ?? 0),
      likes: Number(v?.statistics?.likeCount ?? 0),
      comments: Number(v?.statistics?.commentCount ?? 0),
      channelTitle: String(v?.snippet?.channelTitle ?? ''),
      publishedAt: String(v?.snippet?.publishedAt ?? ''),
      url: `https://www.youtube.com/watch?v=${v?.id}`
    }))
    const totalViews = videos.reduce((a, v) => a + v.views, 0)
    return { totalResults, topVideos: videos, totalViews, ok: true }
  } catch {
    return empty
  }
}

// Discover-mode: true trending videos (mostPopular), 1 unit per call
export async function fetchYouTubeMostPopular(apiKey: string, regionCode = 'US'): Promise<YouTubeVideoStat[]> {
  try {
    const data = await fetchJson<any>(
      `${API}/videos?part=snippet,statistics&chart=mostPopular&regionCode=${regionCode}&maxResults=25&key=${apiKey}`,
      9000
    )
    if (!data || data.error) return []
    return (data.items ?? []).map((v: any) => ({
      title: String(v?.snippet?.title ?? ''),
      videoId: String(v?.id ?? ''),
      views: Number(v?.statistics?.viewCount ?? 0),
      likes: Number(v?.statistics?.likeCount ?? 0),
      comments: Number(v?.statistics?.commentCount ?? 0),
      channelTitle: String(v?.snippet?.channelTitle ?? ''),
      publishedAt: String(v?.snippet?.publishedAt ?? ''),
      url: `https://www.youtube.com/watch?v=${v?.id}`
    }))
  } catch {
    return []
  }
}
