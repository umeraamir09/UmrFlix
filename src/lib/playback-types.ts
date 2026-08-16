/** Shared types for the playback pipeline (client + server route shape). */

export type AudioTrack = {
  index: number
  codec?: string
  language?: string
  title: string
  channels?: number
  bitrate?: number
  isDefault: boolean
}

export type SubtitleTrack = {
  index: number
  codec?: string
  language?: string
  title: string
  isDefault: boolean
  isForced: boolean
  isExternal: boolean
  isImageBased: boolean
  url: string | null
}

export type ChapterInfo = { name: string; startSeconds: number; imageTag?: string }

/**
 * Trickplay seek-preview metadata (Jellyfin 10.9+ "trickplay" thumbnails).
 * Thumbnails live in sprite tiles: tileWidth × tileHeight thumbs per tile
 * image; interval is the millisecond gap between consecutive thumbnails.
 * Tile images are proxied via /api/jellyfin/trickplay/{itemId}/{width}/{index}.
 */
export type TrickplayInfo = {
  width: number
  height: number
  tileWidth: number
  tileHeight: number
  thumbnailCount: number
  interval: number
}

export type SegmentMarker = {
  type: "intro" | "recap" | "outro" | "preview"
  start: number
  end: number
}

export type PlaybackPayload = {
  itemId: string
  playSessionId: string
  mediaSourceId: string
  container: string
  videoCodec?: string
  width?: number
  height?: number
  bitrate?: number
  supportsDirectPlay: boolean
  supportsDirectStream?: boolean
  supportsTranscoding: boolean
  canDirectPlay: boolean
  canDirectStream?: boolean
  directUrl: string
  hlsUrl: string
  runtimeTicks: number
  resumeTicks: number
  played: boolean
  playedPercentage: number | null
  audio: AudioTrack[]
  subtitles: SubtitleTrack[]
  defaultAudioIndex: number | null
  markers: SegmentMarker[]
  chapters: ChapterInfo[]
  trickplay: TrickplayInfo | null
  title?: string
  series?: { id: string; name?: string; season?: number; episode?: number } | null
  backdropUrl?: string
  error?: string
}

export type QualityPreset = {
  id: string
  label: string
  maxStreamingBitrate?: number
  maxWidth?: number
  maxHeight?: number
}

export const QUALITY_PRESETS: QualityPreset[] = [
  { id: "auto", label: "Auto" },
  { id: "uhd", label: "4K — 20 Mbps", maxStreamingBitrate: 20_000_000, maxWidth: 3840, maxHeight: 2160 },
  { id: "fhd", label: "1080p — 10 Mbps", maxStreamingBitrate: 10_000_000, maxWidth: 1920, maxHeight: 1080 },
  { id: "hd", label: "720p — 4 Mbps", maxStreamingBitrate: 4_000_000, maxWidth: 1280, maxHeight: 720 },
  { id: "sd", label: "480p — 1.5 Mbps", maxStreamingBitrate: 1_500_000, maxWidth: 854, maxHeight: 480 },
]

/**
 * Validates and normalizes a raw object into a well-typed PlaybackPayload.
 * Throws a descriptive Error if required fields are missing or invalid.
 */
export function parsePlaybackPayload(raw: unknown): PlaybackPayload {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid playback payload: payload must be a non-null object")
  }

  const obj = raw as Record<string, unknown>

  if (typeof obj.error === "string" && obj.error) {
    // If error field exists without minimal playback fields
    if (!obj.itemId || !obj.hlsUrl) {
      throw new Error(`Playback payload error: ${obj.error}`)
    }
  }

  // Required string identifiers and URLs
  const requiredStringFields = ["itemId", "playSessionId", "mediaSourceId", "container", "directUrl", "hlsUrl"] as const
  for (const field of requiredStringFields) {
    if (typeof obj[field] !== "string" || !(obj[field] as string).trim()) {
      throw new Error(`Invalid playback payload: missing or invalid required string field '${field}'`)
    }
  }

  // Required booleans
  const requiredBooleanFields = ["supportsDirectPlay", "supportsTranscoding", "canDirectPlay", "played"] as const
  for (const field of requiredBooleanFields) {
    if (typeof obj[field] !== "boolean") {
      throw new Error(`Invalid playback payload: missing or invalid boolean field '${field}'`)
    }
  }

  // Required numeric ticks
  if (typeof obj.runtimeTicks !== "number" || !Number.isFinite(obj.runtimeTicks) || obj.runtimeTicks < 0) {
    throw new Error("Invalid playback payload: 'runtimeTicks' must be a non-negative finite number")
  }
  if (typeof obj.resumeTicks !== "number" || !Number.isFinite(obj.resumeTicks) || obj.resumeTicks < 0) {
    throw new Error("Invalid playback payload: 'resumeTicks' must be a non-negative finite number")
  }

  // Audio tracks array validation and normalization
  const rawAudio = Array.isArray(obj.audio) ? obj.audio : []
  const audio: AudioTrack[] = rawAudio
    .filter((a): a is Record<string, unknown> => a != null && typeof a === "object")
    .map((a) => ({
      index: typeof a.index === "number" ? a.index : 0,
      codec: typeof a.codec === "string" ? a.codec : undefined,
      language: typeof a.language === "string" ? a.language : undefined,
      title: typeof a.title === "string" ? a.title : `Track ${typeof a.index === "number" ? a.index : 0}`,
      channels: typeof a.channels === "number" ? a.channels : undefined,
      bitrate: typeof a.bitrate === "number" ? a.bitrate : undefined,
      isDefault: Boolean(a.isDefault),
    }))

  // Subtitles array validation and normalization
  const rawSubtitles = Array.isArray(obj.subtitles) ? obj.subtitles : []
  const subtitles: SubtitleTrack[] = rawSubtitles
    .filter((s): s is Record<string, unknown> => s != null && typeof s === "object")
    .map((s) => ({
      index: typeof s.index === "number" ? s.index : 0,
      codec: typeof s.codec === "string" ? s.codec : undefined,
      language: typeof s.language === "string" ? s.language : undefined,
      title: typeof s.title === "string" ? s.title : `Subtitle ${typeof s.index === "number" ? s.index : 0}`,
      isDefault: Boolean(s.isDefault),
      isForced: Boolean(s.isForced),
      isExternal: Boolean(s.isExternal),
      isImageBased: Boolean(s.isImageBased),
      url: typeof s.url === "string" ? s.url : null,
    }))

  // Segment markers validation and normalization
  const validMarkerTypes = new Set(["intro", "recap", "outro", "preview"])
  const rawMarkers = Array.isArray(obj.markers) ? obj.markers : []
  const markers: SegmentMarker[] = rawMarkers
    .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
    .filter((m) => validMarkerTypes.has(String(m.type)) && typeof m.start === "number" && typeof m.end === "number" && m.end >= m.start)
    .map((m) => ({
      type: m.type as "intro" | "recap" | "outro" | "preview",
      start: Number(m.start),
      end: Number(m.end),
    }))

  // Chapters validation and normalization
  const rawChapters = Array.isArray(obj.chapters) ? obj.chapters : []
  const chapters: ChapterInfo[] = rawChapters
    .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
    .map((c) => ({
      name: typeof c.name === "string" ? c.name : "Chapter",
      startSeconds: typeof c.startSeconds === "number" && Number.isFinite(c.startSeconds) ? Math.max(0, c.startSeconds) : 0,
      imageTag: typeof c.imageTag === "string" ? c.imageTag : undefined,
    }))

  // Trickplay validation
  let trickplay: TrickplayInfo | null = null
  if (obj.trickplay && typeof obj.trickplay === "object") {
    const tp = obj.trickplay as Record<string, unknown>
    if (
      typeof tp.width === "number" &&
      typeof tp.height === "number" &&
      typeof tp.tileWidth === "number" &&
      typeof tp.tileHeight === "number" &&
      typeof tp.thumbnailCount === "number" &&
      typeof tp.interval === "number"
    ) {
      trickplay = {
        width: tp.width,
        height: tp.height,
        tileWidth: tp.tileWidth,
        tileHeight: tp.tileHeight,
        thumbnailCount: tp.thumbnailCount,
        interval: tp.interval,
      }
    }
  }

  // Series validation
  let series: PlaybackPayload["series"] = null
  if (obj.series && typeof obj.series === "object") {
    const s = obj.series as Record<string, unknown>
    if (typeof s.id === "string") {
      series = {
        id: s.id,
        name: typeof s.name === "string" ? s.name : undefined,
        season: typeof s.season === "number" ? s.season : undefined,
        episode: typeof s.episode === "number" ? s.episode : undefined,
      }
    }
  }

  return {
    itemId: obj.itemId as string,
    playSessionId: obj.playSessionId as string,
    mediaSourceId: obj.mediaSourceId as string,
    container: obj.container as string,
    videoCodec: typeof obj.videoCodec === "string" ? obj.videoCodec : undefined,
    width: typeof obj.width === "number" ? obj.width : undefined,
    height: typeof obj.height === "number" ? obj.height : undefined,
    bitrate: typeof obj.bitrate === "number" ? obj.bitrate : undefined,
    supportsDirectPlay: obj.supportsDirectPlay as boolean,
    supportsDirectStream: typeof obj.supportsDirectStream === "boolean" ? obj.supportsDirectStream : undefined,
    supportsTranscoding: obj.supportsTranscoding as boolean,
    canDirectPlay: obj.canDirectPlay as boolean,
    canDirectStream: typeof obj.canDirectStream === "boolean" ? obj.canDirectStream : undefined,
    directUrl: obj.directUrl as string,
    hlsUrl: obj.hlsUrl as string,
    runtimeTicks: obj.runtimeTicks as number,
    resumeTicks: obj.resumeTicks as number,
    played: obj.played as boolean,
    playedPercentage: typeof obj.playedPercentage === "number" ? obj.playedPercentage : null,
    audio,
    subtitles,
    defaultAudioIndex: typeof obj.defaultAudioIndex === "number" ? obj.defaultAudioIndex : null,
    markers,
    chapters,
    trickplay,
    title: typeof obj.title === "string" ? obj.title : undefined,
    series,
    backdropUrl: typeof obj.backdropUrl === "string" ? obj.backdropUrl : undefined,
    error: typeof obj.error === "string" ? obj.error : undefined,
  }
}

/**
 * Returns true if data satisfies the PlaybackPayload contract.
 */
export function isValidPlaybackPayload(raw: unknown): raw is PlaybackPayload {
  try {
    parsePlaybackPayload(raw)
    return true
  } catch {
    return false
  }
}

