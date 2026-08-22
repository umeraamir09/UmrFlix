import { env } from "./env"
import { getSession } from "./auth"
import { getBreaker } from "./circuit-breaker"
import type { CircuitBreaker } from "./circuit-breaker"
import type { TrickplayInfo } from "./playback-types"
import { applyStreamParams, type StreamOptions } from "./url-utils"

const BASE = env("JELLYFIN_URL")
const TIMEOUT = 12_000

const JELLYFIN_BREAKER_OPTIONS = {
  failureThreshold: 5,
  resetTimeoutMs: 15_000,
}

export type JellyfinAuth = {
  token: string
  userId: string
  serverUrl: string
  breaker: CircuitBreaker
}

// Break a Jellyfin server URL down to the identity used for per-session
// circuit-breaker scoping. Data requests are keyed by `${server}:${userId}` so
// one user's failures never open the breaker another user depends on; the
// credential-only auth call is keyed by server alone (no user exists yet).
function serverUrlOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return BASE || "jellyfin"
  }
}

function breakerKey(serverUrl: string, userId?: string): string {
  return userId ? `jellyfin:${serverUrl}:${userId}` : `jellyfin:${serverUrl}`
}

export class JellyfinAuthError extends Error {
  constructor(message = "Jellyfin session token expired or invalid (401)") {
    super(message)
    this.name = "JellyfinAuthError"
  }
}

async function jellyfinFetch(url: string, options?: RequestInit, breaker?: CircuitBreaker): Promise<Response> {
  const circuit = breaker ?? getBreaker(breakerKey(serverUrlOf(url)), {
    name: `Jellyfin:${serverUrlOf(url)}`,
    ...JELLYFIN_BREAKER_OPTIONS,
  })
  if (!circuit.canExecute()) {
    throw new Error(`Jellyfin service is currently unavailable (circuit open).`)
  }

  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    if (res.status === 401) {
      tokenCache.delete(serverUrlOf(url)) // re-auth next time
      // 401 is an authorization issue, not a service outage — do not trip breaker
      throw new JellyfinAuthError(`Jellyfin authentication failed (401): ${url}`)
    }
    if (res.ok || res.status < 500) {
      circuit.recordSuccess()
    } else {
      circuit.recordFailure()
    }
    return res
  } catch (err) {
    if (!(err instanceof JellyfinAuthError)) {
      circuit.recordFailure()
    }
    throw err
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
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  UserData?: JellyfinUserData
}

export type JellyfinItemsResponse = {
  Items: JellyfinItem[]
  TotalRecordCount: number
}

// Fallback credentials cache — only used when there is NO active user session
// (server-side flows like watch party). Scoped per server URL and never shared
// across different accounts, so one session can't leak or clobber another's token.
const tokenCache = new Map<string, { token: string; userId: string; serverUrl: string }>()
const authPromises = new Map<string, Promise<{ token: string; userId: string; serverUrl: string }>>()

/**
 * Builds standard Jellyfin Authorization header value.
 * Omits Token when not yet authenticated (login calls).
 */
export function jellyfinAuthHeader(opts: {
  client?: string
  device?: string
  deviceId?: string
  version?: string
  token?: string
}): string {
  const parts = [
    `Client="${opts.client ?? "UmrFlix"}"`,
    `Device="${opts.device ?? "UmrFlix Server"}"`,
    `DeviceId="${opts.deviceId ?? "umrflix-server-001"}"`,
    `Version="${opts.version ?? "1.0.0"}"`,
  ]
  if (opts.token) parts.push(`Token="${opts.token}"`)
  return `MediaBrowser ${parts.join(", ")}`
}

export async function authenticate(): Promise<JellyfinAuth> {
  // Check active user session first (server-side)
  try {
    const session = await getSession()
    if (session?.accessToken && session?.userId) {
      const serverUrl = session.serverUrl || BASE || "http://localhost:8096"
      return {
        token: session.accessToken,
        userId: session.userId,
        serverUrl,
        breaker: getBreaker(breakerKey(serverUrl, session.userId), {
          name: `Jellyfin:${serverUrl}`,
          ...JELLYFIN_BREAKER_OPTIONS,
        }),
      }
    }
  } catch {
    /* fallback to environment credentials */
  }

  const serverUrl = BASE || "http://localhost:8096"
  const cached = tokenCache.get(serverUrl)
  if (cached) return { ...cached, breaker: getBreaker(breakerKey(serverUrl, cached.userId), { name: `Jellyfin:${serverUrl}`, ...JELLYFIN_BREAKER_OPTIONS }) }

  const inFlight = authPromises.get(serverUrl)
  if (inFlight) {
    const resolved = await inFlight
    return { ...resolved, breaker: getBreaker(breakerKey(serverUrl, resolved.userId), { name: `Jellyfin:${serverUrl}`, ...JELLYFIN_BREAKER_OPTIONS }) }
  }

  const promise = (async () => {
    try {
      const res = await jellyfinFetch(
        `${serverUrl}/Users/AuthenticateByName`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": jellyfinAuthHeader({ device: "UmrFlixServer", deviceId: "umrflix-server-001" }),
            "X-Emby-Authorization":
              'MediaBrowser Client="UmrFlix", Device="UmrFlixServer", DeviceId="umrflix-server-001", Version="1.0.0"',
          },
          body: JSON.stringify({
            Username: env("JELLYFIN_USERNAME"),
            Pw: env("JELLYFIN_PASSWORD"),
          }),
        },
        // No user identity exists yet — auth failures trip the server-scoped breaker
        getBreaker(breakerKey(serverUrl), { name: `Jellyfin:${serverUrl}`, ...JELLYFIN_BREAKER_OPTIONS }),
      )

      if (!res.ok) {
        const body = await res.text().catch(() => "(no body)")
        console.error(`Jellyfin auth error: ${res.status}`, body)
        tokenCache.delete(serverUrl)
        throw new Error(`Jellyfin auth error: ${res.status}`)
      }

      const data: JellyfinAuthResponse = await res.json()
      const cached = { token: data.AccessToken, userId: data.User.Id, serverUrl }
      tokenCache.set(serverUrl, cached)
      return cached
    } catch (err) {
      tokenCache.delete(serverUrl)
      throw err
    } finally {
      authPromises.delete(serverUrl)
    }
  })()

  authPromises.set(serverUrl, promise)
  const resolved = await promise
  return { ...resolved, breaker: getBreaker(breakerKey(serverUrl, resolved.userId), { name: `Jellyfin:${serverUrl}`, ...JELLYFIN_BREAKER_OPTIONS }) }
}


export function getAuthHeaders(token: string): Record<string, string> {
  return {
    "Authorization": jellyfinAuthHeader({ token }),
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
  }, getBreaker(breakerKey(BASE || "http://localhost:8096", userId)))
  if (!res.ok) return []
  const data: JellyfinItemsResponse = await res.json()
  return data.Items ?? []
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
      fields: "ProviderIds,UserData",
      includeItemTypes: "Movie,Series",
    })
    const res = await jellyfinFetch(`${BASE}/Users/${userId}/Items?${params}`, {
      headers: getAuthHeaders(token),
    }, getBreaker(breakerKey(BASE || "http://localhost:8096", userId)))
    if (!res.ok) break
    const data: JellyfinItemsResponse = await res.json()
    const items = data.Items ?? []
    all.push(...items)
    if (items.length < limit) break
    startIndex += limit
  }

  return all
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
  Overview?: string
  IndexNumber?: number // Episode number within its season
  ParentIndexNumber?: number // Season number
  RunTimeTicks?: number
  UserData?: JellyfinUserData
  ImageTags?: Record<string, string>
  BackdropImageTags?: string[]
  ParentBackdropImageTags?: string[]
  ParentBackdropItemId?: string
  ParentThumbItemId?: string
  ParentThumbImageTag?: string
  ProviderIds?: Record<string, string>
  MediaType: string
}

export type JellyfinResumeResponse = {
  Items: JellyfinResumeItem[]
  TotalRecordCount: number
}

/**
 * Fetches the currently in-progress / "continue watching" items for the
 * authenticated Jellyfin user. An explicit `userId` overrides the session's
 * server account so multi-user deployments scope the list correctly (§5.4).
 */
export async function getResumeItems(
  limit = 12,
  opts: { userId?: string } = {},
): Promise<JellyfinResumeItem[]> {
  try {
    const { token, userId: authUserId, breaker } = await authenticate()
    const userId = opts.userId ?? authUserId

    const params = new URLSearchParams({
      limit: String(limit),
      recursive: "true",
      fields: "ProviderIds,Overview",
      enableImageTypes: "Primary,Backdrop,Thumb,Logo",
      imageTypeLimit: "1",
      mediaTypes: "Video",
    })

    const res = await jellyfinFetch(
      `${BASE}/Users/${userId}/Items/Resume?${params}`,
      { headers: getAuthHeaders(token) },
      breaker,
    )

    if (!res.ok) {
      console.error(`Jellyfin resume fetch error: ${res.status}`)
      return []
    }

    const data: JellyfinResumeResponse = await res.json()
    return data.Items ?? []
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error("Failed to fetch Jellyfin resume items:", err)
    return []
  }
}

/**
 * Genuinely completed watches (§6.3): Jellyfin items with the Played flag,
 * most recently played first. The resume list only contains in-progress
 * items, so fully-watched content — the strongest taste signal — was
 * invisible to the personalization engines.
 */
export async function getPlayedItems(
  limit = 20,
  opts: { userId?: string } = {},
): Promise<JellyfinResumeItem[]> {
  try {
    const { token, userId: authUserId, breaker } = await authenticate()
    const userId = opts.userId ?? authUserId

    const params = new URLSearchParams({
      userId,
      limit: String(limit),
      recursive: "true",
      fields: "ProviderIds,Overview",
      filters: "IsPlayed",
      sortBy: "DatePlayed",
      sortOrder: "Descending",
      includeItemTypes: "Movie,Series",
      enableImageTypes: "Primary,Backdrop,Thumb,Logo",
      imageTypeLimit: "1",
    })

    const res = await jellyfinFetch(
      `${BASE}/Users/${userId}/Items?${params}`,
      { headers: getAuthHeaders(token) },
      breaker,
    )

    if (!res.ok) {
      console.error(`Jellyfin played-items fetch error: ${res.status}`)
      return []
    }

    const data: JellyfinResumeResponse = await res.json()
    return data.Items ?? []
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error("Failed to fetch Jellyfin played items:", err)
    return []
  }
}

/**
 * Fetches the "next up" episodes for the authenticated user — the next
 * unwatched episode per series. `enableResumable=false` keeps episodes that
 * are already in progress out of the results, so the same episode never
 * appears in both Continue Watching and Next Up.
 */
export async function getNextUpItems(
  limit = 12,
): Promise<JellyfinResumeItem[]> {
  try {
    const { token, userId, breaker } = await authenticate()

    const params = new URLSearchParams({
      userId,
      limit: String(limit),
      fields: "ProviderIds,Overview",
      enableImageTypes: "Primary,Backdrop,Thumb,Logo",
      imageTypeLimit: "1",
      enableResumable: "false",
      enableRewatching: "false",
      enableUserData: "true",
    })

    const res = await jellyfinFetch(
      `${BASE}/Shows/NextUp?${params}`,
      { headers: getAuthHeaders(token) },
      breaker,
    )

    if (!res.ok) {
      console.error(`Jellyfin next-up fetch error: ${res.status}`)
      return []
    }

    const data: JellyfinResumeResponse = await res.json()
    return data.Items ?? []
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error("Failed to fetch Jellyfin next-up items:", err)
    return []
  }
}

/**
 * Build a working image URL for a Jellyfin item.
 * Routes images through the secured `/api/jellyfin/image/[id]` proxy.
 */
export function buildJellyfinImageUrl(
  item: JellyfinResumeItem,
  type: "Primary" | "Backdrop" | "Thumb" | "Logo" = "Backdrop",
): string {
  // For episodes/movies in Continue Watching, match Jellyfin web client's card image selection:
  if (type === "Backdrop" || type === "Thumb") {
    if (item.Type === "Episode") {
      // TV Episodes: prefer parent series Thumb / Backdrop so the card shows series artwork instead of raw episode video frames
      if (item.ParentThumbItemId && item.ParentThumbImageTag) {
        return `/api/jellyfin/image/${item.ParentThumbItemId}?type=Thumb`
      }
      if (item.ParentBackdropItemId && item.ParentBackdropImageTags && item.ParentBackdropImageTags.length > 0) {
        return `/api/jellyfin/image/${item.ParentBackdropItemId}?type=Backdrop`
      }
      if (item.SeriesId) {
        return `/api/jellyfin/image/${item.SeriesId}?type=Thumb`
      }
      if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
        return `/api/jellyfin/image/${item.Id}?type=Backdrop`
      }
    } else {
      // For Movies, Series, etc.: prefer item's landscape Thumb (16:9 artwork with title logo baked in), then Backdrop
      if (item.ImageTags?.Thumb) {
        return `/api/jellyfin/image/${item.Id}?type=Thumb`
      }
      if (item.BackdropImageTags && item.BackdropImageTags.length > 0) {
        return `/api/jellyfin/image/${item.Id}?type=Backdrop`
      }
      if (item.ImageTags?.Primary) {
        return `/api/jellyfin/image/${item.Id}?type=Primary`
      }
    }
  }

  // Logo: if an episode doesn't have a logo tag itself, check series / parent item
  if (type === "Logo") {
    if (item.ImageTags?.Logo) {
      return `/api/jellyfin/image/${item.Id}?type=Logo`
    }
    if (item.SeriesId) {
      return `/api/jellyfin/image/${item.SeriesId}?type=Logo`
    }
    if (item.ParentBackdropItemId) {
      return `/api/jellyfin/image/${item.ParentBackdropItemId}?type=Logo`
    }
  }

  return `/api/jellyfin/image/${item.Id}?type=${type}`
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
  ImageTag?: string
}

/**
 * Server-side shape of one trickplay resolution entry as Jellyfin serialises
 * it (fields=Trickplay). Interval is in milliseconds. Bandwidth is unused.
 */
export type JellyfinTrickplayInfo = {
  Width: number
  Height: number
  TileWidth: number
  TileHeight: number
  ThumbnailCount: number
  Interval: number
  Bandwidth?: number
}

export type JellyfinItemDetail = {
  Id: string
  Name: string
  Type: string
  RunTimeTicks?: number
  ProviderIds?: Record<string, string>
  UserData?: JellyfinUserData
  Chapters?: JellyfinChapter[]
  SeriesId?: string
  SeriesName?: string
  ParentIndexNumber?: number
  IndexNumber?: number
  BackdropImageTags?: string[]
  ParentBackdropItemId?: string
  MediaType: string
  /** Nested: Trickplay[mediaSourceId][width] → TrickplayInfo (verified against Jellyfin 10.11). */
  Trickplay?: Record<string, Record<string, JellyfinTrickplayInfo>>
}

const TRICKPLAY_TARGET_WIDTH = 320

/**
 * Picks the best trickplay resolution for seek-bar previews — the smallest
 * width >= TRICKPLAY_TARGET_WIDTH, else the largest available. Prefers the
 * media source actually being played; falls back to any available source.
 * Returns null when the server hasn't generated trickplay images for the item.
 */
export function pickTrickplayInfo(
  map: Record<string, Record<string, JellyfinTrickplayInfo>> | undefined | null,
  mediaSourceId?: string,
): TrickplayInfo | null {
  if (!map) return null
  const widthMap =
    (mediaSourceId ? map[mediaSourceId] : undefined) ?? Object.values(map)[0]
  if (!widthMap) return null
  const candidates = Object.entries(widthMap)
    .map(([width, info]) => ({ width: Number(width), info }))
    .filter(
      ({ width, info }) =>
        Number.isFinite(width) &&
        width > 0 &&
        info != null &&
        info.Width > 0 &&
        info.Height > 0 &&
        info.TileWidth > 0 &&
        info.TileHeight > 0 &&
        info.ThumbnailCount > 0 &&
        info.Interval > 0,
    )
    .sort((a, b) => a.width - b.width)
  if (candidates.length === 0) return null
  const chosen =
    candidates.find((c) => c.width >= TRICKPLAY_TARGET_WIDTH) ??
    candidates[candidates.length - 1]
  const { info } = chosen
  return {
    width: info.Width,
    height: info.Height,
    tileWidth: info.TileWidth,
    tileHeight: info.TileHeight,
    thumbnailCount: info.ThumbnailCount,
    interval: info.Interval,
  }
}

/**
 * Ask Jellyfin how a given item can be played back for our browser-like
 * device profile. Returns the media sources (with per-stream track info)
 * and the PlaySessionId used for progress reporting.
 */
export async function getPlaybackInfo(itemId: string): Promise<JellyfinPlaybackInfo> {
  const { token, userId, breaker } = await authenticate()

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
      { Container: "mkv", Type: "Video", VideoCodec: "h264,hevc,vp8,vp9,av1", AudioCodec: "aac,mp3,ac3,eac3,opus,flac,vorbis" },
    ],
    TranscodingProfiles: [
      {
        Container: "mp4",
        Type: "Video",
        VideoCodec: "h264,hevc",
        AudioCodec: "aac,mp3,opus",
        Protocol: "hls",
        BreakOnNonKeyFrames: true,
        MinSegments: 1,
        SegmentLength: 6,
        EnableMuxing: true,
      },
      {
        Container: "ts",
        Type: "Video",
        VideoCodec: "h264",
        AudioCodec: "aac,mp3",
        Protocol: "hls",
        BreakOnNonKeyFrames: true,
        MinSegments: 1,
        SegmentLength: 6,
      },
    ],
    ContainerProfiles: [
      {
        Type: "Video",
        Container: "mkv",
        Conditions: [],
      },
    ],
    CodecProfiles: [
      {
        Type: "Video",
        Codec: "h264",
        Conditions: [
          { Condition: "EqualsAny", Property: "VideoProfile", Value: "high|main|baseline|constrained baseline" },
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "52" },
        ],
      },
      {
        Type: "Video",
        Codec: "hevc",
        Conditions: [
          { Condition: "EqualsAny", Property: "VideoProfile", Value: "main|main 10" },
          { Condition: "LessThanEqual", Property: "VideoLevel", Value: "153" },
        ],
      },
    ],
    SubtitleProfiles: [
      { Format: "vtt", Method: "External" },
      { Format: "vtt", Method: "Embed" },
      { Format: "vtt", Method: "Encode" },
      { Format: "srt", Method: "External" },
      { Format: "srt", Method: "Embed" },
      { Format: "srt", Method: "Encode" },
      { Format: "ass", Method: "External" },
      { Format: "ass", Method: "Embed" },
      { Format: "ass", Method: "Encode" },
      { Format: "ssa", Method: "Embed" },
      { Format: "ssa", Method: "Encode" },
      { Format: "pgssub", Method: "Embed" },
      { Format: "pgssub", Method: "Encode" },
      { Format: "dvdsub", Method: "Embed" },
      { Format: "dvdsub", Method: "Encode" },
      { Format: "subrip", Method: "External" },
      { Format: "subrip", Method: "Encode" },
    ],
  }

  const res = await jellyfinFetch(
    `${BASE}/Items/${itemId}/PlaybackInfo?userId=${userId}`,
    {
      method: "POST",
      headers: getAuthHeaders(token),
      body: JSON.stringify({ DeviceProfile: deviceProfile }),
    },
    breaker,
  )
  if (!res.ok) throw new Error(`Jellyfin PlaybackInfo error: ${res.status}`)
  return res.json()
}

/** Full detail for one item, including UserData (resume position) and Chapters. */
export async function getItemDetail(itemId: string): Promise<JellyfinItemDetail | null> {
  const { token, userId, breaker } = await authenticate()
  const params = new URLSearchParams({ fields: "Chapters,Overview,MediaSources,Trickplay,ProviderIds" })
  const res = await jellyfinFetch(`${BASE}/Users/${userId}/Items/${itemId}?${params}`, {
    headers: getAuthHeaders(token),
  }, breaker)
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
  context?: string
}

/**
 * POST /Sessions/Playing | /Sessions/Playing/Progress | /Sessions/Playing/Stopped
 */
export async function reportPlaybackState(report: PlaybackReport): Promise<void> {
  const { token, breaker } = await authenticate()
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
  }, breaker).catch(() => {
    /* progress reporting must never throw */
  })
}

/** Mark an item as fully watched (played). Throws so callers/route handlers
 *  can surface failures instead of silently reporting success. */
export async function markItemPlayed(itemId: string): Promise<void> {
  const { token, userId, breaker } = await authenticate()
  await jellyfinFetch(`${BASE}/Users/${userId}/PlayedItems/${itemId}`, {
    method: "POST",
    headers: getAuthHeaders(token),
    body: JSON.stringify({}),
  }, breaker)
}

/** Mark an item as unwatched. Throws so callers/route handlers can surface failures. */
export async function markItemUnplayed(itemId: string): Promise<void> {
  const { token, userId, breaker } = await authenticate()
  await jellyfinFetch(`${BASE}/Users/${userId}/PlayedItems/${itemId}`, {
    method: "DELETE",
    headers: getAuthHeaders(token),
  }, breaker)
}

// ── Stream URL builders (quality / track aware) ──

/** Transcoded HLS master playlist URL (adaptive + quality-limited).
 *  Returns a same-origin proxy URL — token is added server-side. */
export function buildHlsStreamUrl(itemId: string, _token: string, opts: StreamOptions = {}): string {
  const params = new URLSearchParams()
  params.set("videoCodec", opts.videoCodec ?? "h264,hevc")
  params.set("audioCodec", opts.audioCodec ?? "aac,mp3")
  // HLS segment container must be a single value — Jellyfin matches the
  // whole string against known containers, so "ts,fmp4" would match nothing
  // and silently fall back to TS. fmp4 = fragmented MP4 segments.
  params.set("segmentContainer", "fmp4")
  applyStreamParams(params, opts)
  return `/api/jellyfin/proxy/Videos/${itemId}/master.m3u8?${params}`
}

/** Direct-play URL; audioStreamIndex only takes effect when remuxing.
 *  Returns a same-origin proxy URL — token is added server-side. */
export function buildDirectStreamUrl(itemId: string, _token: string, opts: StreamOptions = {}): string {
  const params = new URLSearchParams({ static: "true" })
  applyStreamParams(params, opts)
  return `/api/jellyfin/proxy/Videos/${itemId}/stream?${params}`
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

export function buildItemImageUrl(itemId: string, _token: string, type = "Thumb", maxWidth?: number): string {
  const params = new URLSearchParams()
  if (maxWidth) params.set("maxWidth", String(maxWidth))
  return `/api/jellyfin/proxy/Items/${itemId}/Images/${type}?${params}`
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
  const { token, breaker } = await authenticate()
  const res = await jellyfinFetch(`${BASE}/Episode/${itemId}/IntroSkipperSegments`, {
    headers: getAuthHeaders(token),
  }, breaker).catch(() => null)
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

export type JellyfinMediaSegment = {
  type: "intro" | "recap" | "outro" | "preview"
  start: number
  end: number
}

/**
 * Queries Jellyfin's native Media Segments API (Jellyfin 10.10+).
 * Types are standardised by the server: Intro, Recap, Outro, Preview, Commercial.
 * Commercials are intentionally ignored. Returns null when unavailable
 * (older server / no segments), so callers can fall back to other sources.
 */
export async function getMediaSegments(itemId: string): Promise<JellyfinMediaSegment[] | null> {
  const { token, breaker } = await authenticate()
  const res = await jellyfinFetch(`${BASE}/MediaSegments/${itemId}`, {
    headers: getAuthHeaders(token),
  }, breaker).catch(() => null)
  if (!res || !res.ok) return null

  try {
    const raw = (await res.json()) as {
      Items?: { Type?: string; StartTicks?: number; EndTicks?: number }[]
    }
    const typeMap: Record<string, JellyfinMediaSegment["type"]> = {
      Intro: "intro",
      Recap: "recap",
      Outro: "outro",
      Preview: "preview",
    }
    const out: JellyfinMediaSegment[] = []
    for (const seg of raw.Items ?? []) {
      const type = seg.Type ? typeMap[seg.Type] : undefined
      if (!type || seg.StartTicks == null || seg.EndTicks == null) continue
      const start = ticksToSeconds(seg.StartTicks)
      const end = ticksToSeconds(seg.EndTicks)
      if (end > start) out.push({ type, start, end })
    }
    return out.length > 0 ? out : null
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
  const { token, userId, breaker } = await authenticate()
  const params = new URLSearchParams({ userId, fields: "ItemCounts" })
  const res = await jellyfinFetch(`${BASE}/Shows/${seriesId}/Seasons?${params}`, {
    headers: getAuthHeaders(token),
  }, breaker)
  if (!res.ok) return []
  const data = await res.json()
  return data.Items ?? []
}

export async function getEpisodes(seriesId: string, seasonId?: string): Promise<JellyfinEpisode[]> {
  const { token, userId, breaker } = await authenticate()
  const params = new URLSearchParams({
    userId,
    fields: "Overview,MediaSources,ItemCounts",
    enableImageTypes: "Primary,Thumb",
    imageTypeLimit: "1",
  })
  if (seasonId) params.set("seasonId", seasonId)
  const res = await jellyfinFetch(`${BASE}/Shows/${seriesId}/Episodes?${params}`, {
    headers: getAuthHeaders(token),
  }, breaker)
  if (!res.ok) return []
  const data = await res.json()
  return data.Items ?? []
}

// ── Favorites / Watchlist Sync ──

export async function getUserFavorites(overrideUserId?: string, overrideToken?: string): Promise<JellyfinItem[]> {
  const auth =
    overrideUserId && overrideToken
      ? {
          userId: overrideUserId,
          token: overrideToken,
          breaker: getBreaker(breakerKey(BASE || "http://localhost:8096", overrideUserId)),
        }
      : await authenticate()
  const params = new URLSearchParams({
    userId: auth.userId,
    filters: "IsFavorite",
    recursive: "true",
    fields: "ProviderIds,Overview,PrimaryImageTag,BackdropImageTags,UserData",
    includeItemTypes: "Movie,Series",
  })

  const res = await jellyfinFetch(`${BASE}/Users/${auth.userId}/Items?${params}`, {
    headers: getAuthHeaders(auth.token),
  }, auth.breaker)

  if (!res.ok) return []
  const data: JellyfinItemsResponse = await res.json()
  return data.Items ?? []
}

export async function setFavoriteItem(
  itemId: string,
  isFavorite: boolean,
  overrideUserId?: string,
  overrideToken?: string
): Promise<boolean> {
  const auth =
    overrideUserId && overrideToken
      ? {
          userId: overrideUserId,
          token: overrideToken,
          breaker: getBreaker(breakerKey(BASE || "http://localhost:8096", overrideUserId)),
        }
      : await authenticate()
  const path = `${BASE}/Users/${auth.userId}/FavoriteItems/${itemId}`
  const method = isFavorite ? "POST" : "DELETE"

  const res = await jellyfinFetch(path, {
    method,
    headers: getAuthHeaders(auth.token),
  }, auth.breaker).catch((err) => {
    if (err instanceof JellyfinAuthError) throw err
    return null
  })

  return Boolean(res && res.ok)
}

// ── Active Sessions & Stream Monitoring ──

export type JellyfinSession = {
  Id: string
  UserId?: string
  UserName?: string
  Client?: string
  DeviceName?: string
  NowPlayingItem?: {
    Id: string
    Name: string
    SeriesName?: string
    Type: string
    RunTimeTicks?: number
    MediaType?: string
  }
  PlayState?: {
    PositionTicks?: number
    IsPaused?: boolean
  }
  TranscodingInfo?: {
    AudioCodec?: string
    VideoCodec?: string
    IsVideoDirect?: boolean
    IsAudioDirect?: boolean
    Bitrate?: number
    TranscodeReason?: string
  }
}

export async function getActiveSessions(): Promise<JellyfinSession[]> {
  try {
    const { token, breaker } = await authenticate()
    const res = await jellyfinFetch(`${BASE}/Sessions`, {
      headers: getAuthHeaders(token),
    }, breaker)
    if (!res.ok) return []
    const data: JellyfinSession[] = await res.json()
    return data.filter((s) => s.NowPlayingItem != null)
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    return []
  }
}

export async function stopSession(sessionId: string): Promise<boolean> {
  try {
    const { token, breaker } = await authenticate()
    const res = await jellyfinFetch(`${BASE}/Sessions/${sessionId}/Stop`, {
      method: "POST",
      headers: getAuthHeaders(token),
    }, breaker)
    return res.ok
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    return false
  }
}

export type JellyfinUserPublic = {
  Id: string
  Name: string
  PrimaryImageTag?: string
}

let adminUserIdsCache: { ids: string[]; timestamp: number } = { ids: [], timestamp: 0 }
const ADMIN_LIST_TTL_MS = 60_000

export async function getJellyfinAdmins(): Promise<string[]> {
  if (Date.now() - adminUserIdsCache.timestamp < ADMIN_LIST_TTL_MS) {
    return adminUserIdsCache.ids
  }

  try {
    const { token } = await authenticate()

    // /Users works on all Jellyfin versions and returns Policy.IsAdministrator.
    // /Users/Query is 10.9+ only and requires the token to have admin scope — it
    // returns 403 when called with a regular user token, producing an empty list.
    const res = await jellyfinFetch(`${BASE}/Users`, {
      headers: getAuthHeaders(token),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => "(no body)")
      console.error(`[Notif][getJellyfinAdmins] /Users returned ${res.status} — cannot resolve admins. Body: ${body}`)
      adminUserIdsCache = { ids: [], timestamp: Date.now() }
      return []
    }

    const rawUsers: { Id?: string; Name?: string; Policy?: { IsAdministrator?: boolean } }[] = await res.json()

    const ids = rawUsers
      .filter((u) => u?.Id && u?.Policy?.IsAdministrator === true)
      .map((u) => u.Id as string)

    adminUserIdsCache = { ids, timestamp: Date.now() }
    return ids
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    adminUserIdsCache = { ids: [], timestamp: Date.now() }
    console.error("[Notif][getJellyfinAdmins] Exception — failed to resolve admin IDs:", err)
    return []
  }
}

export async function getJellyfinUsers(): Promise<JellyfinUserPublic[]> {
  try {
    const { token, breaker } = await authenticate()
    const res = await jellyfinFetch(`${BASE}/Users`, {
      headers: getAuthHeaders(token),
    }, breaker)
    if (!res.ok) return []
    const users: JellyfinUserPublic[] = await res.json()
    return users ?? []
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error("Failed to fetch Jellyfin users:", err)
    return []
  }
}

/**
 * Triggers a full library scan / refresh on the Jellyfin server.
 * POST /Library/Refresh
 */
export async function triggerLibraryScan(): Promise<boolean> {
  try {
    const { token, breaker } = await authenticate()
    const res = await jellyfinFetch(`${BASE}/Library/Refresh`, {
      method: "POST",
      headers: getAuthHeaders(token),
    }, breaker)
    return res.ok
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error("Failed to trigger Jellyfin library scan:", err)
    return false
  }
}

/**
 * Deletes an item and its media files from Jellyfin.
 * DELETE /Items/{itemId}
 */
export async function deleteJellyfinItem(itemId: string): Promise<boolean> {
  try {
    const { token, breaker } = await authenticate()
    const res = await jellyfinFetch(`${BASE}/Items/${itemId}`, {
      method: "DELETE",
      headers: getAuthHeaders(token),
    }, breaker)
    return res.ok
  } catch (err) {
    if (err instanceof JellyfinAuthError) throw err
    console.error(`Failed to delete Jellyfin item ${itemId}:`, err)
    return false
  }
}






