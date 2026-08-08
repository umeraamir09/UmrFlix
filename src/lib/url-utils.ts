export function maskUrl(url: string): string {
  return url.replace(/api_key=[^&]+/, "api_key=***")
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
  if (opts.mediaSourceId) params.set("mediaSourceId", opts.mediaSourceId)
  if (opts.playSessionId) params.set("playSessionId", opts.playSessionId)
  if (opts.audioStreamIndex != null) params.set("audioStreamIndex", String(opts.audioStreamIndex))
  if (opts.subtitleStreamIndex != null) params.set("subtitleStreamIndex", String(opts.subtitleStreamIndex))
  if (opts.maxStreamingBitrate) {
    const b = String(opts.maxStreamingBitrate)
    params.set("maxStreamingBitrate", b)
  }
  if (opts.maxWidth) {
    const w = String(opts.maxWidth)
    params.set("maxWidth", w)
    params.set("maxVideoWidth", w)
    params.set("MaxVideoWidth", w)
  }
  if (opts.maxHeight) {
    const h = String(opts.maxHeight)
    params.set("maxHeight", h)
    params.set("maxVideoHeight", h)
    params.set("MaxVideoHeight", h)
  }
  if (opts.startTimeTicks) params.set("startTimeTicks", String(opts.startTimeTicks))
}
