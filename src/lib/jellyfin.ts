import { env } from "./env"

const BASE = env("JELLYFIN_URL")
const TIMEOUT = 8_000

async function jellyfinFetch(url: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    if (res.status === 401) cachedToken = null // re-auth next time
    return res
  } finally {
    clearTimeout(id)
  }
}

export type JellyfinAuthResponse = {
  AccessToken: string
  User: {
    Id: string
    Name: string
  }
}

export type JellyfinItem = {
  Id: string
  Name: string
  ProviderIds?: {
    Tmdb?: string
    Tvdb?: string
    Imdb?: string
  }
  Type: string
  MediaType: string
}

export type JellyfinItemsResponse = {
  Items: JellyfinItem[]
  TotalRecordCount: number
}

let cachedToken: { token: string; userId: string } | null = null

export async function authenticate(): Promise<{ token: string; userId: string }> {
  if (cachedToken) return cachedToken

  const res = await jellyfinFetch(`${BASE}/Users/AuthenticateByName`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Emby-Authorization":
        'MediaBrowser Client="UmrFlix", Device="UmrFlixServer", DeviceId="umrflix-server-001", Version="1.0.0"',
    },
    body: JSON.stringify({
      Username: env("JELLYFIN_USERNAME"),
      Pw: env("JELLYFIN_PASSWORD"),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)")
    console.error(`Jellyfin auth error: ${res.status}`, body)
    throw new Error(`Jellyfin auth error: ${res.status}`)
  }

  const data: JellyfinAuthResponse = await res.json()
  cachedToken = { token: data.AccessToken, userId: data.User.Id }
  return cachedToken
}

export function getAuthHeaders(token: string): Record<string, string> {
  return {
    "X-Emby-Token": token,
    "Content-Type": "application/json",
  }
}

export async function getItemsByProviderIds(
  token: string,
  userId: string,
  providerIds: Record<string, string>
): Promise<JellyfinItem[]> {
  const params = new URLSearchParams({
    userId,
    limit: "100",
    recursive: "true",
    fields: "ProviderIds",
    ...Object.fromEntries(
      Object.entries(providerIds).map(([k, v]) => [`providerIds.${k}`, v])
    ),
  })
  const res = await jellyfinFetch(`${BASE}/Users/${userId}/Items?${params}`, {
    headers: getAuthHeaders(token),
  })
  if (!res.ok) return []
  const data: JellyfinItemsResponse = await res.json()
  return data.Items ?? []
}

export function getDirectStreamUrl(itemId: string, token: string): string {
  return `${BASE}/Videos/${itemId}/stream?static=true&api_key=${token}`
}

export function getHlsMasterUrl(itemId: string, token: string): string {
  return `${BASE}/Videos/${itemId}/master.m3u8?api_key=${token}`
}

export async function getAllItems(token: string, userId: string): Promise<JellyfinItem[]> {
  const all: JellyfinItem[] = []
  let startIndex = 0
  const limit = 200

  while (true) {
    const params = new URLSearchParams({
      userId,
      limit: String(limit),
      startIndex: String(startIndex),
      recursive: "true",
      fields: "ProviderIds",
      includeItemTypes: "Movie,Series",
    })
    const res = await jellyfinFetch(`${BASE}/Users/${userId}/Items?${params}`, {
      headers: getAuthHeaders(token),
    })
    if (!res.ok) break
    const data: JellyfinItemsResponse = await res.json()
    const items = data.Items ?? []
    all.push(...items)
    if (items.length < limit) break
    startIndex += limit
  }

  return all
}

export async function getItemImageUrl(itemId: string, imageType = "Primary"): Promise<string> {
  const token = (await authenticate()).token
  return `${BASE}/Items/${itemId}/Images/${imageType}?api_key=${token}`
}

// --- Continue Watching / Resume Items ---

export type JellyfinUserData = {
  PlaybackPositionTicks: number
  PlayedPercentage?: number
  IsFavorite: boolean
  Played: boolean
}

export type JellyfinResumeItem = {
  Id: string
  Name: string
  Type: string // "Movie" | "Episode" | etc.
  SeriesName?: string
  SeriesId?: string
  SeasonName?: string
  IndexNumber?: number // Episode number within its season
  ParentIndexNumber?: number // Season number
  RunTimeTicks?: number
  UserData?: JellyfinUserData
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  ParentBackdropImageTags?: string[]
  ParentBackdropItemId?: string
  ProviderIds?: Record<string, string>
  MediaType: string
}

export type JellyfinResumeResponse = {
  Items: JellyfinResumeItem[]
  TotalRecordCount: number
}

/**
 * Fetches the currently in-progress / "continue watching" items for the
 * authenticated Jellyfin user.
 */
export async function getResumeItems(
  limit = 12,
): Promise<JellyfinResumeItem[]> {
  const { token, userId } = await authenticate()

  const params = new URLSearchParams({
    limit: String(limit),
    recursive: "true",
    fields: "ProviderIds,Overview",
    enableImageTypes: "Primary,Backdrop,Thumb",
    imageTypeLimit: "1",
    mediaTypes: "Video",
  })

  const res = await jellyfinFetch(
    `${BASE}/Users/${userId}/Items/Resume?${params}`,
    { headers: getAuthHeaders(token) },
  )

  if (!res.ok) {
    console.error(`Jellyfin resume fetch error: ${res.status}`)
    return []
  }

  const data: JellyfinResumeResponse = await res.json()
  return data.Items ?? []
}

/**
 * Build a working image URL for a Jellyfin item.
 * Prefers the item's own Primary image, then falls back to backdrop, then
 * series-level backdrop for episodes.
 */
export function buildJellyfinImageUrl(
  item: JellyfinResumeItem,
  type: "Primary" | "Backdrop" | "Thumb" = "Backdrop",
): string {
  const { token } = cachedToken ?? { token: "" }

  // Try item's own backdrop first
  if (type === "Backdrop" && item.BackdropImageTags && item.BackdropImageTags.length > 0) {
    return `${BASE}/Items/${item.Id}/Images/Backdrop?api_key=${token}`
  }

  // For episodes, try the parent (series) backdrop
  if (type === "Backdrop" && item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length > 0) {
    return `${BASE}/Items/${item.ParentBackdropItemId}/Images/Backdrop?api_key=${token}`
  }

  // Primary image fallback
  if (item.ImageTags?.Primary) {
    return `${BASE}/Items/${item.Id}/Images/Primary?api_key=${token}`
  }

  // Absolute fallback – transparent placeholder
  return `${BASE}/Items/${item.Id}/Images/Primary?api_key=${token}`
}

// ────────────────────────────────────────────────────────────
// Phase 2 — Production Media Engine
// ────────────────────────────────────────────────────────────

export const TICKS_PER_SECOND = 10_000_000

export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND
}

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND)
}

// ── PlaybackInfo (stream negotiation) ──

export type JellyfinMediaStream = {
  Index: number
  Type: "Video" | "Audio" | "Subtitle" | "EmbeddedImage" | string
  Codec?: string
  Language?: string
  DisplayTitle?: string
  DisplayLanguage?: string
  Title?: string
  Channels?: number
  BitRate?: number
  IsDefault: boolean
  IsForced: boolean
  IsExternal: boolean
  Width?: number
  Height?: number
}

export type JellyfinMediaSource = {
  Id: string
  Container?: string
  Size?: number
  Bitrate?: number
  RunTimeTicks?: number
  SupportsDirectPlay: boolean
  SupportsDirectStream: boolean
  SupportsTranscoding: boolean
  IsRemote: boolean
  MediaStreams: JellyfinMediaStream[]
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
}

export type JellyfinPlaybackInfo = {
  MediaSources: JellyfinMediaSource[]
  PlaySessionId: string
}

export type JellyfinChapter = {
  Name: string
  StartPositionTicks: number
}

export type JellyfinItemDetail = {
  Id: string
  Name: string
  Type: string
  RunTimeTicks?: number
  UserData?: JellyfinUserData
  Chapters?: JellyfinChapter[]
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  BackdropImageTags?: string[]
  ParentBackdropItemId?: string
  MediaType: string
}

/**
 * Ask Jellyfin how a given item can be played back for our browser-like
 * device profile. Returns the media sources (with per-stream track info)
 * and the PlaySessionId used for progress reporting.
 */
export async function getPlaybackInfo(itemId: string): Promise<JellyfinPlaybackInfo> {
  const { token, userId } = await authenticate()

  // Device profile modelled on jellyfin-web: broad direct-play for modern
  // browser containers, HLS transcoding fallback for everything else
  // (MKV / HEVC / EAC3 / DTS etc.).
  const deviceProfile = {
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      { Container: "mp4,m4v,mov", Type: "Video", VideoCodec: "h264,hevc,vp8,vp9,av1", AudioCodec: "aac,mp3,ac3,eac3,opus,flac,vorbis" },
      { Container: "webm", Type: "Video", VideoCodec: "vp8,vp9,av1", AudioCodec: "vorbis,opus" },
    ],
    TranscodingProfiles: [
      { Container: "ts", Type: "Video", VideoCodec: "h264", AudioCodec: "aac,mp3", Protocol: "hls", BreakOnNonKeyFrames: true, MinSegments: 1, SegmentLength: 6 },
    ],
    ContainerProfiles: [],
    CodecProfiles: [],
    SubtitleProfiles: [{ Format: "vtt", Method: "External" }],
  }

  const res = await jellyfinFetch(
    `${BASE}/Items/${itemId}/PlaybackInfo?userId=${userId}`,
    {
      method: "POST",
      headers: getAuthHeaders(token),
      body: JSON.stringify({ DeviceProfile: deviceProfile }),
    },
  )
  if (!res.ok) throw new Error(`Jellyfin PlaybackInfo error: ${res.status}`)
  return res.json()
}

/** Full detail for one item, including UserData (resume position) and Chapters. */
export async function getItemDetail(itemId: string): Promise<JellyfinItemDetail | null> {
  const { token, userId } = await authenticate()
  const params = new URLSearchParams({ fields: "Chapters,Overview,MediaSources" })
  const res = await jellyfinFetch(`${BASE}/Users/${userId}/Items/${itemId}?${params}`, {
    headers: getAuthHeaders(token),
  })
  if (!res.ok) return null
  return res.json()
}

// ── Playback progress reporting ──

export type PlaybackReport = {
  itemId: string
  mediaSourceId?: string
  playSessionId?: string
  positionTicks: number
  isPaused?: boolean
  isMuted?: boolean
  volumeLevel?: number
  playMethod?: "DirectPlay" | "DirectStream" | "Transcode"
  event: "start" | "progress" | "stopped"
}

/**
 * POST /Sessions/Playing | /Sessions/Playing/Progress | /Sessions/Playing/Stopped
 */
export async function reportPlaybackState(report: PlaybackReport): Promise<void> {
  const { token } = await authenticate()
  const path =
    report.event === "start"
      ? "/Sessions/Playing"
      : report.event === "stopped"
        ? "/Sessions/Playing/Stopped"
        : "/Sessions/Playing/Progress"

  await jellyfinFetch(`${BASE}${path}`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: JSON.stringify({
      ItemId: report.itemId,
      MediaSourceId: report.mediaSourceId,
      PlaySessionId: report.playSessionId,
      PositionTicks: report.positionTicks,
      CanSeek: true,
      IsPaused: report.isPaused ?? false,
      IsMuted: report.isMuted ?? false,
      VolumeLevel: report.volumeLevel ?? 100,
      PlayMethod: report.playMethod ?? "Transcode",
      RepeatMode: "RepeatNone",
    }),
  }).catch(() => {
    /* progress reporting must never throw */
  })
}

/** Mark an item as fully watched (played). */
export async function markItemPlayed(itemId: string): Promise<void> {
  const { token, userId } = await authenticate()
  await jellyfinFetch(`${BASE}/Users/${userId}/PlayedItems/${itemId}`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: JSON.stringify({}),
  }).catch(() => {})
}

/** Mark an item as unwatched. */
export async function markItemUnplayed(itemId: string): Promise<void> {
  const { token, userId } = await authenticate()
  await jellyfinFetch(`${BASE}/Users/${userId}/PlayedItems/${itemId}`, {
    method: "DELETE",
    headers: getAuthHeaders(token),
  }).catch(() => {})
}

// ── Stream URL builders (quality / track aware) ──

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

function applyStreamParams(params: URLSearchParams, opts: StreamOptions) {
  if (opts.mediaSourceId) params.set("mediaSourceId", opts.mediaSourceId)
  if (opts.playSessionId) params.set("playSessionId", opts.playSessionId)
  if (opts.audioStreamIndex != null) params.set("audioStreamIndex", String(opts.audioStreamIndex))
  if (opts.subtitleStreamIndex != null) params.set("subtitleStreamIndex", String(opts.subtitleStreamIndex))
  if (opts.maxStreamingBitrate) params.set("maxStreamingBitrate", String(opts.maxStreamingBitrate))
  if (opts.maxWidth) params.set("maxWidth", String(opts.maxWidth))
  if (opts.maxHeight) params.set("maxHeight", String(opts.maxHeight))
  if (opts.startTimeTicks) params.set("startTimeTicks", String(opts.startTimeTicks))
}

/** Transcoded HLS master playlist URL (adaptive + quality-limited). */
export function buildHlsStreamUrl(itemId: string, token: string, opts: StreamOptions = {}): string {
  const params = new URLSearchParams({ api_key: token })
  params.set("videoCodec", opts.videoCodec ?? "h264")
  // Only MSE-friendly audio codecs — if the source carries EAC3/DTS the
  // server must transcode to AAC. Allowing AC3/EAC3 here makes Jellyfin
  // *copy* the incompatible track into the TS segments, and Chrome's
  // MediaSource stalls forever (video never starts, "buffering" spinner).
  params.set("audioCodec", opts.audioCodec ?? "aac,mp3")
  params.set("segmentContainer", "ts")
  applyStreamParams(params, opts)
  return `${BASE}/Videos/${itemId}/master.m3u8?${params}`
}

/** Direct-play URL; audioStreamIndex only takes effect when remuxing. */
export function buildDirectStreamUrl(itemId: string, token: string, opts: StreamOptions = {}): string {
  const params = new URLSearchParams({ api_key: token, static: "true" })
  applyStreamParams(params, opts)
  return `${BASE}/Videos/${itemId}/stream?${params}`
}

/**
 * External subtitle text track, served through the app's same-origin proxy
 * (converted server-side by Jellyfin). Same-origin keeps browser fetches free
 * of CORS issues and never exposes the API token.
 */
export function buildSubtitleUrl(
  itemId: string,
  mediaSourceId: string,
  streamIndex: number,
  format = "vtt",
): string {
  return `/api/jellyfin/subtitles/${itemId}/${mediaSourceId}/${streamIndex}?format=${format}`
}

export function buildItemImageUrl(itemId: string, token: string, type = "Thumb", maxWidth?: number): string {
  const params = new URLSearchParams({ api_key: token })
  if (maxWidth) params.set("maxWidth", String(maxWidth))
  return `${BASE}/Items/${itemId}/Images/${type}?${params}`
}

// ── Intro Skipper plugin markers ──

type IntroSkipperSegment = { start: number; end: number }

/**
 * Queries the community Intro Skipper plugin, if installed.
 * Returns null on any failure. Values are normalised to seconds.
 */
export async function getIntroSkipperSegments(
  itemId: string,
): Promise<Record<string, IntroSkipperSegment> | null> {
  const { token } = await authenticate()
  const res = await jellyfinFetch(`${BASE}/Episode/${itemId}/IntroSkipperSegments`, {
    headers: getAuthHeaders(token),
  }).catch(() => null)
  if (!res || !res.ok) return null

  try {
    const raw = (await res.json()) as Record<
      string,
      { SegmentStart?: number; SegmentEnd?: number; StartTicks?: number; EndTicks?: number } | undefined
    >
    const out: Record<string, IntroSkipperSegment> = {}
    for (const [key, seg] of Object.entries(raw)) {
      if (!seg) continue
      let start = seg.SegmentStart ?? (seg.StartTicks != null ? ticksToSeconds(seg.StartTicks) : undefined)
      let end = seg.SegmentEnd ?? (seg.EndTicks != null ? ticksToSeconds(seg.EndTicks) : undefined)
      if (start == null || end == null) continue
      // Some plugin versions serialise TimeSpan as ticks — normalise
      if (start > 10_000_000) start = ticksToSeconds(start)
      if (end > 10_000_000) end = ticksToSeconds(end)
      if (end > start) out[key] = { start, end }
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

// ── TV seasons & episodes ──

export type JellyfinSeason = {
  Id: string
  Name: string
  IndexNumber?: number
  ChildCount?: number
  ImageTags?: Record<string, string>
}

export type JellyfinEpisode = {
  Id: string
  Name: string
  IndexNumber?: number
  ParentIndexNumber?: number
  SeasonId?: string
  Overview?: string
  PremiereDate?: string
  RunTimeTicks?: number
  LocationType?: string // "FileSystem" = playable, "Virtual" = missing
  UserData?: JellyfinUserData
  ImageTags?: Record<string, string>
  MediaType: string
  Type: string
}

export async function getSeasons(seriesId: string): Promise<JellyfinSeason[]> {
  const { token, userId } = await authenticate()
  const params = new URLSearchParams({ userId, fields: "ItemCounts" })
  const res = await jellyfinFetch(`${BASE}/Shows/${seriesId}/Seasons?${params}`, {
    headers: getAuthHeaders(token),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.Items ?? []
}

export async function getEpisodes(seriesId: string, seasonId?: string): Promise<JellyfinEpisode[]> {
  const { token, userId } = await authenticate()
  const params = new URLSearchParams({
    userId,
    fields: "Overview,MediaSources,ItemCounts",
    enableImageTypes: "Primary,Thumb",
    imageTypeLimit: "1",
  })
  if (seasonId) params.set("seasonId", seasonId)
  const res = await jellyfinFetch(`${BASE}/Shows/${seriesId}/Episodes?${params}`, {
    headers: getAuthHeaders(token),
  })
  if (!res.ok) return []
  const data = await res.json()
  return data.Items ?? []
}
