import { tmdbFetch, trending } from "../tmdb"
import { SingleFlight } from "../circuit-breaker"
import {
  buildItemVector,
  blendUserVectors,
  dominantFeatures,
  temporalDecay,
  zeroVector,
  FEATURE_DIM,
  SHORT_TERM_HALF_LIFE_DAYS,
  LONG_TERM_HALF_LIFE_DAYS,
  MS_PER_DAY,
  type ItemFeatureInput,
} from "./vector"
import {
  getRecentDiscoveryEvents,
  getCachedItemProfile,
  setCachedItemProfile,
  saveFeatureProfile,
  loadFeatureProfile,
  type DiscoveryEvent,
  type ItemProfile,
} from "./store"

/**
 * User profile model (Discovery Engine, Module 1).
 *
 * Builds dual-decay 64-D user vectors (7-day short-term, 90-day long-term)
 * from the Postgres event log, blends them with the activity-aware α, persists
 * the result back to Postgres, and exposes the metadata the row-synthesis and
 * ranking layers need (watched ids, seeds, peak hour, top keywords).
 */

export type SeedCandidate = {
  tmdbId: number
  mediaType: "movie" | "tv"
  title: string
  weight: number
  timestamp: number
  eventType?: DiscoveryEvent["eventType"]
}

export type UserDiscoveryProfile = {
  userId: string
  profileId: string
  /** Unified blended vector U_u,t */
  vector: number[]
  shortTermVector: number[]
  longTermVector: number[]
  hasProfile: boolean
  eventCount: number
  lastActiveTimestamp: number
  peakViewingHour: number | null
  /** "movie:123" / "tv:456" keys the user completed (≥90%). */
  completedKeys: Set<string>
  /** Any positively-signalled item — excluded from recommendation rows. */
  interactedKeys: Set<string>
  seedCandidates: SeedCandidate[]
  topGenreDims: number[]
  topDecadeBucket: number | null
  topKeywords: { id: number; name: string; weight: number }[]
  meanWatchMinutes: number | null
}

const PROFILE_MEMORY_TTL = 15 * 60 * 1000 // 15 minutes
const EVENT_WINDOW_DAYS = 90
const MAX_DETAIL_RESOLUTIONS = 25
const FAST_ADAPT_EVENT_COUNT = 3
const FAST_ADAPT_MULTIPLIER = 3

const profileMemoryCache = new Map<string, { profile: UserDiscoveryProfile; timestamp: number }>()

// ── TMDB detail → ItemProfile ──

type TmdbDetailForFeatures = {
  id: number
  title?: string
  name?: string
  genres?: { id: number; name: string }[]
  release_date?: string
  first_air_date?: string
  runtime?: number | null
  episode_run_time?: number[]
  popularity?: number
  vote_average?: number
  vote_count?: number
  credits?: {
    cast?: { name: string; order: number }[]
    crew?: { name: string; job: string }[]
  }
  created_by?: { name: string }[]
  keywords?: { keywords?: { id: number; name: string }[]; results?: { id: number; name: string }[] }
}

function detailToItemProfile(detail: TmdbDetailForFeatures, mediaType: "movie" | "tv"): ItemProfile {
  const releaseDate = detail.release_date ?? detail.first_air_date ?? null
  const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : null
  const castNames = (detail.credits?.cast ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .slice(0, 8)
    .map((c) => c.name)
  const directorNames =
    mediaType === "movie"
      ? (detail.credits?.crew ?? []).filter((c) => c.job === "Director").slice(0, 3).map((c) => c.name)
      : (detail.created_by ?? []).slice(0, 3).map((c) => c.name)
  const keywords = detail.keywords?.keywords ?? detail.keywords?.results ?? []
  const keywordNames = keywords.slice(0, 20).map((k) => k.name)
  const runtimeMinutes =
    mediaType === "movie" ? detail.runtime ?? null : detail.episode_run_time?.[0] ?? null

  const vector = buildItemVector({
    tmdbId: detail.id,
    mediaType,
    genreIds: (detail.genres ?? []).map((g) => g.id),
    releaseYear,
    runtimeMinutes,
    castNames,
    directorNames,
    keywordNames,
  })

  return {
    tmdbId: detail.id,
    mediaType,
    title: detail.title ?? detail.name ?? "",
    genreIds: (detail.genres ?? []).map((g) => g.id),
    releaseYear,
    releaseDate,
    runtimeMinutes,
    castNames,
    directorNames,
    keywords: keywords.slice(0, 20),
    keywordNames,
    popularity: detail.popularity ?? 0,
    voteAverage: detail.vote_average ?? 0,
    voteCount: detail.vote_count ?? 0,
    vector,
  }
}

/** Resolve the full feature profile for an item, cached in Postgres cacheStore. */
export async function resolveItemProfile(
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<ItemProfile | null> {
  const cached = await getCachedItemProfile(mediaType, tmdbId)
  if (cached) return cached

  try {
    const detail = await tmdbFetch<TmdbDetailForFeatures>(`/${mediaType}/${tmdbId}`, {
      append_to_response: "credits,keywords",
    })
    const profile = detailToItemProfile(detail, mediaType)
    await setCachedItemProfile(profile)
    return profile
  } catch (err) {
    console.error(`[Discovery] Failed to resolve item ${mediaType}/${tmdbId}:`, err)
    return null
  }
}

/** Lightweight vector for a catalog candidate (no detail fetch — list data only). */
export function buildSparseItemVector(input: ItemFeatureInput): number[] {
  return buildItemVector(input)
}

// ── Profile build ──

const SIGNAL_EVENT_TYPES = new Set([
  "play_complete",
  "partial_play",
  "abandonment",
  "rewatch",
  "favorite",
  "unfavorite",
  "request",
  "rating",
])

async function resolveSignalItems(
  events: DiscoveryEvent[]
): Promise<Map<string, ItemProfile>> {
  // Rank events by decayed |weight| and resolve at most MAX_DETAIL_RESOLUTIONS.
  const now = Date.now()
  const prioritized = [...events]
    .filter((e) => e.tmdbId && e.mediaType)
    .sort(
      (a, b) =>
        Math.abs(b.weight ?? 0) * temporalDecay(SHORT_TERM_HALF_LIFE_DAYS, now - b.timestamp) -
        Math.abs(a.weight ?? 0) * temporalDecay(SHORT_TERM_HALF_LIFE_DAYS, now - a.timestamp)
    )
    .slice(0, MAX_DETAIL_RESOLUTIONS)

  const resolved = new Map<string, ItemProfile>()
  const BATCH = 5
  for (let i = 0; i < prioritized.length; i += BATCH) {
    const batch = prioritized.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map((e) => resolveItemProfile(e.tmdbId!, e.mediaType!))
    )
    batch.forEach((e, j) => {
      const profile = results[j]
      if (profile) resolved.set(`${e.mediaType}:${e.tmdbId}`, profile)
    })
  }
  return resolved
}

async function buildUserProfile(userId: string, profileId: string): Promise<UserDiscoveryProfile> {
  const now = Date.now()
  const sinceTimestamp = now - EVENT_WINDOW_DAYS * MS_PER_DAY
  const events = await getRecentDiscoveryEvents(userId, profileId, sinceTimestamp)

  const signalEvents = events.filter((e) => SIGNAL_EVENT_TYPES.has(e.eventType))
  const short = zeroVector()
  const long = zeroVector()
  const hourHistogram = new Array(24).fill(0)
  const completedKeys = new Set<string>()
  const interactedKeys = new Set<string>()
  const keywordWeights = new Map<string, { id: number; name: string; weight: number }>()
  const seedCandidates: SeedCandidate[] = []
  let watchMinutesSum = 0
  let watchMinutesCount = 0

  // Fast-adaptation window (Module 5.1): the very first events carry ×3 weight.
  const chronological = [...signalEvents].sort((a, b) => a.timestamp - b.timestamp)
  const fastAdaptKeys = new Set(
    chronological.slice(0, FAST_ADAPT_EVENT_COUNT).map((e) => `${e.itemId}:${e.timestamp}`)
  )

  const itemProfiles = await resolveSignalItems(signalEvents)

  for (const event of signalEvents) {
    const key = event.tmdbId && event.mediaType ? `${event.mediaType}:${event.tmdbId}` : null
    const itemProfile = key ? itemProfiles.get(key) : null
    const delta = now - event.timestamp

    if (
      event.eventType === "play_complete" ||
      event.eventType === "partial_play" ||
      event.eventType === "rewatch"
    ) {
      hourHistogram[new Date(event.timestamp).getHours()] += Math.max(0, event.weight ?? 0)
      if (event.watchDurationSec) {
        watchMinutesSum += event.watchDurationSec / 60
        watchMinutesCount++
      }
    }

    if (key) {
      if (event.eventType === "play_complete") completedKeys.add(key)
      if ((event.weight ?? 0) > 0) interactedKeys.add(key)
    }

    if (!itemProfile) continue

    let weight = event.weight ?? 0
    if (fastAdaptKeys.has(`${event.itemId}:${event.timestamp}`)) {
      weight *= FAST_ADAPT_MULTIPLIER
    }

    const wShort = weight * temporalDecay(SHORT_TERM_HALF_LIFE_DAYS, delta)
    const wLong = weight * temporalDecay(LONG_TERM_HALF_LIFE_DAYS, delta)
    for (let d = 0; d < FEATURE_DIM; d++) {
      short[d] += wShort * itemProfile.vector[d]
      long[d] += wLong * itemProfile.vector[d]
    }

    if (weight > 0) {
      for (const kw of itemProfile.keywords) {
        const normalized = kw.name.trim().toLowerCase()
        const entry = keywordWeights.get(normalized) ?? { id: kw.id, name: kw.name, weight: 0 }
        entry.weight += wShort
        keywordWeights.set(normalized, entry)
      }
    }

    // Seed candidates: strong positive completions, favorites, or requests.
    if ((event.weight ?? 0) >= 0.7 && event.tmdbId && event.mediaType && event.title) {
      seedCandidates.push({
        tmdbId: event.tmdbId,
        mediaType: event.mediaType,
        title: event.title,
        weight: event.weight ?? 0,
        timestamp: event.timestamp,
        eventType: event.eventType,
      })
    }
  }

  const lastActiveTimestamp = signalEvents[0]?.timestamp ?? 0
  const unified = blendUserVectors(short, long)

  const { genreDim, decadeBucket } = dominantFeatures(unified)
  const topGenreDims: number[] = []
  if (genreDim !== null) {
    topGenreDims.push(genreDim)
    // Second-strongest genre dimension enables two distinct micro-genre rows.
    let secondDim: number | null = null
    let secondMax = 0.15
    for (let d = 0; d < 20; d++) {
      if (d !== genreDim && unified[d] > secondMax) {
        secondMax = unified[d]
        secondDim = d
      }
    }
    if (secondDim !== null) topGenreDims.push(secondDim)
  }

  let peakViewingHour: number | null = null
  let peakValue = 0
  hourHistogram.forEach((v, h) => {
    if (v > peakValue) {
      peakValue = v
      peakViewingHour = h
    }
  })

  const topKeywords = [...keywordWeights.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)

  const profile: UserDiscoveryProfile = {
    userId,
    profileId,
    vector: unified,
    shortTermVector: short,
    longTermVector: long,
    hasProfile: signalEvents.length > 0,
    eventCount: signalEvents.length,
    lastActiveTimestamp,
    peakViewingHour,
    completedKeys,
    interactedKeys,
    seedCandidates: seedCandidates.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5),
    topGenreDims,
    topDecadeBucket: decadeBucket,
    topKeywords,
    meanWatchMinutes: watchMinutesCount > 0 ? watchMinutesSum / watchMinutesCount : null,
  }

  // Persist raw short/long so a fresh process can recover quickly.
  await saveFeatureProfile(userId, profileId, {
    shortTermVector: short,
    longTermVector: long,
    lastActiveTimestamp,
  })

  return profile
}

/**
 * Get (or rebuild) the user's discovery profile. Rebuilds at most every
 * PROFILE_MEMORY_TTL; falls back to the Postgres-persisted vectors when the
 * event log cannot be read.
 */
export async function getUserDiscoveryProfile(
  userId: string,
  profileId = "default"
): Promise<UserDiscoveryProfile> {
  const key = `${userId}:${profileId}`
  const mem = profileMemoryCache.get(key)
  if (mem && Date.now() - mem.timestamp < PROFILE_MEMORY_TTL) return mem.profile

  return SingleFlight.execute(`discovery-profile:${key}`, async () => {
    const existing = profileMemoryCache.get(key)
    if (existing && Date.now() - existing.timestamp < PROFILE_MEMORY_TTL) return existing.profile

    let profile: UserDiscoveryProfile | null = null
    try {
      profile = await buildUserProfile(userId, profileId)
    } catch (err) {
      console.error("[Discovery] Profile build failed:", err)
    }

    if (!profile || (!profile.hasProfile && profile.eventCount === 0)) {
      const persisted = await loadFeatureProfile(userId, profileId)
      if (persisted && !profile) {
        const unified = blendUserVectors(
          persisted.shortTermVector,
          persisted.longTermVector
        )
        profile = emptyProfile(userId, profileId, unified)
        profile.hasProfile = true
      }
    }

    if (!profile) {
      profile = emptyProfile(userId, profileId, await getColdStartVector())
    }

    const now = Date.now()
    if (profileMemoryCache.size > 200) {
      for (const [k, v] of profileMemoryCache.entries()) {
        if (now - v.timestamp >= PROFILE_MEMORY_TTL) profileMemoryCache.delete(k)
      }
      if (profileMemoryCache.size > 200) {
        const oldestKey = profileMemoryCache.keys().next().value
        if (oldestKey) profileMemoryCache.delete(oldestKey)
      }
    }
    profileMemoryCache.set(key, { profile, timestamp: Date.now() })
    return profile
  })
}

export function invalidateDiscoveryProfile(userId: string, profileId = "default") {
  profileMemoryCache.delete(`${userId}:${profileId}`)
  void import("./engine").then(({ invalidateFeedCache }) => invalidateFeedCache(userId)).catch(() => {})
}

function emptyProfile(userId: string, profileId: string, vector: number[]): UserDiscoveryProfile {
  return {
    userId,
    profileId,
    vector,
    shortTermVector: zeroVector(),
    longTermVector: zeroVector(),
    hasProfile: false,
    eventCount: 0,
    lastActiveTimestamp: 0,
    peakViewingHour: null,
    completedKeys: new Set(),
    interactedKeys: new Set(),
    seedCandidates: [],
    topGenreDims: [],
    topDecadeBucket: null,
    topKeywords: [],
    meanWatchMinutes: null,
  }
}

// ── Cold start: population-average of trending catalog (Module 5.1) ──

let coldStartCache: { vector: number[]; timestamp: number } | null = null
const COLD_START_TTL = 6 * 60 * 60 * 1000

export async function getColdStartVector(): Promise<number[]> {
  if (coldStartCache && Date.now() - coldStartCache.timestamp < COLD_START_TTL) {
    return coldStartCache.vector
  }

  const acc = zeroVector()
  let count = 0
  try {
    const [movies, tv] = await Promise.all([trending("movie", "week"), trending("tv", "week")])
    for (const item of [...(movies?.results ?? []), ...(tv?.results ?? [])]) {
      const isTv = !("title" in item)
      const v = buildItemVector({
        tmdbId: item.id,
        mediaType: isTv ? "tv" : "movie",
        genreIds: item.genre_ids ?? [],
        releaseYear: (() => {
          const dateStr = "release_date" in item ? item.release_date : item.first_air_date
          return dateStr ? new Date(dateStr).getFullYear() : null
        })(),
        runtimeMinutes: null,
      })
      for (let d = 0; d < FEATURE_DIM; d++) acc[d] += v[d]
      count++
    }
  } catch (err) {
    console.error("[Discovery] Cold-start vector build failed:", err)
  }

  const vector = count > 0 ? acc.map((v) => v / count) : acc
  coldStartCache = { vector, timestamp: Date.now() }
  return vector
}
