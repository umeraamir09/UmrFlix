import { getGenreBySlug, type GenreDef } from "./genres"
import {
  tmdbFetch,
  discoverMovies,
  discoverTv,
  getItemLogo,
  type TmdbMovie,
  type TmdbTvShow,
} from "./tmdb"
import { filterReleasedContent, filterDisplayableContent } from "./catalog"
import { toRowItem, dedupeByTmdbId, type RowItem } from "./recommendations"
import {
  getUserGenreProfile,
  getGenreTopPicks,
  getBecauseYouWatched,
  type BecauseYouWatchedResult,
} from "./genre-profile"
import {
  ensureRadarrMovies,
  ensureSonarrSeries,
  ensureJellyfinIndex,
  getTmdbToTvdbMapping,
  setTmdbToTvdbMapping,
  fetchTmdbToTvdbMappingL2,
} from "./cache"
import { SingleFlight } from "./circuit-breaker"
import { authenticate, getAllItems } from "./jellyfin"
import * as radarr from "./radarr"
import * as sonarr from "./sonarr"
import type { BillboardItem } from "@/components/HeroBillboard"

/**
 * Dedicated genre page row builder.
 *
 * Auto-curates a Netflix-style set of rows for a genre: personalized top
 * picks, trending, availability-aware "Available Now / In Your Library",
 * critically acclaimed, new & recent, hidden gems, "Because You Watched", and
 * a couple of decade rows. Rows are cached in-memory per slug:userId:rowId
 * with a 30-minute TTL and SingleFlight collapse for concurrent hits.
 */

export type GenreRow = {
  id: string
  title: string
  subtitle?: string
  type: "movie" | "tv" | "mixed"
  items: RowItem[]
}

export type GenrePageData = {
  genre: GenreDef
  heroItems: BillboardItem[]
  rows: GenreRow[]
}

const ROW_LIMIT = 20
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const QUEUE_TTL = 15_000

// ── Discover template ──

type DiscoverTemplate = {
  sortBy: "popularity" | "vote_average" | "release_date"
  voteCountGte?: { movie: number; tv: number }
  dateRange?: { gte?: string; lte?: string }
}

function buildDiscoverParams(
  template: DiscoverTemplate,
  mediaType: "movie" | "tv"
): Record<string, string> {
  const params: Record<string, string> = {}
  switch (template.sortBy) {
    case "popularity":
      params.sort_by = "popularity.desc"
      break
    case "vote_average":
      params.sort_by = "vote_average.desc"
      break
    case "release_date":
      params.sort_by = mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc"
      break
  }
  if (template.voteCountGte) {
    params["vote_count.gte"] = String(
      mediaType === "movie" ? template.voteCountGte.movie : template.voteCountGte.tv
    )
  }
  if (template.dateRange) {
    const key = mediaType === "movie" ? "primary_release_date" : "air_date"
    if (template.dateRange.gte) params[`${key}.gte`] = template.dateRange.gte
    if (template.dateRange.lte) params[`${key}.lte`] = template.dateRange.lte
  }
  return params
}

function toRowItems<T extends TmdbMovie | TmdbTvShow>(
  results: T[],
  mediaType: "movie" | "tv",
  options?: { includeCinemas?: boolean }
): RowItem[] {
  const includeCinemas = options?.includeCinemas
  return filterDisplayableContent(filterReleasedContent(results, { includeCinemas }), {
    includeCinemas,
  }).map((item) => toRowItem(item, mediaType))
}

async function fetchMixedDiscover(
  genre: GenreDef,
  template: DiscoverTemplate,
  limit = ROW_LIMIT,
  options?: { includeCinemas?: boolean }
): Promise<RowItem[]> {
  const [movieData, tvData] = await Promise.all([
    genre.movieGenreIds.length > 0
      ? discoverMovies({ with_genres: genre.movieGenreIds.join(","), ...buildDiscoverParams(template, "movie") })
      : Promise.resolve(null),
    genre.tvGenreIds.length > 0
      ? discoverTv({ with_genres: genre.tvGenreIds.join(","), ...buildDiscoverParams(template, "tv") })
      : Promise.resolve(null),
  ])

  const movieItems = toRowItems(movieData?.results ?? [], "movie", options)
  const tvItems = toRowItems(tvData?.results ?? [], "tv", options)
  return dedupeByTmdbId([...movieItems, ...tvItems]).slice(0, limit)
}

// ── Availability maps ──

type AvailabilityStatus = {
  status: "in_library" | "downloading" | "in_radarr" | "in_sonarr" | "pending" | "not_requested"
  progress?: number
  jellyfinItemId?: string
  requestedByUsername?: string
}

type AvailabilityMaps = {
  movies: Map<number, radarr.RadarrMovie>
  series: Map<number, sonarr.SonarrSeries>
  jellyfin: Map<string, string>
  radarrQueue: Map<number, number>
  sonarrQueue: Map<number, number>
}

let radarrQueueCache: { map: Map<number, number>; timestamp: number } = { map: new Map(), timestamp: 0 }
let sonarrQueueCache: { map: Map<number, number>; timestamp: number } = { map: new Map(), timestamp: 0 }

async function buildRadarrQueueMap(): Promise<Map<number, number>> {
  if (Date.now() - radarrQueueCache.timestamp < QUEUE_TTL) return radarrQueueCache.map
  try {
    const items = await radarr.getQueue()
    const map = new Map<number, number>()
    for (const q of items) if (q.movieId) map.set(q.movieId, q.progressPercent)
    radarrQueueCache = { map, timestamp: Date.now() }
    return map
  } catch {
    return radarrQueueCache.map
  }
}

async function buildSonarrQueueMap(): Promise<Map<number, number>> {
  if (Date.now() - sonarrQueueCache.timestamp < QUEUE_TTL) return sonarrQueueCache.map
  try {
    const items = await sonarr.getQueue()
    const map = new Map<number, number>()
    for (const q of items) if (q.seriesId) map.set(q.seriesId, q.progressPercent)
    sonarrQueueCache = { map, timestamp: Date.now() }
    return map
  } catch {
    return sonarrQueueCache.map
  }
}

async function buildAvailabilityMaps(): Promise<AvailabilityMaps> {
  const [movies, series, jellyfin] = await Promise.all([
    ensureRadarrMovies(() => radarr.getMovies()).catch(() => new Map<number, radarr.RadarrMovie>()),
    ensureSonarrSeries(() => sonarr.getSeries()).catch(() => new Map<number, sonarr.SonarrSeries>()),
    ensureJellyfinIndex(async () => {
      try {
        const { token, userId } = await authenticate()
        return getAllItems(token, userId)
      } catch {
        return []
      }
    }).catch(() => new Map<string, string>()),
  ])
  const [radarrQueue, sonarrQueue] = await Promise.all([buildRadarrQueueMap(), buildSonarrQueueMap()])
  return { movies, series, jellyfin, radarrQueue, sonarrQueue }
}

async function resolveTvdbId(tmdbId: number): Promise<number | null> {
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return null
  const cached = getTmdbToTvdbMapping(tmdbId)
  if (cached !== undefined) return cached
  const cachedL2 = await fetchTmdbToTvdbMappingL2(tmdbId)
  if (cachedL2 !== null) return cachedL2
  try {
    const data = await tmdbFetch<{ tvdb_id: number | null }>(`/tv/${tmdbId}/external_ids`)
    if (data.tvdb_id != null) {
      setTmdbToTvdbMapping(tmdbId, data.tvdb_id)
      return data.tvdb_id
    }
  } catch {
    /* keep unknown */
  }
  return null
}

async function resolveTvdbIdsInBatches(
  ids: number[],
  batchSize = 5
): Promise<Map<number, number | null>> {
  const map = new Map<number, number | null>()
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const resolved = await Promise.all(batch.map((id) => resolveTvdbId(id)))
    batch.forEach((id, index) => map.set(id, resolved[index]))
  }
  return map
}

function checkMovieAvailability(tmdbId: number, maps: AvailabilityMaps): AvailabilityStatus {
  const movie = maps.movies.get(tmdbId)
  if (!movie) return { status: "not_requested" }
  if (movie.hasFile) {
    const jellyfinItemId = maps.jellyfin.get(`tmdb-${tmdbId}`)
    return jellyfinItemId
      ? { status: "in_library", jellyfinItemId }
      : { status: "in_library" }
  }
  const progress = maps.radarrQueue.get(movie.id)
  if (progress !== undefined) return { status: "downloading", progress }
  return { status: "in_radarr" }
}

function checkTvAvailability(tmdbId: number, tvdbId: number | null, maps: AvailabilityMaps): AvailabilityStatus {
  if (tvdbId == null) return { status: "not_requested" }
  const show = maps.series.get(tvdbId)
  if (!show) return { status: "not_requested" }
  const progress = maps.sonarrQueue.get(show.id)
  if (progress !== undefined) return { status: "downloading", progress }
  const jellyfinItemId = maps.jellyfin.get(`tvdb-${tvdbId}`)
  if (jellyfinItemId) return { status: "in_library", jellyfinItemId }
  return { status: "in_sonarr" }
}

async function buildAvailableRowItems(genre: GenreDef): Promise<RowItem[]> {
  const [rawItems, maps] = await Promise.all([
    fetchMixedDiscover(genre, { sortBy: "popularity" }, 60),
    buildAvailabilityMaps(),
  ])

  const tvItems = rawItems.filter((item) => item.media_type === "tv")
  const movieItems = rawItems.filter((item) => item.media_type !== "tv")

  // Resolve TVDB ids in small batches to avoid firing up to 60 concurrent
  // TMDB /external_ids requests (each miss can also hit the L2 Convex store).
  const tvdbCache = await resolveTvdbIdsInBatches(tvItems.map((item) => item.id))

  const annotated: { item: RowItem; status: AvailabilityStatus }[] = []
  for (const item of movieItems) {
    const status = checkMovieAvailability(item.id, maps)
    if (status.status !== "not_requested") annotated.push({ item, status })
  }
  for (const item of tvItems) {
    const status = checkTvAvailability(item.id, tvdbCache.get(item.id) ?? null, maps)
    if (status.status !== "not_requested") annotated.push({ item, status })
  }

  const priority: Record<AvailabilityStatus["status"], number> = {
    in_library: 0,
    downloading: 1,
    in_radarr: 2,
    in_sonarr: 2,
    pending: 2,
    not_requested: 3,
  }
  annotated.sort((a, b) => priority[a.status.status] - priority[b.status.status])

  return annotated.slice(0, ROW_LIMIT).map(({ item, status }) => ({
    ...item,
    availabilityStatus: {
      status: status.status,
      progress: status.progress,
      jellyfinItemId: status.jellyfinItemId,
    },
  }))
}

// ── Hero ──

async function buildHeroItems(genre: GenreDef): Promise<BillboardItem[]> {
  const items = await fetchMixedDiscover(genre, { sortBy: "popularity" }, 8)
  const top = items.slice(0, 5)

  return Promise.all(
    top.map(async (item) => {
      const mediaType = item.media_type === "tv" ? "tv" : "movie"
      const logo_path = await getItemLogo(mediaType, item.id).catch(() => null)
      return {
        id: item.id,
        title: item.title || item.name || "",
        overview: item.overview,
        backdrop_path: item.backdrop_path,
        poster_path: item.poster_path,
        media_type: mediaType,
        vote_average: item.vote_average,
        release_date: item.release_date || item.first_air_date,
        logo_path,
      }
    })
  )
}

// ── Row cache (slug:userId:row) ──

const rowCache = new Map<string, { value: unknown; timestamp: number }>()
const MAX_ROW_CACHE_ENTRIES = 500
let lastRowCacheSweep = 0

function sweepRowCache() {
  const now = Date.now()
  if (now - lastRowCacheSweep < 60_000) return
  lastRowCacheSweep = now

  for (const [key, entry] of rowCache) {
    if (now - entry.timestamp >= CACHE_TTL) rowCache.delete(key)
  }
  // Bound the cache: rows are keyed per slug:userId:rowId, so on a multi-user
  // deployment they would otherwise grow without limit for the process lifetime.
  if (rowCache.size > MAX_ROW_CACHE_ENTRIES) {
    const overflow = rowCache.size - MAX_ROW_CACHE_ENTRIES
    const oldest = [...rowCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
    for (const [key] of oldest) rowCache.delete(key)
  }
}

function rowCacheKey(slug: string, userId: string, rowId: string): string {
  return `${slug}:${userId}:${rowId}`
}

async function getCachedRow<T>(key: string, build: () => Promise<T>): Promise<T> {
  sweepRowCache()
  const cached = rowCache.get(key)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.value as T

  return SingleFlight.execute(`genre-row:${key}`, async () => {
    const existing = rowCache.get(key)
    if (existing && Date.now() - existing.timestamp < CACHE_TTL) return existing.value as T

    const value = await build()
    rowCache.set(key, { value, timestamp: Date.now() })
    return value
  })
}

export function invalidateGenreCache() {
  rowCache.clear()
}

// ── Page assembly ──

function getRecentDecades(): { label: string; gte: string; lte: string }[] {
  const currentYear = new Date().getFullYear()
  const currentDecadeStart = Math.floor(currentYear / 10) * 10
  const decades: { label: string; gte: string; lte: string }[] = []
  for (let start = currentDecadeStart - 10; start >= currentDecadeStart - 20; start -= 10) {
    decades.push({
      label: `${String(start).slice(-2)}s`,
      gte: `${start}-01-01`,
      lte: `${start + 9}-12-31`,
    })
  }
  return decades
}

export async function getGenrePageData(
  slug: string,
  userId: string
): Promise<GenrePageData | null> {
  const genre = getGenreBySlug(slug)
  if (!genre) return null

  const uid = userId || "default"
  const key = (rowId: string) => rowCacheKey(slug, uid, rowId)
  const today = new Date().toISOString().split("T")[0]
  const decades = getRecentDecades()

  const profile = await getUserGenreProfile(uid)
  const personalize = profile.hasEnoughSignals

  // The hero is identical for every user of a genre, so it is cached under a
  // shared key instead of being rebuilt (2 discover calls + up to 5 logo
  // fetches) on every request.
  const heroCacheKey = rowCacheKey(slug, "shared", "hero")

  const [heroItems, topPicks, trending, available, acclaimed, newRecent, hiddenGems, because, decadeItems] =
    await Promise.all([
      getCachedRow<BillboardItem[]>(heroCacheKey, () => buildHeroItems(genre)),
      personalize
        ? getCachedRow<RowItem[]>(key("top-picks"), () => getGenreTopPicks(uid, genre, ROW_LIMIT))
        : Promise.resolve([] as RowItem[]),
      getCachedRow<RowItem[]>(key("trending"), () =>
        fetchMixedDiscover(genre, { sortBy: "popularity" })
      ),
      getCachedRow<RowItem[]>(key("available"), () => buildAvailableRowItems(genre)),
      getCachedRow<RowItem[]>(key("acclaimed"), () =>
        fetchMixedDiscover(genre, {
          sortBy: "vote_average",
          voteCountGte: { movie: 100, tv: 50 },
        })
      ),
      getCachedRow<RowItem[]>(key("new-recent"), () =>
        fetchMixedDiscover(
          genre,
          { sortBy: "release_date", dateRange: { lte: today } },
          ROW_LIMIT,
          // "The latest releases" is meaningless if everything inside the
          // 30-day theatrical window is stripped out.
          { includeCinemas: true }
        )
      ),
      getCachedRow<RowItem[]>(key("hidden-gems"), () =>
        fetchMixedDiscover(
          genre,
          {
            sortBy: "vote_average",
            voteCountGte: { movie: 30, tv: 15 },
          },
          ROW_LIMIT,
          { includeCinemas: true }
        )
      ),
      personalize
        ? getCachedRow<BecauseYouWatchedResult>(key("because"), () =>
            getBecauseYouWatched(uid, genre, ROW_LIMIT)
          )
        : Promise.resolve({ seedTitle: null, seedId: null, seedMediaType: null, items: [] } as BecauseYouWatchedResult),
      Promise.all(
        decades.map((decade) =>
          getCachedRow<RowItem[]>(key(`decade-${decade.label}`), () =>
            fetchMixedDiscover(
              genre,
              {
                sortBy: "release_date",
                dateRange: { gte: decade.gte, lte: decade.lte },
              },
              ROW_LIMIT,
              { includeCinemas: true }
            )
          )
        )
      ),
    ])

  const rows: GenreRow[] = []
  const seen = new Set<string>()

  const pushRow = (row: Omit<GenreRow, "items">, items: RowItem[]) => {
    const accepted: RowItem[] = []
    for (const item of items) {
      const mediaType = item.media_type === "tv" ? "tv" : "movie"
      const itemKey = `${mediaType}:${item.id}`
      if (seen.has(itemKey)) continue
      seen.add(itemKey)
      accepted.push(item)
    }
    if (accepted.length > 0) rows.push({ ...row, items: accepted })
  }

  pushRow(
    { id: "top-picks", title: "Top Picks For You", subtitle: "Handpicked from your watch history", type: "mixed" },
    topPicks
  )
  pushRow(
    { id: "trending", title: `Trending in ${genre.name}`, subtitle: `What everyone is watching in ${genre.name}`, type: "mixed" },
    trending
  )
  pushRow(
    { id: "available", title: "Available Now / In Your Library", subtitle: "Ready to watch or already on its way", type: "mixed" },
    available
  )
  pushRow(
    { id: "acclaimed", title: `Critically Acclaimed ${genre.name}`, subtitle: `The highest rated ${genre.name} titles`, type: "mixed" },
    acclaimed
  )
  pushRow(
    { id: "new-recent", title: `New & Recent ${genre.name}`, subtitle: `The latest ${genre.name} releases`, type: "mixed" },
    newRecent
  )
  pushRow(
    { id: "hidden-gems", title: `Hidden Gems in ${genre.name}`, subtitle: "Underrated titles worth discovering", type: "mixed" },
    hiddenGems
  )
  if (because.items.length > 0) {
    pushRow(
      {
        id: "because",
        title: because.seedTitle ? `Because You Watched ${because.seedTitle}` : "Because You Watched",
        subtitle: "More titles like what you have been watching",
        type: because.seedMediaType === "tv" ? "tv" : because.seedMediaType === "movie" ? "movie" : "mixed",
      },
      because.items
    )
  }
  for (let i = 0; i < decades.length; i++) {
    pushRow(
      { id: `decade-${decades[i].label}`, title: `${decades[i].label} ${genre.name}`, subtitle: `${decades[i].label} ${genre.name.toLowerCase()} classics`, type: "mixed" },
      decadeItems[i]
    )
  }

  return { genre, heroItems, rows }
}
