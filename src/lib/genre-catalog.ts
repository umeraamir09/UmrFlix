import { getGenreBySlug, getGenreDiscoverParams, type GenreDef } from "./genres"
import {
  tmdbFetch,
  discoverMovies,
  discoverTv,
  type TmdbMovie,
  type TmdbTvShow,
} from "./tmdb"
import { filterReleasedContent, filterDisplayableContent } from "./catalog"
import { CATALOG_QUALITY_FLOORS } from "./catalog-quality"
import { toRowItem, dedupeByTmdbId, type RowItem } from "./recommendations"
import { enrichMediaItemsWithPosters } from "./horizontal-posters"
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

/**
 * Dedicated genre page row builder.
 *
 * Auto-curates a Netflix-style set of rows for a genre: personalized top
 * picks, trending, availability-aware "Available Now / In Your Library",
 * critically acclaimed, new & recent, hidden gems, "Because You Watched", and
 * decade rows reaching back to the 70s (R1-4). Rows are cached in-memory per
 * slug:userId:rowId with a 30-minute TTL and SingleFlight collapse for
 * concurrent hits.
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
  rows: GenreRow[]
}

const ROW_LIMIT = 20
const CACHE_TTL = 30 * 60 * 1000 // 30 minutes
const QUEUE_TTL = 15_000

// ── Discover template ──

type DiscoverTemplate = {
  sortBy: "popularity" | "vote_average" | "release_date"
  voteCountGte?: { movie: number; tv: number }
  popularityGte?: number
  /** Optional rating backstop (fresh lane) — replaces popularity floors. */
  voteAverageGte?: number
  withRuntimeGte?: number
  dateRange?: { gte?: string; lte?: string }
  maxParentalRating?: string
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
  if (template.popularityGte !== undefined) {
    params["popularity.gte"] = String(template.popularityGte)
  }
  if (template.voteAverageGte !== undefined) {
    params["vote_average.gte"] = String(template.voteAverageGte)
  }
  if (template.withRuntimeGte !== undefined && mediaType === "movie") {
    params["with_runtime.gte"] = String(template.withRuntimeGte)
  }
  if (template.dateRange) {
    const key = mediaType === "movie" ? "primary_release_date" : "air_date"
    if (template.dateRange.gte) params[`${key}.gte`] = template.dateRange.gte
    if (template.dateRange.lte) params[`${key}.lte`] = template.dateRange.lte
  }
  if (template.maxParentalRating && mediaType === "movie") {
    params.certification_country = "US"
    params["certification.lte"] = template.maxParentalRating
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
      ? discoverMovies({
          with_genres: genre.movieGenreIds.join(","),
          ...buildDiscoverParams(template, "movie"),
          ...getGenreDiscoverParams(genre, "movie"),
        })
      : Promise.resolve(null),
    genre.tvGenreIds.length > 0
      ? discoverTv({
          with_genres: genre.tvGenreIds.join(","),
          ...buildDiscoverParams(template, "tv"),
          ...getGenreDiscoverParams(genre, "tv"),
        })
      : Promise.resolve(null),
  ])

  const movieItems = toRowItems(movieData?.results ?? [], "movie", options)
  const tvItems = toRowItems(tvData?.results ?? [], "tv", options)
  const combined = dedupeByTmdbId([...movieItems, ...tvItems]).slice(0, limit)
  await enrichMediaItemsWithPosters(combined)
  return combined
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

/**
 * R1-4: decades reach back to the 1970s (previously only current-minus-10
 * and minus-20), giving the genre page a deep classic tail.
 */
function getRecentDecades(): { label: string; gte: string; lte: string }[] {
  const currentYear = new Date().getFullYear()
  const currentDecadeStart = Math.floor(currentYear / 10) * 10
  const decades: { label: string; gte: string; lte: string }[] = []
  for (let start = currentDecadeStart - 10; start >= 1970; start -= 10) {
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

  // R0-2: floor values come from the central config — no inline literals.
  const BROWSE_M = CATALOG_QUALITY_FLOORS.browse.movie
  const BROWSE_TV = CATALOG_QUALITY_FLOORS.browse.tv
  const CURATED_M = CATALOG_QUALITY_FLOORS.curated.movie
  const CURATED_TV = CATALOG_QUALITY_FLOORS.curated.tv
  const FRESH_M = CATALOG_QUALITY_FLOORS.fresh.movie
  const FRESH_TV = CATALOG_QUALITY_FLOORS.fresh.tv
  const NICHE_M = CATALOG_QUALITY_FLOORS.niche.movie
  const NICHE_TV = CATALOG_QUALITY_FLOORS.niche.tv

  const uid = userId || "default"
  const key = (rowId: string) => rowCacheKey(slug, uid, rowId)
  const today = new Date().toISOString().split("T")[0]
  const decades = getRecentDecades()

  const profile = await getUserGenreProfile(uid)
  const personalize = profile.hasEnoughSignals

  const [topPicks, trending, worldLeading, available, acclaimed, newRecent, hiddenGems, because, decadeItems] =
    await Promise.all([
      personalize
        ? getCachedRow<RowItem[]>(key("top-picks"), () => getGenreTopPicks(uid, genre, ROW_LIMIT))
        : Promise.resolve([] as RowItem[]),
      getCachedRow<RowItem[]>(key("trending"), () =>
        fetchMixedDiscover(genre, {
          sortBy: "popularity",
          voteCountGte: { movie: BROWSE_M.voteCountGte, tv: BROWSE_TV.voteCountGte },
          popularityGte: BROWSE_M.popularityGte ?? undefined,
          withRuntimeGte: 20,
        })
      ),
      genre.slug === "anime"
        ? getCachedRow<RowItem[]>(key("world-leading"), () =>
            fetchMixedDiscover(
              genre,
              {
                sortBy: "popularity",
                voteCountGte: { movie: BROWSE_M.voteCountGte, tv: BROWSE_TV.voteCountGte },
                popularityGte: BROWSE_TV.popularityGte ?? undefined,
              },
              40
            )
          )
        : Promise.resolve([] as RowItem[]),
      getCachedRow<RowItem[]>(key("available"), () => buildAvailableRowItems(genre)),
      getCachedRow<RowItem[]>(key("acclaimed"), () =>
        fetchMixedDiscover(genre, {
          sortBy: "vote_average",
          voteCountGte: { movie: CURATED_M.voteCountGte, tv: CURATED_TV.voteCountGte },
          popularityGte: CURATED_M.popularityGte ?? undefined,
          withRuntimeGte: 30,
        })
      ),
      getCachedRow<RowItem[]>(key("new-recent"), () =>
        fetchMixedDiscover(
          genre,
          {
            sortBy: "release_date",
            voteCountGte: { movie: FRESH_M.voteCountGte, tv: FRESH_TV.voteCountGte },
            voteAverageGte: FRESH_M.voteAverageGte,
            withRuntimeGte: 20,
            dateRange: { lte: today },
          },
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
            voteCountGte: { movie: NICHE_M.voteCountGte, tv: NICHE_TV.voteCountGte },
            withRuntimeGte: 20,
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
                voteCountGte: { movie: BROWSE_M.voteCountGte, tv: BROWSE_TV.voteCountGte },
                popularityGte: BROWSE_M.popularityGte ?? undefined,
                withRuntimeGte: 20,
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

  /**
   * R1-4 bucketed allocation: each row may always keep its top 5 items even
   * when an earlier row already used them (reserved share), and rows that
   * cannot reach 5 unique-or-reserved items are dropped entirely instead of
   * rendering 1–4 sparse cards. Later rows (hidden gems, because, decades)
   * no longer starve behind the heavily-overlapping head rows.
   */
  const RESERVED_PER_ROW = 5
  const MIN_ROW_ITEMS_GENRE = 5
  const pushRow = (row: Omit<GenreRow, "items">, items: RowItem[]) => {
    const accepted: RowItem[] = []
    let reserved = 0
    for (const item of items) {
      const mediaType = item.media_type === "tv" ? "tv" : "movie"
      const itemKey = `${mediaType}:${item.id}`
      if (seen.has(itemKey)) {
        if (reserved >= RESERVED_PER_ROW) continue
        reserved++
      }
      seen.add(itemKey)
      accepted.push(item)
    }
    if (accepted.length >= MIN_ROW_ITEMS_GENRE) rows.push({ ...row, items: accepted })
  }

  pushRow(
    { id: "top-picks", title: "Top Picks For You", subtitle: "Handpicked from your watch history", type: "mixed" },
    topPicks
  )
  if (genre.slug === "anime") {
    pushRow(
      {
        id: "world-leading",
        title: "World Leading Anime",
        subtitle: "The most iconic and beloved anime of all time",
        type: "mixed",
      },
      worldLeading
    )
  }
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
    let becauseTitle = because.seedTitle ? `Because You Watched ${because.seedTitle}` : "Because You Watched"
    let becauseSubtitle = "More titles like what you have been watching"
    if (because.seedSource === "my_list" || because.seedSource === "favorite") {
      becauseTitle = because.seedTitle
        ? `Because You Added ${because.seedTitle} to Your List`
        : "Because You Added to Your List"
      becauseSubtitle = "More titles like what you saved to your list"
    }

    pushRow(
      {
        id: "because",
        title: becauseTitle,
        subtitle: becauseSubtitle,
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

  return { genre, rows }
}
