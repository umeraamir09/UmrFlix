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
  if (opts.startTimeTicks) {
    const t = String(opts.startTimeTicks)
    params.set("startTimeTicks", t)
    params.set("StartTimeTicks", t)
  }
}

const TICKS_PER_SECOND = 10_000_000

/**
 * Query params that are legal on HLS *playlist* requests but REJECTED by
 * Jellyfin's segment endpoint ("StartTimeTicks is not allowed"). Jellyfin
 * propagates playlist query params into every generated segment URI, so the
 * offset must be stripped before forwarding any segment request.
 */
const SEGMENT_ONLY_PARAM_KEYS = ["starttimeticks"]

export function stripSegmentOnlySearchParams(params: URLSearchParams): void {
  for (const key of Array.from(params.keys())) {
    if (SEGMENT_ONLY_PARAM_KEYS.includes(key.toLowerCase())) params.delete(key)
  }
}

/** True when a proxied Jellyfin path is an HLS media/init segment request. */
export function isHlsSegmentPath(path: string): boolean {
  // Segment URIs live under /Videos/{id}/hls1/{quality|main}/{N}.{ext}
  return path.includes("/hls1/")
}

/**
 * Append a server-side start offset to an HLS playlist URL.
 *
 * Jellyfin's master.m3u8 accepts `startTimeTicks` (in 100ns ticks) and starts
 * ffmpeg with a matching `-ss` offset. Without it every transcode session
 * encodes from 0:00, so resuming mid-file or rebuilding the stream (quality /
 * track switch) stalls until ffmpeg encodes up to the playhead. Official
 * clients send the offset on the playlist request ONLY — Jellyfin rejects
 * `startTimeTicks` on individual segment requests, and its generated segment
 * URIs deliberately omit it.
 *
 * Both casing variants are set (matching the rest of this module) so a URL can
 * never carry two different offsets under different parameter casings.
 *
 * Returns the URL unchanged when the position is invalid (≤ 0 / NaN) and clamps
 * to just before the runtime end when the position overshoots it.
 */
export function withStartTimeTicks(
  url: string,
  positionSec: number,
  runtimeSec?: number,
): string {
  if (!url || !Number.isFinite(positionSec) || positionSec <= 0) return url

  let pos = positionSec
  if (
    typeof runtimeSec === "number" &&
    Number.isFinite(runtimeSec) &&
    runtimeSec > 0 &&
    pos > runtimeSec - 0.5
  ) {
    pos = Math.max(0, runtimeSec - 0.5)
    if (pos <= 0) return url
  }

  const ticks = Math.round(pos * TICKS_PER_SECOND)
  // Only transform well-formed absolute or root-relative URLs (same guard as
  // maskUrl) — anything else is returned untouched rather than mangled.
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) return url
  try {
    const parsed = new URL(url, "http://localhost")
    parsed.searchParams.set("startTimeTicks", String(ticks))
    parsed.searchParams.set("StartTimeTicks", String(ticks))
    if (/^https?:\/\//i.test(url)) return parsed.toString()
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return url
  }
}
