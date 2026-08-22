import { ConvexHttpClient } from "convex/browser"
import { api } from "../../../convex/_generated/api"
import { padToFeatureDim } from "./vector"

/**
 * Persistence layer for the discovery engine.
 *
 * Convex (self-hosted or cloud) is the primary store, reached through the
 * same ConvexHttpClient pattern as the other *-store modules. When Convex is
 * unreachable (dev machines without a deployment), events fall back to a
 * bounded in-memory buffer so the pipeline keeps working within the process.
 */

export type DiscoveryEvent = {
  userId: string
  profileId: string
  itemId: string
  tmdbId?: number
  mediaType?: "movie" | "tv"
  title?: string
  eventType:
    | "play_complete"
    | "partial_play"
    | "abandonment"
    | "rewatch"
    | "favorite"
    | "unfavorite"
    | "request"
    | "rating"
    | "scroll_pass"
  weight?: number
  completionPct?: number
  watchDurationSec?: number
  context?: string
  timestamp: number
}

export type PersistedProfile = {
  shortTermVector: number[]
  longTermVector: number[]
  lastActiveTimestamp: number
  updatedAt: number
}

export type RowStats = {
  rowCategoryKey: string
  totalImpressions: number
  totalClicks: number
  totalPlays: number
}

export type RowFatigue = {
  rowCategoryKey: string
  unclickedImpressions: number
  lastSeenTimestamp: number
}

/** Scoring metadata + vector for one catalog item (cached in cacheStore). */
export type ItemProfile = {
  tmdbId: number
  mediaType: "movie" | "tv"
  title: string
  genreIds: number[]
  releaseYear: number | null
  releaseDate: string | null
  runtimeMinutes: number | null
  castNames: string[]
  directorNames: string[]
  keywordNames: string[]
  keywords: { id: number; name: string }[]
  popularity: number
  voteAverage: number
  voteCount: number
  vector: number[]
  /** TMDB adult flag (content policy, R0-4). */
  adult?: boolean
  /** US certification / TV rating when known. */
  certification?: string | null
  /** Resolved content-policy demotion multiplier (cached with the profile). */
  suitability?: number
}

// §6.6: codegen-safe function references — renames now fail at compile time.
const logEventRef = api.discovery.logEvent
const getRecentEventsRef = api.discovery.getRecentEvents
const saveFeatureProfileRef = api.discovery.saveFeatureProfile
const getFeatureProfileRef = api.discovery.getFeatureProfile
const recordRowImpressionRef = api.discovery.recordRowImpression
const getRowStatsRef = api.discovery.getRowStats
const recordRowFatigueRef = api.discovery.recordRowFatigueImpression
const resetRowFatigueRef = api.discovery.resetRowFatigue
const getItemFeatureRef = api.discovery.getItemFeature
const setItemFeatureRef = api.discovery.setItemFeature
const getRowFatigueRef = api.discovery.getRowFatigue
const getServeLogRef = api.discovery.getServeLog
const recordServeLogRef = api.discovery.recordServeLog

let cachedClient: ConvexHttpClient | null | undefined
let initFailedAt = 0
/** §6.5: retry a failed client instantiation after this cooldown instead of
 * locking out for the process lifetime. */
const INIT_RETRY_COOLDOWN_MS = 30_000

function getConvexClient(): ConvexHttpClient | null {
  if (cachedClient) return cachedClient
  // A previous instantiation failed — retry once the cooldown elapses
  // (no-URL failures leave initFailedAt at 0 and re-check env cheaply).
  if (cachedClient === null && initFailedAt !== 0 && Date.now() - initFailedAt < INIT_RETRY_COOLDOWN_MS) {
    return null
  }
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY

  if (!url) {
    cachedClient = null
    return null
  }

  try {
    const client = new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true })
    if (adminKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawClient = client as any
      if (typeof rawClient.setAdminAuth === "function") {
        rawClient.setAdminAuth(adminKey)
      } else {
        client.setAuth(adminKey)
      }
    }
    cachedClient = client
    initFailedAt = 0
  } catch (err) {
    console.error("[Discovery] Failed to instantiate ConvexHttpClient:", err)
    cachedClient = null
    initFailedAt = Date.now()
  }
  return cachedClient
}

// ── In-memory fallback buffers (Convex offline / dev) ──

const LOCAL_EVENT_BUFFER_KEY = "__umrflixDiscoveryEvents"
const LOCAL_BUFFER_LIMIT = 2000

function localBuffer(): DiscoveryEvent[] {
  const g = globalThis as Record<string, unknown>
  if (!Array.isArray(g[LOCAL_EVENT_BUFFER_KEY])) g[LOCAL_EVENT_BUFFER_KEY] = []
  return g[LOCAL_EVENT_BUFFER_KEY] as DiscoveryEvent[]
}

function pushLocalEvent(event: DiscoveryEvent) {
  const buffer = localBuffer()
  buffer.push(event)
  if (buffer.length > LOCAL_BUFFER_LIMIT) {
    buffer.splice(0, buffer.length - LOCAL_BUFFER_LIMIT)
  }
}

// ── Events ──

/** Fire-and-forget safe: logs to Convex, else the local buffer. Never throws. */
export async function logDiscoveryEvent(event: DiscoveryEvent): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(logEventRef, event)
      return
    } catch (err) {
      console.error("[Discovery] Failed to log event to Convex, buffering locally:", err)
    }
  }
  pushLocalEvent(event)
}

export async function getRecentDiscoveryEvents(
  userId: string,
  profileId: string,
  sinceTimestamp: number,
  limit = 500
): Promise<DiscoveryEvent[]> {
  const events: DiscoveryEvent[] = []
  const convex = getConvexClient()
  if (convex) {
    try {
      const rows = await convex.query(getRecentEventsRef, {
        userId,
        profileId,
        sinceTimestamp,
        limit,
      })
      // Generated api returns full documents (_id, _creationTime, widened
      // optionals) — narrow back to the DiscoveryEvent shape.
      for (const row of rows ?? []) {
        events.push({
          userId: row.userId,
          profileId: row.profileId,
          itemId: row.itemId,
          tmdbId: row.tmdbId,
          mediaType: row.mediaType === "movie" || row.mediaType === "tv" ? row.mediaType : undefined,
          title: row.title,
          eventType: row.eventType as DiscoveryEvent["eventType"],
          weight: row.weight,
          completionPct: row.completionPct,
          watchDurationSec: row.watchDurationSec,
          context: row.context,
          timestamp: row.timestamp,
        })
      }
    } catch (err) {
      console.error("[Discovery] Failed to query events:", err)
    }
  }

  // Merge any locally buffered events (dev / Convex outage window), deduped
  // by identity — a buffered event can also have landed in Convex on a
  // network-blip retry, which previously double-counted (§6.5).
  const seenEventIds = new Set(events.map(eventIdentity))
  for (const e of localBuffer()) {
    if (e.userId === userId && e.profileId === profileId && e.timestamp >= sinceTimestamp) {
      const id = eventIdentity(e)
      if (seenEventIds.has(id)) continue
      seenEventIds.add(id)
      events.push(e)
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp)
  return events.slice(0, limit)
}

/** Stable per-event identity: same item + type + moment = same signal. */
function eventIdentity(e: DiscoveryEvent): string {
  return `${e.itemId}|${e.eventType}|${e.timestamp}|${e.weight ?? ""}`
}

// ── Feature profiles ──

export async function saveFeatureProfile(
  userId: string,
  profileId: string,
  profile: { shortTermVector: number[]; longTermVector: number[]; lastActiveTimestamp: number }
): Promise<void> {
  const convex = getConvexClient()
  if (!convex) return
  try {
    await convex.mutation(saveFeatureProfileRef, {
      userId,
      profileId,
      shortTermVectorJson: JSON.stringify(profile.shortTermVector),
      longTermVectorJson: JSON.stringify(profile.longTermVector),
      lastActiveTimestamp: profile.lastActiveTimestamp,
    })
  } catch (err) {
    console.error("[Discovery] Failed to persist feature profile:", err)
  }
}

export async function loadFeatureProfile(
  userId: string,
  profileId: string
): Promise<PersistedProfile | null> {
  const convex = getConvexClient()
  if (!convex) return null
  try {
    const row = await convex.query(getFeatureProfileRef, { userId, profileId })
    if (!row) return null
    return {
      shortTermVector: JSON.parse(row.shortTermVectorJson) as number[],
      longTermVector: JSON.parse(row.longTermVectorJson) as number[],
      lastActiveTimestamp: row.lastActiveTimestamp,
      updatedAt: row.updatedAt,
    }
  } catch (err) {
    console.error("[Discovery] Failed to load feature profile:", err)
    return null
  }
}

// ── Row bandit stats ──

const LOCAL_ROW_STATS_KEY = "__umrflixRowStats"
const LOCAL_ROW_FATIGUE_KEY = "__umrflixRowFatigue"

function localRowStatsMap(): Map<string, RowStats> {
  const g = globalThis as Record<string, unknown>
  if (!g[LOCAL_ROW_STATS_KEY]) g[LOCAL_ROW_STATS_KEY] = new Map<string, RowStats>()
  return g[LOCAL_ROW_STATS_KEY] as Map<string, RowStats>
}

function localRowFatigueMap(): Map<string, Map<string, RowFatigue>> {
  const g = globalThis as Record<string, unknown>
  if (!g[LOCAL_ROW_FATIGUE_KEY]) g[LOCAL_ROW_FATIGUE_KEY] = new Map<string, Map<string, RowFatigue>>()
  return g[LOCAL_ROW_FATIGUE_KEY] as Map<string, Map<string, RowFatigue>>
}

export async function recordRowImpression(
  rowCategoryKey: string,
  opts: { clicked?: boolean; played?: boolean } = {}
): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(recordRowImpressionRef, { rowCategoryKey, ...opts })
      return
    } catch (err) {
      console.error("[Discovery] Failed to record row impression in Convex, falling back to in-memory:", err)
    }
  }
  const stats = localRowStatsMap()
  const current = stats.get(rowCategoryKey) ?? {
    rowCategoryKey,
    totalImpressions: 0,
    totalClicks: 0,
    totalPlays: 0,
  }
  current.totalImpressions += 1
  if (opts.clicked) current.totalClicks += 1
  if (opts.played) current.totalPlays += 1
  stats.set(rowCategoryKey, current)
}

export async function getRowStats(): Promise<Map<string, RowStats>> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const rows = await convex.query(getRowStatsRef, {})
      const map = new Map<string, RowStats>()
      for (const row of rows ?? []) {
        map.set(row.rowCategoryKey, {
          rowCategoryKey: row.rowCategoryKey,
          totalImpressions: row.totalImpressions,
          totalClicks: row.totalClicks,
          totalPlays: row.totalPlays,
        })
      }
      return map
    } catch (err) {
      console.error("[Discovery] Failed to load row stats from Convex, falling back to in-memory:", err)
    }
  }
  return new Map(localRowStatsMap())
}

let rowStatsCache: { map: Map<string, RowStats>; timestamp: number } | null = null
const ROW_STATS_CACHE_TTL = 60_000

/** 60s in-memory wrapper around getRowStats for hot request paths. */
export async function getRowStatsCached(): Promise<Map<string, RowStats>> {
  if (rowStatsCache && Date.now() - rowStatsCache.timestamp < ROW_STATS_CACHE_TTL) {
    return rowStatsCache.map
  }
  const map = await getRowStats()
  rowStatsCache = { map, timestamp: Date.now() }
  return map
}

// ── Row fatigue ──

export async function recordRowFatigueImpression(
  userId: string,
  profileId: string,
  rowCategoryKey: string
): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(recordRowFatigueRef, { userId, profileId, rowCategoryKey })
      return
    } catch (err) {
      console.error("[Discovery] Failed to record fatigue impression in Convex, falling back to in-memory:", err)
    }
  }
  const userMap = localRowFatigueMap()
  const userKey = `${userId}:${profileId}`
  if (!userMap.has(userKey)) userMap.set(userKey, new Map<string, RowFatigue>())
  const fatigueMap = userMap.get(userKey)!
  const current = fatigueMap.get(rowCategoryKey) ?? {
    rowCategoryKey,
    unclickedImpressions: 0,
    lastSeenTimestamp: Date.now(),
  }
  current.unclickedImpressions += 1
  current.lastSeenTimestamp = Date.now()
  fatigueMap.set(rowCategoryKey, current)
}

export async function resetRowFatigue(
  userId: string,
  profileId: string,
  rowCategoryKey: string
): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(resetRowFatigueRef, { userId, profileId, rowCategoryKey })
      return
    } catch (err) {
      console.error("[Discovery] Failed to reset fatigue in Convex, falling back to in-memory:", err)
    }
  }
  const userMap = localRowFatigueMap()
  const userKey = `${userId}:${profileId}`
  const fatigueMap = userMap.get(userKey)
  if (fatigueMap?.has(rowCategoryKey)) {
    const current = fatigueMap.get(rowCategoryKey)!
    current.unclickedImpressions = 0
    fatigueMap.set(rowCategoryKey, current)
  }
}

export async function getRowFatigueMap(
  userId: string,
  profileId: string
): Promise<Map<string, RowFatigue>> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const rows = await convex.query(getRowFatigueRef, { userId, profileId })
      const map = new Map<string, RowFatigue>()
      for (const row of rows ?? []) {
        map.set(row.rowCategoryKey, row)
      }
      return map
    } catch (err) {
      console.error("[Discovery] Failed to load row fatigue from Convex, falling back to in-memory:", err)
    }
  }
  const userMap = localRowFatigueMap()
  const userKey = `${userId}:${profileId}`
  const fatigueMap = userMap.get(userKey)
  return fatigueMap ? new Map(fatigueMap) : new Map<string, RowFatigue>()
}

// ── Item profile cache (shared catalog cache in cacheStore) ──

const ITEM_CACHE_PREFIX = "discovery-item:"
const ITEM_MEMORY_TTL = 6 * 60 * 60 * 1000 // 6 hours
const MAX_ITEM_CACHE_SIZE = 500
const itemMemoryCache = new Map<string, { profile: ItemProfile; timestamp: number }>()

/**
 * §6.5: true LRU/TTL sweep — evict *all* expired entries and, when still over
 * the cap, the oldest-accessed entries (Map preserves insertion order; reads
 * re-insert to record recency).
 */
function pruneItemMemoryCache() {
  const now = Date.now()
  for (const [key, entry] of itemMemoryCache.entries()) {
    if (now - entry.timestamp >= ITEM_MEMORY_TTL) {
      itemMemoryCache.delete(key)
    }
  }
  if (itemMemoryCache.size > MAX_ITEM_CACHE_SIZE) {
    const overflow = itemMemoryCache.size - MAX_ITEM_CACHE_SIZE
    const oldest = [...itemMemoryCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
    for (const [key] of oldest) itemMemoryCache.delete(key)
  }
}

export async function getCachedItemProfile(
  mediaType: "movie" | "tv",
  tmdbId: number
): Promise<ItemProfile | null> {
  const itemKey = `${mediaType}:${tmdbId}`
  const memKey = `${ITEM_CACHE_PREFIX}${itemKey}`
  const mem = itemMemoryCache.get(memKey)
  if (mem && Date.now() - mem.timestamp < ITEM_MEMORY_TTL) {
    // LRU touch: re-insert so recency reflects reads, not just writes.
    itemMemoryCache.delete(memKey)
    itemMemoryCache.set(memKey, mem)
    return mem.profile
  }

  const convex = getConvexClient()
  if (!convex) return null
  try {
    const entry = await convex.query(getItemFeatureRef, { itemKey })
    if (!entry) return null
    const parsed = JSON.parse(entry.dataJson) as ItemProfile
    parsed.vector = padToFeatureDim(parsed.vector)
    pruneItemMemoryCache()
    itemMemoryCache.set(memKey, { profile: parsed, timestamp: Date.now() })
    return parsed
  } catch {
    return null
  }
}

export async function setCachedItemProfile(profile: ItemProfile): Promise<void> {
  const itemKey = `${profile.mediaType}:${profile.tmdbId}`
  const memKey = `${ITEM_CACHE_PREFIX}${itemKey}`
  pruneItemMemoryCache()
  itemMemoryCache.set(memKey, { profile, timestamp: Date.now() })

  const convex = getConvexClient()
  if (!convex) return
  try {
    await convex.mutation(setItemFeatureRef, { itemKey, dataJson: JSON.stringify(profile) })
  } catch {
    /* cache writes are best-effort */
  }
}

// ── Cross-surface serve memory ──

export type ServeEntry = { count: number; lastServedAt: number }

export async function getServeLog(
  userId: string,
  profileId: string
): Promise<Map<string, ServeEntry>> {
  const map = new Map<string, ServeEntry>()
  const convex = getConvexClient()
  if (!convex) return map
  try {
    const row = await convex.query(getServeLogRef, { userId, profileId })
    if (row?.servesJson) {
      const parsed: Record<string, ServeEntry> = JSON.parse(row.servesJson)
      for (const [k, v] of Object.entries(parsed)) {
        map.set(k, v)
      }
    }
  } catch (err) {
    console.error("[Discovery] Failed to load serve log:", err)
  }
  return map
}

export async function recordServeLog(
  userId: string,
  profileId: string,
  itemKeys: string[]
): Promise<void> {
  if (itemKeys.length === 0) return
  const convex = getConvexClient()
  if (!convex) return
  try {
    await convex.mutation(recordServeLogRef, { userId, profileId, itemKeys })
  } catch (err) {
    console.error("[Discovery] Failed to record serve log:", err)
  }
}
