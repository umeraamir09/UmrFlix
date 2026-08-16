const SENSITIVE_PARAM_KEYS = new Set([
  "api_key",
  "apikey",
  "token",
  "x-emby-token",
  "accesstoken",
  "access_token",
  "auth",
  "authorization",
  "password",
  "secret",
  "sig",
  "signature",
])

export function maskUrl(url: string): string {
  if (!url) return ""

  // Use URL object parsing only for clean URL strings without spaces
  if (!/\s/.test(url) && (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("/"))) {
    try {
      const isAbsolute = url.startsWith("http://") || url.startsWith("https://")
      const parsed = new URL(url, "http://localhost")
      let hasModified = false
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (SENSITIVE_PARAM_KEYS.has(key.toLowerCase())) {
          parsed.searchParams.set(key, "***")
          hasModified = true
        }
      }
      if (hasModified) {
        if (isAbsolute) {
          return parsed.toString()
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}`
      }
    } catch {
      // Fall back to regex replacement
    }
  }

  // Regex replacement for relative/partial URLs, query strings, or text fragments
  return url.replace(
    /([?&](?:api_?key|token|x-emby-token|access_?token|auth|authorization|password|secret|sig|signature)=)([^&\s#]+)/gi,
    "$1***",
  )
}

export type StreamOptions = {
  mediaSourceId?: string
  playSessionId?: string
  audioStreamIndex?: number
  subtitleStreamIndex?: number
  maxStreamingBitrate?: number
  maxWidth?: number
  maxHeight?: number
  startTimeTicks?: number
  videoCodec?: string
  audioCodec?: string
}

export function applyStreamParams(params: URLSearchParams, opts: StreamOptions) {
  if (opts.mediaSourceId) {
    params.set("mediaSourceId", opts.mediaSourceId)
    params.set("MediaSourceId", opts.mediaSourceId)
  }
  if (opts.playSessionId) {
    params.set("playSessionId", opts.playSessionId)
    params.set("PlaySessionId", opts.playSessionId)
  }
  if (opts.audioStreamIndex != null) {
    params.set("audioStreamIndex", String(opts.audioStreamIndex))
    params.set("AudioStreamIndex", String(opts.audioStreamIndex))
  }
  if (opts.subtitleStreamIndex != null) {
    params.set("subtitleStreamIndex", String(opts.subtitleStreamIndex))
    params.set("SubtitleStreamIndex", String(opts.subtitleStreamIndex))
  }
  if (opts.maxStreamingBitrate) {
    const b = String(opts.maxStreamingBitrate)
    params.set("maxStreamingBitrate", b)
    params.set("MaxStreamingBitrate", b)
    params.set("videoBitrate", b)
    params.set("VideoBitrate", b)
    params.set("videoBitRate", b)
    params.set("VideoBitRate", b)
    params.set("maxVideoBitrate", b)
    params.set("MaxVideoBitrate", b)
  }
  if (opts.maxWidth) {
    const w = String(opts.maxWidth)
    params.set("maxWidth", w)
    params.set("maxVideoWidth", w)
    params.set("MaxVideoWidth", w)
    params.set("width", w)
    params.set("Width", w)
    params.set("reqWidth", w)
  }
  if (opts.maxHeight) {
    const h = String(opts.maxHeight)
    params.set("maxHeight", h)
    params.set("maxVideoHeight", h)
    params.set("MaxVideoHeight", h)
    params.set("height", h)
    params.set("Height", h)
    params.set("reqHeight", h)
  }
  if (opts.startTimeTicks) params.set("startTimeTicks", String(opts.startTimeTicks))
}
