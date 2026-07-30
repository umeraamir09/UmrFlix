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

export type ChapterInfo = { name: string; startSeconds: number }

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
  type: "intro" | "recap" | "credits" | "preview"
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
  supportsTranscoding: boolean
  canDirectPlay: boolean
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
