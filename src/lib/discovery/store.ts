import { getPostgresStore } from "@/lib/db/store"
import type { StoreOperation } from "@/lib/db/store"

/**
 * Persistence layer for the discovery engine.
 *
 * Postgres is the primary store, reached through the shared server-side pool.
 * Without DATABASE_URL, or if event ingestion is temporarily unavailable,
 * events fall back to a
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
}

type QueryRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>

const logEventRef = "discovery:logEvent" as unknown as MutationRef<DiscoveryEvent, string>
const getRecentEventsRef = "discovery:getRecentEvents" as unknown as QueryRef<
  { userId: string; profileId: string; sinceTimestamp: number; limit?: number },
  DiscoveryEvent[]
>
const saveFeatureProfileRef = "discovery:saveFeatureProfile" as unknown as MutationRef<
  {
    userId: string
    profileId: string
    shortTermVectorJson: string
    longTermVectorJson: string
    lastActiveTimestamp: number
  },
  string
>
const getFeatureProfileRef = "discovery:getFeatureProfile" as unknown as QueryRef<
  { userId: string; profileId: string },
  {
    userId: string
    profileId: string
    shortTermVectorJson: string
    longTermVectorJson: string
    lastActiveTimestamp: number
    updatedAt: number
  } | null
>
const recordRowImpressionRef = "discovery:recordRowImpression" as unknown as MutationRef<
  { rowCategoryKey: string; clicked?: boolean; played?: boolean },
  string
>
const getRowStatsRef = "discovery:getRowStats" as unknown as QueryRef<
  Record<string, never>,
  (RowStats & { lastUpdated: number })[]
>
const recordRowFatigueRef = "discovery:recordRowFatigueImpression" as unknown as MutationRef<
  { userId: string; profileId: string; rowCategoryKey: string },
  string
>
const resetRowFatigueRef = "discovery:resetRowFatigue" as unknown as MutationRef<
  { userId: string; profileId: string; rowCategoryKey: string },
  boolean
>
const getRowFatigueRef = "discovery:getRowFatigue" as unknown as QueryRef<
  { userId: string; profileId: string },
  RowFatigue[]
>
const getItemFeatureRef = "discovery:getItemFeature" as unknown as QueryRef<
  { itemKey: string },
  { itemKey: string; dataJson: string; updatedAt: number } | null
>
const setItemFeatureRef = "discovery:setItemFeature" as unknown as MutationRef<
  { itemKey: string; dataJson: string },
  string
>
const getServeLogRef = "discovery:getServeLog" as unknown as QueryRef<
  { userId: string; profileId: string },
  { userId: string; profileId: string; servesJson: string; updatedAt: number } | null
>
const recordServeLogRef = "discovery:recordServeLog" as unknown as MutationRef<
  { userId: string; profileId: string; itemKeys: string[] },
  string
>

// ── In-memory fallback buffers (Postgres offline / dev) ──

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

/** Fire-and-forget safe: logs to Postgres, else the local buffer. Never throws. */
export async function logDiscoveryEvent(event: DiscoveryEvent): Promise<void> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      await postgres.write(logEventRef, event)
      return
    } catch (err) {
      console.error("[Discovery] Failed to log event to Postgres, buffering locally:", err)
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
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const rows = await postgres.read(getRecentEventsRef, {
        userId,
        profileId,
        sinceTimestamp,
        limit,
      })
      if (Array.isArray(rows)) events.push(...rows)
    } catch (err) {
      console.error("[Discovery] Failed to query events:", err)
    }
  }

  // Merge any locally buffered events (dev / Postgres outage window).
  for (const e of localBuffer()) {
    if (e.userId === userId && e.profileId === profileId && e.timestamp >= sinceTimestamp) {
      events.push(e)
    }
  }

  events.sort((a, b) => b.timestamp - a.timestamp)
  return events.slice(0, limit)
}

// ── Feature profiles ──

export async function saveFeatureProfile(
  userId: string,
  profileId: string,
  profile: { shortTermVector: number[]; longTermVector: number[]; lastActiveTimestamp: number }
): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(saveFeatureProfileRef, {
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
  const postgres = getPostgresStore()
  if (!postgres) return null
  try {
    const row = await postgres.read(getFeatureProfileRef, { userId, profileId })
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

export async function recordRowImpression(
  rowCategoryKey: string,
  opts: { clicked?: boolean; played?: boolean } = {}
): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(recordRowImpressionRef, { rowCategoryKey, ...opts })
  } catch (err) {
    console.error("[Discovery] Failed to record row impression:", err)
  }
}

export async function getRowStats(): Promise<Map<string, RowStats>> {
  const map = new Map<string, RowStats>()
  const postgres = getPostgresStore()
  if (!postgres) return map
  try {
    const rows = await postgres.read(getRowStatsRef, {})
    for (const row of rows ?? []) {
      map.set(row.rowCategoryKey, {
        rowCategoryKey: row.rowCategoryKey,
        totalImpressions: row.totalImpressions,
        totalClicks: row.totalClicks,
        totalPlays: row.totalPlays,
      })
    }
  } catch (err) {
    console.error("[Discovery] Failed to load row stats:", err)
  }
  return map
}

// ── Row fatigue ──

export async function recordRowFatigueImpression(
  userId: string,
  profileId: string,
  rowCategoryKey: string
): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(recordRowFatigueRef, { userId, profileId, rowCategoryKey })
  } catch (err) {
    console.error("[Discovery] Failed to record fatigue impression:", err)
  }
}

export async function resetRowFatigue(
  userId: string,
  profileId: string,
  rowCategoryKey: string
): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(resetRowFatigueRef, { userId, profileId, rowCategoryKey })
  } catch (err) {
    console.error("[Discovery] Failed to reset fatigue:", err)
  }
}

export async function getRowFatigueMap(
  userId: string,
  profileId: string
): Promise<Map<string, RowFatigue>> {
  const map = new Map<string, RowFatigue>()
  const postgres = getPostgresStore()
  if (!postgres) return map
  try {
    const rows = await postgres.read(getRowFatigueRef, { userId, profileId })
    for (const row of rows ?? []) {
      map.set(row.rowCategoryKey, row)
    }
  } catch (err) {
    console.error("[Discovery] Failed to load row fatigue:", err)
  }
  return map
}

// ── Item profile cache (shared catalog cache in cacheStore) ──

const ITEM_CACHE_PREFIX = "discovery-item:"
const ITEM_MEMORY_TTL = 6 * 60 * 60 * 1000 // 6 hours
const MAX_ITEM_CACHE_SIZE = 500
const itemMemoryCache = new Map<string, { profile: ItemProfile; timestamp: number }>()

function pruneItemMemoryCache() {
  const now = Date.now()
  for (const [key, entry] of itemMemoryCache.entries()) {
    if (now - entry.timestamp >= ITEM_MEMORY_TTL) {
      itemMemoryCache.delete(key)
    }
  }
  if (itemMemoryCache.size > MAX_ITEM_CACHE_SIZE) {
    const oldestKey = itemMemoryCache.keys().next().value
    if (oldestKey) itemMemoryCache.delete(oldestKey)
  }
}

export async function getCachedItemProfile(
  mediaType: "movie" | "tv",
  tmdbId: number
): Promise<ItemProfile | null> {
  const itemKey = `${mediaType}:${tmdbId}`
  const memKey = `${ITEM_CACHE_PREFIX}${itemKey}`
  const mem = itemMemoryCache.get(memKey)
  if (mem && Date.now() - mem.timestamp < ITEM_MEMORY_TTL) return mem.profile

  const postgres = getPostgresStore()
  if (!postgres) return null
  try {
    const entry = await postgres.read(getItemFeatureRef, { itemKey })
    if (!entry) return null
    const profile = JSON.parse(entry.dataJson) as ItemProfile
    pruneItemMemoryCache()
    itemMemoryCache.set(memKey, { profile, timestamp: Date.now() })
    return profile
  } catch {
    return null
  }
}

export async function setCachedItemProfile(profile: ItemProfile): Promise<void> {
  const itemKey = `${profile.mediaType}:${profile.tmdbId}`
  const memKey = `${ITEM_CACHE_PREFIX}${itemKey}`
  pruneItemMemoryCache()
  itemMemoryCache.set(memKey, { profile, timestamp: Date.now() })

  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(setItemFeatureRef, { itemKey, dataJson: JSON.stringify(profile) })
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
  const postgres = getPostgresStore()
  if (!postgres) return map
  try {
    const row = await postgres.read(getServeLogRef, { userId, profileId })
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
  const postgres = getPostgresStore()
  if (!postgres) return
  try {
    await postgres.write(recordServeLogRef, { userId, profileId, itemKeys })
  } catch (err) {
    console.error("[Discovery] Failed to record serve log:", err)
  }
}
