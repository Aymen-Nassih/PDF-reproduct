// Optional API keys — read from Cloudflare Worker secrets / .dev.vars.
// Every integration degrades gracefully when its key is absent.
export interface ApiKeys {
  youtubeApiKey?: string // YouTube Data API v3 (free: 10k units/day)
  redditClientId?: string // Reddit OAuth script app (free)
  redditClientSecret?: string
  redditUserAgent?: string
  serperApiKey?: string // serper.dev — SERP/PAA/related (~$0.001/query)
  dataforseoLogin?: string // DataForSEO — real search volumes (~$0.05/1k keywords)
  dataforseoPassword?: string
}

export function extractKeys(env: Record<string, unknown>): ApiKeys {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return {
    youtubeApiKey: str(env.YOUTUBE_API_KEY),
    redditClientId: str(env.REDDIT_CLIENT_ID),
    redditClientSecret: str(env.REDDIT_CLIENT_SECRET),
    redditUserAgent: str(env.REDDIT_USER_AGENT),
    serperApiKey: str(env.SERPER_API_KEY),
    dataforseoLogin: str(env.DATAFORSEO_LOGIN),
    dataforseoPassword: str(env.DATAFORSEO_PASSWORD)
  }
}

export function keyStatus(keys: ApiKeys) {
  return {
    youtube: !!keys.youtubeApiKey,
    reddit: !!(keys.redditClientId && keys.redditClientSecret),
    serper: !!keys.serperApiKey,
    dataforseo: !!(keys.dataforseoLogin && keys.dataforseoPassword)
  }
}
