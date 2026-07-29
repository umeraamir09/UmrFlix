import { NextResponse } from "next/server"
import {
  authenticate,
  getPlaybackInfo,
  getItemDetail,
  getIntroSkipperSegments,
  buildDirectStreamUrl,
  buildHlsStreamUrl,
  buildSubtitleUrl,
  buildItemImageUrl,
  ticksToSeconds,
  type JellyfinMediaSource,
} from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

export type MarkerType = "intro" | "recap" | "credits" | "preview"
export type SegmentMarker = { type: MarkerType; start: number; end: number } // seconds

const IMAGE_BASED_SUB_CODECS = new Set(["pgssub", "dvdsub", "dvbsub", "xsub"])

// Chapter-name heuristics used when the Intro Skipper plugin is absent.
const CHAPTER_PATTERNS: [RegExp, MarkerType][] = [
  [/^(recap|previously|cold ?start)/i, "recap"],
  [/^(intro|opening|op\b|title sequence|main titles)/i, "intro"],
  [/^(credits|ending|ed\b|outro|end credits)/i, "credits"],
  [/^(preview|next time|trailer)/i, "preview"],
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

function pickMediaSource(sources: JellyfinMediaSource[]): JellyfinMediaSource | undefined {
  if (sources.length === 0) return undefined
  // Prefer the source with the highest bitrate (best quality master)
  return [...sources].sort((a, b) => (b.Bitrate ?? 0) - (a.Bitrate ?? 0))[0]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
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

    // ── Markers: Intro Skipper plugin first, chapter heuristics as fallback ──
    let markers: SegmentMarker[] = []
    if (detail?.Type === "Episode" || detail?.Type === "Movie") {
      const pluginSegments = await getIntroSkipperSegments(id)
      if (pluginSegments) {
        const typeMap: Record<string, MarkerType> = {
          Introduction: "intro",
          Recap: "recap",
          Credits: "credits",
          Preview: "preview",
        }
        for (const [key, seg] of Object.entries(pluginSegments)) {
          const type = typeMap[key]
          if (type) markers.push({ type, start: seg.start, end: seg.end })
        }
      }
    }
    if (markers.length === 0 && detail?.Chapters?.length) {
      markers = chaptersToMarkers(detail.Chapters, detail.RunTimeTicks ?? 0)
    }

    const container = (mediaSource.Container ?? "").toLowerCase()
    const browserNativeContainers = new Set(["mp4", "m4v", "mov", "webm"])
    const videoCodec = (videoStream?.Codec ?? "").toLowerCase()
    const canDirectPlay =
      mediaSource.SupportsDirectPlay &&
      browserNativeContainers.has(container) &&
      videoCodec !== "" &&
      videoCodec !== "mpeg2video" &&
      videoCodec !== "vc1"

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

    return NextResponse.json({
      itemId: id,
      playSessionId: playbackInfo.PlaySessionId,
      mediaSourceId: mediaSource.Id,
      container,
      videoCodec: videoStream?.Codec,
      width: videoStream?.Width,
      height: videoStream?.Height,
      bitrate: mediaSource.Bitrate,
      supportsDirectPlay: mediaSource.SupportsDirectPlay,
      supportsTranscoding: mediaSource.SupportsTranscoding,
      canDirectPlay,
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
      markers,
      chapters: (detail?.Chapters ?? []).map((c) => ({
        name: c.Name,
        startSeconds: ticksToSeconds(c.StartPositionTicks),
      })),
      title: detail?.Name,
      series: detail?.SeriesId
        ? {
            id: detail.SeriesId,
            name: detail.SeriesName,
            season: detail.ParentIndexNumber,
            episode: detail.IndexNumber,
          }
        : null,
      backdropUrl,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load playback info"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
