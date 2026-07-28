/**
 * Client-side codec capability probing.
 *
 * The server gate (canDirectPlay) only knows the container/codec — this
 * probes the *actual browser* so we fall back to transcoded HLS whenever
 * the browser can't decode the file natively (e.g. HEVC in MP4 on Chrome
 * without hardware support, EAC3, DTS…).
 */

const VIDEO_MIME_BY_CONTAINER: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  mkv: "video/x-matroska",
  webm: "video/webm",
}

const CODEC_TAG: Record<string, string> = {
  // video
  h264: "avc1.640028",
  hevc: "hvc1.1.6.L120.90",
  h265: "hvc1.1.6.L120.90",
  vp8: "vp08.00.10.08",
  vp9: "vp09.00.50.08",
  av1: "av01.0.08M.08",
  // audio
  aac: "mp4a.40.2",
  "he-aac": "mp4a.40.5",
  heaac: "mp4a.40.5",
  mp3: "mp4a.40.34",
  ac3: "ac-3",
  eac3: "ec-3",
  opus: "opus",
  flac: "flac",
  vorbis: "vorbis",
  dts: "dts",
}

const probeCache = new Map<string, boolean>()

export function canBrowserPlayNatively(
  container: string | undefined,
  videoCodec: string | undefined,
  audioCodecs: (string | undefined)[],
): { supported: boolean; reason: string } {
  const containerKey = (container ?? "").toLowerCase()
  const mime = VIDEO_MIME_BY_CONTAINER[containerKey]
  if (!mime) {
    return { supported: false, reason: `container .${containerKey} not natively supported` }
  }
  // MKV is only considered if the browser explicitly accepts the mime
  if (containerKey === "mkv") {
    const probeEl = document.createElement("video")
    if (!probeEl.canPlayType("video/x-matroska")) {
      return { supported: false, reason: "browser has no native MKV demuxer" }
    }
  }

  const tags: string[] = []
  const vTag = CODEC_TAG[(videoCodec ?? "").toLowerCase()]
  if (!vTag) {
    return { supported: false, reason: `unknown video codec "${videoCodec}"` }
  }
  tags.push(vTag)
  for (const ac of audioCodecs) {
    const tag = CODEC_TAG[(ac ?? "").toLowerCase()]
    if (tag && !tags.includes(tag)) tags.push(tag)
  }

  if (typeof document === "undefined") {
    return { supported: true, reason: "no DOM (SSR) — assuming supported" }
  }

  const key = `${mime}|${tags.join(",")}`
  const cached = probeCache.get(key)
  if (cached !== undefined) {
    return { supported: cached, reason: cached ? "codecs supported (cached)" : "codecs rejected (cached)" }
  }

  const el = document.createElement("video")
  const full = `${mime}; codecs="${tags.join(", ")}"`
  const answer = el.canPlayType(full)
  const supported = answer === "probably" || answer === "maybe"
  probeCache.set(key, supported)
  return {
    supported,
    reason: `canPlayType(${full}) → "${answer || "not supported"}"`,
  }
}
