import { getResumeItems, getUserFavorites } from "./jellyfin"
import { getUserMyList } from "./my-list-store"
import {
  tmdbFetch,
  discoverMovies,
  discoverTv,
  type TmdbMovie,
  type TmdbTvShow,
} from "./tmdb"
import { filterReleasedContent } from "./catalog"
import { getJellyfinIndex } from "./cache"
import { SingleFlight } from "./circuit-breaker"
import {
  toRowItem,
  dedupeByTmdbId,
  getTmdbRecommendations,
  type RowItem,
} from "./recommendations"
import type { GenreDef } from "./genres"

/**
 * Per-user genre affinity engine.
 *
 * Signals (Jellyfin watch/resume history, My List, Jellyfin favorites) are
 * resolved to TMDB genre ids via the detail endpoints, then weighted into a
 * recency-aware, type-aware profile that powers personalized "Top Picks For
 * You" rows and "Because You Watched {Title}" rows on dedicated genre pages.
 */

const PROFILE_TTL = 30 * 60 * 1000 // 30 minutes
const GENRE_TTL = 30 * 60 * 1000 // 30 minutes
const MAX_RESOLVE_SIGNALS = 20 // cap genre resolution work per profile build

export type GenreSignal = {
  tmdbId: number
  mediaType: "movie" | "tv"
  title?: string
  source: "resume" | "my_list" | "favorite"
  weight: number
  genreIds: number[]
  resolved: boolean
}

export type GenreProfile = {
  userId: string
  genreCounts: Record<number, number>
  signalCount: number
  resolvedSignalCount: number
  hasEnoughSignals: boolean
  topGenres: { genreId: number; weight: number }[]
  recentlyWatched: GenreSignal[]
  signals: GenreSignal[]
}

export type BecauseYouWatchedResult = {
  seedTitle: string | null
  seedId: number | null
  seedMediaType: "movie" | "tv" | null
  items: RowItem[]
}

// ── id → genres resolution cache ──

const genreCache = new Map<string, { ids: number[]; timestamp: number }>()
const MAX_GENRE_CACHE_ENTRIES = 2000
let lastGenreCacheSweep = 0

function sweepGenreCache() {
  const now = Date.now()
  if (now - lastGenreCacheSweep < 60_000) return
  lastGenreCacheSweep = now

  for (const [key, entry] of genreCache) {
    if (now - entry.timestamp >= GENRE_TTL) genreCache.delete(key)
  }
  if (genreCache.size > MAX_GENRE_CACHE_ENTRIES) {
    const overflow = genreCache.size - MAX_GENRE_CACHE_ENTRIES
    const oldest = [...genreCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
    for (const [key] of oldest) genreCache.delete(key)
  }
}

function getCachedGenreIds(key: string): number[] | null {
  sweepGenreCache()
  const entry = genreCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp >= GENRE_TTL) {
    genreCache.delete(key)
    return null
  }
  return entry.ids
}

async function resolveGenreIds(tmdbId: number, mediaType: "movie" | "tv"): Promise<number[]> {
  const key = `${mediaType}:${tmdbId}`
  const cached = getCachedGenreIds(key)
  if (cached) return cached

  try {
    const data = await tmdbFetch<{ genres?: { id: number }[] }>(`/${mediaType}/${tmdbId}`)
    const ids = (data.genres ?? []).map((g) => g.id)
    genreCache.set(key, { ids, timestamp: Date.now() })
    return ids
  } catch (err) {
    console.error(`Failed to resolve genres for ${mediaType}/${tmdbId}:`, err)
    return []
  }
}

// ── Signal collection ──

async function collectSignals(userId: string): Promise<GenreSignal[]> {
  const signals: GenreSignal[] = []

  const resume = await getResumeItems(20)
  resume.forEach((item, index) => {
    const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb, 10) : null
    if (!tmdbId) return
    signals.push({
      tmdbId,
      mediaType: item.Type === "Movie" ? "movie" : "tv",
      title: item.Name,
      source: "resume",
      weight: 1.2 * Math.max(0.15, 1 - index * 0.04),
      genreIds: [],
      resolved: false,
    })
  })

  const myList = await getUserMyList(userId)
  for (const item of myList) {
    if (!item.tmdbId) continue
    signals.push({
      tmdbId: item.tmdbId,
      mediaType: item.mediaType === "tv" ? "tv" : "movie",
      title: item.title,
      source: "my_list",
      weight: 0.85,
      genreIds: [],
      resolved: false,
    })
  }

  const favorites = await getUserFavorites()
  for (const item of favorites) {
    const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb, 10) : null
    if (!tmdbId) continue
    const isMovie = item.Type?.toLowerCase() === "movie"
    signals.push({
      tmdbId,
      mediaType: isMovie ? "movie" : "tv",
      title: item.Name,
      source: "favorite",
      weight: 1.0,
      genreIds: [],
      resolved: false,
    })
  }

  // Dedupe by mediaType:tmdbId keeping the strongest (most recent) signal.
  const seen = new Map<string, GenreSignal>()
  for (const signal of signals) {
    const key = `${signal.mediaType}:${signal.tmdbId}`
    const existing = seen.get(key)
    if (!existing || signal.weight > existing.weight) seen.set(key, signal)
  }

  return Array.from(seen.values())
}

// ── Profile build ──

async function resolveSignalsInBatches(
  signals: GenreSignal[],
  batchSize = 5
): Promise<GenreSignal[]> {
  const resolved: GenreSignal[] = []
  for (let i = 0; i < signals.length; i += batchSize) {
    const batch = signals.slice(i, i + batchSize)
    const batchResults = await Promise.all(
      batch.map(async (signal) => {
        const genreIds = await resolveGenreIds(signal.tmdbId, signal.mediaType)
        return { ...signal, genreIds, resolved: genreIds.length > 0 }
      })
    )
    resolved.push(...batchResults)
  }
  return resolved
}

async function buildProfile(userId: string): Promise<GenreProfile> {
  const signals = await collectSignals(userId)
  const genreCounts: Record<number, number> = {}

  const toResolve = [...signals].sort((a, b) => b.weight - a.weight).slice(0, MAX_RESOLVE_SIGNALS)
  const resolvedByKey = new Map(
    (await resolveSignalsInBatches(toResolve)).map((s) => [`${s.mediaType}:${s.tmdbId}`, s])
  )
  const allSignals = signals.map((s) => resolvedByKey.get(`${s.mediaType}:${s.tmdbId}`) ?? s)

  for (const signal of allSignals) {
    for (const genreId of signal.genreIds) {
      genreCounts[genreId] = (genreCounts[genreId] ?? 0) + signal.weight
    }
  }

  const topGenres = Object.entries(genreCounts)
    .map(([genreId, weight]) => ({ genreId: Number(genreId), weight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)

  const resolvedSignals = allSignals.filter((s) => s.resolved)
  const recentlyWatched = [...resolvedSignals].sort((a, b) => b.weight - a.weight)

  return {
    userId,
    genreCounts,
    signalCount: signals.length,
    resolvedSignalCount: resolvedSignals.length,
    hasEnoughSignals: resolvedSignals.length >= 3,
    topGenres,
    recentlyWatched,
    signals: allSignals,
  }
}

// ── Per-user profile cache ──

const profileCache = new Map<string, { profile: GenreProfile; timestamp: number }>()
const MAX_PROFILE_CACHE_ENTRIES = 500
let lastProfileCacheSweep = 0

function sweepProfileCache() {
  const now = Date.now()
  if (now - lastProfileCacheSweep < 60_000) return
  lastProfileCacheSweep = now

  for (const [key, entry] of profileCache) {
    if (now - entry.timestamp >= PROFILE_TTL) profileCache.delete(key)
  }
  if (profileCache.size > MAX_PROFILE_CACHE_ENTRIES) {
    const overflow = profileCache.size - MAX_PROFILE_CACHE_ENTRIES
    const oldest = [...profileCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
    for (const [key] of oldest) profileCache.delete(key)
  }
}

export function invalidateGenreProfileCache() {
  profileCache.clear()
  genreCache.clear()
}

export async function getUserGenreProfile(userId: string): Promise<GenreProfile> {
  const key = userId || "default"
  sweepProfileCache()
  const cached = profileCache.get(key)
  if (cached && Date.now() - cached.timestamp < PROFILE_TTL) return cached.profile

  return SingleFlight.execute(`genre-profile:${key}`, async () => {
    const existing = profileCache.get(key)
    if (existing && Date.now() - existing.timestamp < PROFILE_TTL) return existing.profile

    const profile = await buildProfile(key)
    profileCache.set(key, { profile, timestamp: Date.now() })
    return profile
  })
}

function buildExclusionKeys(profile: GenreProfile): Set<string> {
  return new Set(profile.signals.map((s) => `${s.mediaType}:${s.tmdbId}`))
}

type DisplayableLike = {
  poster_path: string | null
  overview: string
  release_date?: string
  first_air_date?: string
}

function isDisplayable(item: DisplayableLike): boolean {
  if (!item.poster_path || !item.overview) return false
  const dateStr = item.release_date || item.first_air_date
  if (!dateStr) return false
  if (new Date(dateStr) > new Date()) return false
  return true
}

type GenreCandidate = {
  id: number
  mediaType: "movie" | "tv"
  data: TmdbMovie | TmdbTvShow
  genreIds: number[]
}

// ── Personalized Top Picks ──

export async function getGenreTopPicks(
  userId: string,
  genre: GenreDef,
  limit = 20
): Promise<RowItem[]> {
  const profile = await getUserGenreProfile(userId)
  const excluded = buildExclusionKeys(profile)

  const [movieData, tvData] = await Promise.all([
    genre.movieGenreIds.length > 0
      ? discoverMovies({ with_genres: genre.movieGenreIds.join(","), sort_by: "popularity.desc" })
      : Promise.resolve(null),
    genre.tvGenreIds.length > 0
      ? discoverTv({ with_genres: genre.tvGenreIds.join(","), sort_by: "popularity.desc" })
      : Promise.resolve(null),
  ])

  const candidates: GenreCandidate[] = []
  const movieResults = filterReleasedContent(movieData?.results ?? [])
  const tvResults = filterReleasedContent(tvData?.results ?? [])
  for (const movie of movieResults) {
    candidates.push({ id: movie.id, mediaType: "movie", data: movie, genreIds: movie.genre_ids })
  }
  for (const tv of tvResults) {
    candidates.push({ id: tv.id, mediaType: "tv", data: tv, genreIds: tv.genre_ids })
  }

  const scored = candidates
    .filter((c) => !excluded.has(`${c.mediaType}:${c.id}`))
    .filter((c) => isDisplayable(c.data))
    .map((c) => ({ ...c, score: scoreCandidate(c, profile) }))
    .sort((a, b) => b.score - a.score)

  // Composite dedupe across media types (movie 1 and tv 1 are distinct items).
  const seen = new Set<string>()
  const picked: GenreCandidate[] = []
  for (const candidate of scored) {
    const key = `${candidate.mediaType}:${candidate.id}`
    if (seen.has(key)) continue
    seen.add(key)
    picked.push(candidate)
    if (picked.length >= limit) break
  }

  return picked.map((c) => toRowItem(c.data, c.mediaType))
}

function scoreCandidate(candidate: GenreCandidate, profile: GenreProfile): number {
  let affinitySum = 0
  for (const id of candidate.genreIds) {
    affinitySum += profile.genreCounts[id] ?? 0
  }
  const topWeight = profile.topGenres[0]?.weight ?? 0
  const affinity = topWeight > 0 ? Math.min(1, affinitySum / topWeight) : 0

  const rating = Math.min(1, (candidate.data.vote_average ?? 0) / 10)
  const popularity = Math.min(1, (candidate.data.popularity ?? 0) / 400)

  const dateStr =
    "release_date" in candidate.data
      ? candidate.data.release_date
      : "first_air_date" in candidate.data
        ? candidate.data.first_air_date
        : null
  const currentYear = new Date().getFullYear()
  let recency = 0.4
  if (dateStr) {
    const age = currentYear - new Date(dateStr).getFullYear()
    if (age <= 1) recency = 1
    else if (age <= 3) recency = 0.75
    else if (age <= 6) recency = 0.5
    else recency = 0.25
  }

  let libraryBoost = 0
  if (candidate.mediaType === "movie") {
    const index = getJellyfinIndex()
    if (index?.has(`tmdb-${candidate.id}`)) libraryBoost = 0.15
  }

  return 0.4 * affinity + 0.25 * rating + 0.2 * popularity + 0.15 * recency + libraryBoost
}

// ── Because You Watched ──

export async function getBecauseYouWatched(
  userId: string,
  genre: GenreDef,
  limit = 20
): Promise<BecauseYouWatchedResult> {
  const profile = await getUserGenreProfile(userId)
  const excluded = buildExclusionKeys(profile)

  const seed = profile.recentlyWatched.find((signal) => {
    const matchIds = signal.mediaType === "movie" ? genre.movieGenreIds : genre.tvGenreIds
    return matchIds.some((id) => signal.genreIds.includes(id))
  })

  if (!seed) {
    return { seedTitle: null, seedId: null, seedMediaType: null, items: [] }
  }

  const recommendations = await getTmdbRecommendations(seed.tmdbId, seed.mediaType)

  const inGenre = recommendations.filter((rec) => {
    if (excluded.has(`${rec.media_type}:${rec.tmdbId}`)) return false
    const matchIds = rec.media_type === "movie" ? genre.movieGenreIds : genre.tvGenreIds
    return rec.genre_ids.some((id) => matchIds.includes(id))
  })

  const displayable = inGenre.filter((rec) => isDisplayable(rec))

  return {
    seedTitle: seed.title ?? null,
    seedId: seed.tmdbId,
    seedMediaType: seed.mediaType,
    items: dedupeByTmdbId(displayable)
      .slice(0, limit)
      .map((rec) => toRowItem(rec, rec.media_type)),
  }
}
