import { NextResponse } from "next/server"
import { isValidItemId } from "@/lib/validation"
import { getSession } from "@/lib/auth"
import { checkRateLimit, PLAYBACK_RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/audit"
import { parsePlaybackPayload, type PlaybackPayload } from "@/lib/playback-types"
import {
  authenticate,
  getPlaybackInfo,
  getItemDetail,
  getIntroSkipperSegments,
  getMediaSegments,
  buildDirectStreamUrl,
  buildHlsStreamUrl,
  buildSubtitleUrl,
  buildItemImageUrl,
  ticksToSeconds,
  pickTrickplayInfo,
  type JellyfinMediaSource,
} from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

export type MarkerType = "intro" | "recap" | "outro" | "preview"
export type SegmentMarker = { type: MarkerType; start: number; end: number } // seconds

type StaticPlaybackMetadata = Pick<
  PlaybackPayload,
  "markers" | "chapters" | "trickplay" | "title" | "series"
>

type CacheEntry = {
  metadata: StaticPlaybackMetadata
  timestamp: number
}

const playbackCache = new Map<string, CacheEntry>()
const PLAYBACK_CACHE_TTL_MS = 30_000 // 30-second TTL
const MAX_CACHE_ENTRIES = 100

/**
 * Invalidates cached playback info entries.
 * When itemId is provided, removes entries for that specific item; otherwise clears all.
 */
export function invalidatePlaybackCache(itemId?: string): void {
  if (!itemId) {
    playbackCache.clear()
    return
  }
  for (const key of Array.from(playbackCache.keys())) {
    if (key.endsWith(`:${itemId}`) || key === itemId) {
      playbackCache.delete(key)
    }
  }
}

const IMAGE_BASED_SUB_CODECS = new Set(["pgssub", "dvdsub", "dvbsub", "xsub"])

// Chapter-name heuristics used when segment providers are absent or incomplete.
const CHAPTER_PATTERNS: [RegExp, MarkerType][] = [
  [/^(recap|previously|cold ?start|summary)/i, "recap"],
  [/^(intro|opening|op\b|title sequence|main titles|opening title)/i, "intro"],
  [/^(credits|ending|ed\b|outro|end credits|closing|end\b)/i, "outro"],
  [/^(preview|next time|next episode|trailer|coming up|next on)/i, "preview"],
]

function chaptersToMarkers(
  chapters: { Name: string; StartPositionTicks: number }[],
  runtimeTicks: number,
): SegmentMarker[] {
  const markers: SegmentMarker[] = []
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i]
    for (const [pattern, type] of CHAPTER_PATTERNS) {
      if (pattern.test(ch.Name.trim())) {
        const start = ticksToSeconds(ch.StartPositionTicks)
        const next = chapters[i + 1]
        const end = next
          ? ticksToSeconds(next.StartPositionTicks)
          : runtimeTicks > 0
            ? ticksToSeconds(runtimeTicks)
            : start + 120
        if (end > start) markers.push({ type, start, end })
        break
      }
    }
  }
  return markers
}

const MARKER_TYPES: MarkerType[] = ["intro", "recap", "outro", "preview"]
const MIN_MARKER_DURATION = 5

/**
 * Merges marker sources in priority order, taking the source that produced a given
 * type (native segments > Intro Skipper plugin > chapters). Lower-tier sources only
 * fill in types the higher tiers missed. All valid markers of that type from the winning
 * source are preserved (supporting multi-part episodes/compilations with multiple intros/outros).
 */
function mergeMarkerSources(
  sources: SegmentMarker[][],
  runtimeSeconds: number,
): SegmentMarker[] {
  const byType = new Map<MarkerType, { source: SegmentMarker[]; markers: SegmentMarker[] }>()
  for (const source of sources) {
    for (const m of source) {
      if (m.end - m.start < MIN_MARKER_DURATION) continue
      if (runtimeSeconds > 0 && m.start >= runtimeSeconds) continue

      const existing = byType.get(m.type)
      if (existing && existing.source !== source) continue

      if (!existing) {
        byType.set(m.type, { source, markers: [m] })
      } else {
        existing.markers.push(m)
      }
    }
  }
  return MARKER_TYPES.flatMap((t) => byType.get(t)?.markers ?? []).sort((a, b) => a.start - b.start)
}

function pickMediaSource(sources: JellyfinMediaSource[]): JellyfinMediaSource | undefined {
  if (sources.length === 0) return undefined
  // Prefer the source with the highest bitrate (best quality master)
  return [...sources].sort((a, b) => (b.Bitrate ?? 0) - (a.Bitrate ?? 0))[0]
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 })
    }

    const session = await getSession()
    const clientIp = getClientIp(request)
    if (!session?.userId && !clientIp) {
      return NextResponse.json(
        { error: "Authentication or a trusted client IP is required" },
        { status: 401 },
      )
    }

    const rateLimitKey = session?.userId
      ? `playback:${session.userId}`
      : `playback:${clientIp}`

    if (!checkRateLimit(rateLimitKey, PLAYBACK_RATE_LIMITS.PLAYBACK_INFO)) {
      return NextResponse.json(
        { error: "Too many playback requests. Please wait a moment." },
        { status: 429 },
      )
    }

    const url = new URL(request.url)
    const refresh = url.searchParams.get("refresh") === "true"
    const cacheControl = request.headers.get("cache-control") || ""
    const noCache =
      refresh ||
      cacheControl.includes("no-cache") ||
      cacheControl.includes("no-store") ||
      cacheControl.includes("max-age=0")

    const { token } = await authenticate()

    const [playbackInfo, detail] = await Promise.all([
      getPlaybackInfo(id),
      getItemDetail(id),
    ])

    const mediaSource = pickMediaSource(playbackInfo.MediaSources)
    if (!mediaSource) {
      return NextResponse.json({ error: "No playable media source found" }, { status: 404 })
    }


    const streams = mediaSource.MediaStreams ?? []
    const videoStream = streams.find((s) => s.Type === "Video")

    const audio = streams
      .filter((s) => s.Type === "Audio")
      .map((s) => ({
        index: s.Index,
        codec: s.Codec,
        language: s.DisplayLanguage ?? s.Language,
        title: s.DisplayTitle ?? s.Title ?? `Track ${s.Index}`,
        channels: s.Channels,
        bitrate: s.BitRate,
        isDefault: s.IsDefault,
      }))

    const subtitles = streams
      .filter((s) => s.Type === "Subtitle")
      .map((s) => {
        const codec = (s.Codec ?? "").toLowerCase()
        const isImageBased = IMAGE_BASED_SUB_CODECS.has(codec)
        const format =
          codec === "ass" || codec === "ssa"
            ? "ass"
            : codec === "srt" || codec === "subrip"
              ? "srt"
              : "vtt"
        return {
          index: s.Index,
          codec: s.Codec,
          language: s.DisplayLanguage ?? s.Language,
          title: s.DisplayTitle ?? s.Title ?? `Subtitle ${s.Index}`,
          isDefault: s.IsDefault,
          isForced: s.IsForced,
          isExternal: s.IsExternal,
          isImageBased,
          url: isImageBased
            ? null
            : buildSubtitleUrl(id, mediaSource.Id, s.Index, format),
        }
      })

    // ── Markers: native MediaSegments → Intro Skipper plugin → chapter heuristics ──
    const cachedMetadata = !noCache ? playbackCache.get(id) : undefined
    const metadataIsFresh =
      cachedMetadata && Date.now() - cachedMetadata.timestamp < PLAYBACK_CACHE_TTL_MS

    // Session data and UserData are intentionally excluded from this cache.
    let staticMetadata: StaticPlaybackMetadata
    if (metadataIsFresh) {
      staticMetadata = cachedMetadata.metadata
    } else {
      let markers: SegmentMarker[] = []
      if (detail?.Type === "Episode" || detail?.Type === "Movie") {
        const runtimeSeconds = ticksToSeconds(
          detail.RunTimeTicks ?? mediaSource.RunTimeTicks ?? 0,
        )
        const [nativeSegments, pluginSegments] = await Promise.all([
          getMediaSegments(id),
          getIntroSkipperSegments(id),
        ])

        const pluginMarkers: SegmentMarker[] = []
        if (pluginSegments) {
          const typeMap: Record<string, MarkerType> = {
            Introduction: "intro",
            Recap: "recap",
            Credits: "outro",
            Preview: "preview",
          }
          for (const [key, seg] of Object.entries(pluginSegments)) {
            const type = typeMap[key]
            if (type) pluginMarkers.push({ type, start: seg.start, end: seg.end })
          }
        }

        const chapterMarkers: SegmentMarker[] = detail?.Chapters?.length
          ? chaptersToMarkers(detail.Chapters, detail.RunTimeTicks ?? 0)
          : []

        markers = mergeMarkerSources(
          [nativeSegments ?? [], pluginMarkers, chapterMarkers],
          runtimeSeconds,
        )
      }

      staticMetadata = {
        markers,
        chapters: (detail?.Chapters ?? []).map((c) => ({
          name: c.Name,
          startSeconds: ticksToSeconds(c.StartPositionTicks),
          imageTag: c.ImageTag || undefined,
        })),
        trickplay: pickTrickplayInfo(detail?.Trickplay, mediaSource.Id),
        title: detail?.Name,
        series: detail?.SeriesId
          ? {
              id: detail.SeriesId,
              name: detail.SeriesName,
              season: detail.ParentIndexNumber,
              episode: detail.IndexNumber,
            }
          : null,
      }
    }

    const container = (mediaSource.Container ?? "").toLowerCase()
    const browserNativeContainers = new Set(["mp4", "m4v", "mov", "webm"])
    const videoCodec = (videoStream?.Codec ?? "").toLowerCase()
    const isSupportedVideoCodec =
      videoCodec !== "" &&
      videoCodec !== "mpeg2video" &&
      videoCodec !== "vc1" &&
      videoCodec !== "wmv3"

    const canDirectPlay =
      mediaSource.SupportsDirectPlay &&
      browserNativeContainers.has(container) &&
      isSupportedVideoCodec

    const canDirectStream =
      (mediaSource.SupportsDirectStream || mediaSource.SupportsDirectPlay) &&
      isSupportedVideoCodec

    const userData = detail?.UserData
    const runtimeTicks = detail?.RunTimeTicks ?? mediaSource.RunTimeTicks ?? 0

    const resumeTicksRaw = userData?.PlaybackPositionTicks ?? 0
    // Don't offer resume if at the very start or essentially finished (>90%)
    const offerResume =
      resumeTicksRaw > 30_000_000 /* 3s */ &&
      (runtimeTicks === 0 || resumeTicksRaw / runtimeTicks < 0.9)

    const backdropUrl = detail?.BackdropImageTags?.length
      ? buildItemImageUrl(id, token, "Backdrop")
      : detail?.ParentBackdropItemId
        ? buildItemImageUrl(detail.ParentBackdropItemId, token, "Backdrop")
        : undefined

    const payload = parsePlaybackPayload({
      itemId: id,
      playSessionId: playbackInfo.PlaySessionId,
      mediaSourceId: mediaSource.Id,
      container,
      videoCodec: videoStream?.Codec,
      width: videoStream?.Width,
      height: videoStream?.Height,
      bitrate: mediaSource.Bitrate,
      supportsDirectPlay: mediaSource.SupportsDirectPlay,
      supportsDirectStream: mediaSource.SupportsDirectStream ?? mediaSource.SupportsDirectPlay,
      supportsTranscoding: mediaSource.SupportsTranscoding,
      canDirectPlay,
      canDirectStream,
      directUrl: buildDirectStreamUrl(id, token, { mediaSourceId: mediaSource.Id }),
      hlsUrl: buildHlsStreamUrl(id, token, {
        mediaSourceId: mediaSource.Id,
        playSessionId: playbackInfo.PlaySessionId,
      }),
      runtimeTicks,
      resumeTicks: offerResume ? resumeTicksRaw : 0,
      played: userData?.Played ?? false,
      playedPercentage: userData?.PlayedPercentage ?? null,
      audio,
      subtitles,
      defaultAudioIndex: mediaSource.DefaultAudioStreamIndex ?? audio.find((a) => a.isDefault)?.index ?? null,
      markers: staticMetadata.markers,
      chapters: staticMetadata.chapters,
      trickplay: staticMetadata.trickplay,
      title: staticMetadata.title,
      series: staticMetadata.series,
      backdropUrl,
    })

    if (!noCache && !metadataIsFresh) {
      if (playbackCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = playbackCache.keys().next().value
        if (oldestKey) playbackCache.delete(oldestKey)
      }
      playbackCache.set(id, { metadata: staticMetadata, timestamp: Date.now() })
    }

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load playback info"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
