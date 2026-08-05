import { discoverMovies, discoverTv, type TmdbMovie, type TmdbTvShow } from "../tmdb"
import { filterReleasedContent, filterDisplayableContent } from "../catalog"
import { toRowItem, getTmdbRecommendations, type RowItem } from "../recommendations"
import {
  buildItemVector,
  GENRE_DIM_LABELS,
  DECADE_LABELS,
  GENRE_DIM_TO_TMDB,
  decadeBucketToYearRange,
} from "./vector"
import type { UserDiscoveryProfile } from "./profile"

/**
 * Dynamic row synthesis (Discovery Engine, Module 2): micro-genre rows from
 * the profile's dominant features, "Because You Watched" seed rows, contextual
 * trigger rows, and a curated cold-start pool.
 */

export type ScoredRowItem = {
  key: string // "movie:123"
  vector: number[]
  popularity: number
  voteAverage: number
  voteCount: number
  releaseYear: number | null
  rowItem: RowItem
}

export type CandidateRow = {
  key: string
  title: string
  subtitle?: string
  type: "movie" | "tv"
  items: ScoredRowItem[]
}

export const MIN_ROW_ITEMS = 5
export const ROW_ITEM_LIMIT = 20

// ── Candidate conversion ──

type CatalogLike = (TmdbMovie | TmdbTvShow) & { media_type?: string }

function toScoredItem(item: CatalogLike, mediaType: "movie" | "tv"): ScoredRowItem | null {
  const dateStr =
    ("release_date" in item && item.release_date) ||
    ("first_air_date" in item ? item.first_air_date : undefined) ||
    undefined
  const releaseYear = dateStr ? new Date(dateStr).getFullYear() : null
  const rowItem = toRowItem(item, mediaType)
  rowItem.media_type = mediaType
  return {
    key: `${mediaType}:${item.id}`,
    // Sparse vector (genres + era + runtime default) — enough for cosine
    // ranking without a per-item detail fetch.
    vector: buildItemVector({
      tmdbId: item.id,
      mediaType,
      genreIds: "genre_ids" in item && Array.isArray(item.genre_ids) ? item.genre_ids : [],
      releaseYear,
      runtimeMinutes: null,
    }),
    popularity: item.popularity ?? 0,
    voteAverage: item.vote_average ?? 0,
    voteCount: item.vote_count ?? 0,
    releaseYear,
    rowItem,
  }
}

function toDisplayable(results: CatalogLike[]): CatalogLike[] {
  return filterDisplayableContent(filterReleasedContent(results)) as CatalogLike[]
}

// ── Title templates (Module 2.1) ──

const GENRE_ADJECTIVES: Record<number, string> = {
  0: "High-Octane",
  1: "Epic",
  2: "Animated",
  3: "Laugh-Out-Loud",
  4: "Gritty",
  5: "Eye-Opening",
  6: "Critically Acclaimed",
  7: "Family-Friendly",
  8: "Wholesome",
  9: "Enchanting",
  10: "Sweeping",
  11: "Pulse-Pounding",
  12: "Soulful",
  13: "Mind-Bending",
  14: "Heartfelt",
  15: "Mind-Bending",
  16: "Edge-of-Your-Seat",
  17: "Rousing",
  18: "Frontier",
  19: "Binge-Worthy",
}

function microGenreTitle(genreDim: number, decadeBucket: number | null): string {
  const adjective = GENRE_ADJECTIVES[genreDim] ?? "Essential"
  const genre = GENRE_DIM_LABELS[genreDim] ?? "Picks"
  if (decadeBucket !== null) {
    const decade = DECADE_LABELS[decadeBucket]
    if (decadeBucket === 7) return `${adjective} ${genre} — Fresh Releases`
    if (decadeBucket === 0) return `${adjective} ${genre} Classics`
    return `${adjective} ${genre} from the ${decade}`
  }
  return `${adjective} ${genre}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ── Row builders ──

/** "Top Picks For You" — cross-catalog pool ranked purely by S_item later. */
export async function buildTopPicksRow(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow | null> {
  const [movies, tv] = await Promise.all([
    mediaTypeFilter !== "tv" ? safeTrending("movie") : Promise.resolve([]),
    mediaTypeFilter !== "movie" ? safeTrending("tv") : Promise.resolve([]),
    mediaTypeFilter !== "tv" && profile.topGenreDims.length > 0
      ? safeDiscover("movie", { with_genres: GENRE_DIM_TO_TMDB[profile.topGenreDims[0]]?.movie.join(",") ?? "" })
      : Promise.resolve([]),
    mediaTypeFilter !== "movie" && profile.topGenreDims.length > 0
      ? safeDiscover("tv", { with_genres: GENRE_DIM_TO_TMDB[profile.topGenreDims[0]]?.tv.join(",") ?? "" })
      : Promise.resolve([]),
  ])

  const items = [
    ...movies.map((m) => toScoredItem(m, "movie")),
    ...tv.map((t) => toScoredItem(t, "tv")),
  ].filter((i): i is ScoredRowItem => i !== null)

  const deduped = dedupeItems(items)
  if (deduped.length < MIN_ROW_ITEMS) return null

  return {
    key: "top-picks",
    title: mediaTypeFilter === "movie" ? "Recommended Movies For You" : mediaTypeFilter === "tv" ? "Recommended Shows For You" : "Top Picks For You",
    subtitle: "Ranked by your personal 64-dimensional taste profile",
    type: mediaTypeFilter ?? "movie",
    items: deduped,
  }
}

/** Micro-genre rows from the profile's dominant genre/decade features. */
export async function buildMicroGenreRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  if (!profile.hasProfile) return []
  const rows: CandidateRow[] = []

  for (const genreDim of profile.topGenreDims.slice(0, 2)) {
    const ids = GENRE_DIM_TO_TMDB[genreDim]
    if (!ids) continue
    const range = profile.topDecadeBucket !== null ? decadeBucketToYearRange(profile.topDecadeBucket) : null

    const baseParams: Record<string, string> = { sort_by: "popularity.desc" }
    if (range) {
      baseParams["primary_release_date.gte"] = `${range.gte}-01-01`
      baseParams["primary_release_date.lte"] = `${range.lte}-12-31`
    }

    const results = await safeDiscover(mediaTypeFilter ?? "movie", {
      ...baseParams,
      with_genres: (mediaTypeFilter === "tv" ? ids.tv : ids.movie).join(","),
    })

    let items = dedupeItems(results.map((r) => toScoredItem(r, mediaTypeFilter ?? "movie")!))

    // Small-library merge (Module 5.2): merge upward into the parent genre
    // cluster when the decade-narrowed pool is too small.
    if (items.length < MIN_ROW_ITEMS && range) {
      const fallback = await safeDiscover(mediaTypeFilter ?? "movie", {
        sort_by: "popularity.desc",
        with_genres: (mediaTypeFilter === "tv" ? ids.tv : ids.movie).join(","),
      })
      items = dedupeItems([
        ...items,
        ...fallback.map((r) => toScoredItem(r, mediaTypeFilter ?? "movie")!),
      ])
    }

    if (items.length < MIN_ROW_ITEMS) continue

    rows.push({
      key: `micro-genre:${genreDim}${range ? `:${profile.topDecadeBucket}` : ""}`,
      title: microGenreTitle(genreDim, items.length >= MIN_ROW_ITEMS && range ? profile.topDecadeBucket : null),
      subtitle: "A micro-genre synthesized from your recent taste signals",
      type: mediaTypeFilter ?? "movie",
      items,
    })
  }

  return rows
}

/** "[Theme] & [Genre]" row from the profile's dominant TMDB keyword. */
export async function buildKeywordRow(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow | null> {
  if (!profile.hasProfile || profile.topKeywords.length === 0 || profile.topGenreDims.length === 0) {
    return null
  }
  const keyword = profile.topKeywords[0]
  const ids = GENRE_DIM_TO_TMDB[profile.topGenreDims[0]]
  const genreIds = (mediaTypeFilter === "tv" ? ids?.tv : ids?.movie) ?? []
  const genreLabel = GENRE_DIM_LABELS[profile.topGenreDims[0]] ?? "Picks"

  const results = await safeDiscover(mediaTypeFilter ?? "movie", {
    sort_by: "vote_average.desc",
    "vote_count.gte": "50",
    with_keywords: String(keyword.id),
    ...(genreIds.length > 0 ? { with_genres: genreIds.join(",") } : {}),
  })
  const items = dedupeItems(results.map((r) => toScoredItem(r, mediaTypeFilter ?? "movie")!))
  if (items.length < MIN_ROW_ITEMS) return null

  return {
    key: `keyword:${keyword.id}`,
    title: `${capitalize(keyword.name)} & ${genreLabel}`,
    subtitle: `A theme you keep coming back to`,
    type: mediaTypeFilter ?? "movie",
    items,
  }
}

/** "Because You Watched {Title}" seed rows (Module 2.2). */
export async function buildSeedRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  for (const seed of profile.seedCandidates.slice(0, 2)) {
    if (mediaTypeFilter && seed.mediaType !== mediaTypeFilter) continue
    try {
      const recs = await getTmdbRecommendations(seed.tmdbId, seed.mediaType)
      const items = dedupeItems(
        recs
          .filter((r) => !profile.completedKeys.has(`${r.media_type}:${r.tmdbId}`))
          .filter((r) => r.poster_path)
          .map((r) =>
            toScoredItem(
              {
                ...r,
                release_date: r.release_date ?? "",
                first_air_date: r.first_air_date ?? "",
              } as CatalogLike,
              r.media_type
            )!
          )
      )
      if (items.length < MIN_ROW_ITEMS) continue
      let title = `Because You Watched ${seed.title}`
      let subtitle = `Recommendations inspired by ${seed.title}`
      if (seed.eventType === "favorite") {
        title = `Because You Added ${seed.title} to Your List`
        subtitle = `More titles like what you saved to your list`
      } else if (seed.eventType === "request") {
        title = `Because You Requested ${seed.title}`
        subtitle = `Recommendations inspired by your request`
      }

      rows.push({
        key: `byw:${seed.mediaType}:${seed.tmdbId}`,
        title,
        subtitle,
        type: seed.mediaType,
        items,
      })
    } catch (err) {
      console.error(`[Discovery] Seed row failed for ${seed.title}:`, err)
    }
  }
  return rows
}

/** Contextual triggers (Module 2.3): late-night and quick-watch rows. */
export async function buildContextualRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv",
  clientHour?: number
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  const hour = clientHour ?? new Date().getHours()

  if (!mediaTypeFilter || mediaTypeFilter === "movie") {
    if (hour >= 22 || hour < 3) {
      const results = await safeDiscover("movie", {
        with_genres: "53,27",
        sort_by: "popularity.desc",
        "vote_count.gte": "100",
      })
      const items = dedupeItems(results.map((r) => toScoredItem(r, "movie")!))
      if (items.length >= MIN_ROW_ITEMS) {
        rows.push({
          key: "context:late-night",
          title: "Late Night Thrillers",
          subtitle: "Edge-of-your-seat picks for after dark",
          type: "movie",
          items,
        })
      }
    }

    if (profile.meanWatchMinutes !== null && profile.meanWatchMinutes < 35) {
      const results = await safeDiscover("movie", {
        sort_by: "popularity.desc",
        "with_runtime.lte": "35",
        "vote_count.gte": "20",
      })
      const items = dedupeItems(results.map((r) => toScoredItem(r, "movie")!))
      if (items.length >= MIN_ROW_ITEMS) {
        rows.push({
          key: "context:bite-sized",
          title: "Bite-Sized Stories",
          subtitle: "Short watches that fit your schedule",
          type: "movie",
          items,
        })
      }
    }
  }

  return rows
}

/** Curated cold-start pool (Module 5.1): high-variance canonical rows. */
export async function buildColdStartRows(
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  const specs: { key: string; title: string; subtitle: string; type: "movie" | "tv"; fetch: () => Promise<CatalogLike[]> }[] = []

  if (mediaTypeFilter !== "tv") {
    specs.push(
      {
        key: "cold:trending-movies",
        title: "Trending Movies Today",
        subtitle: "What everyone is watching right now",
        type: "movie",
        fetch: () => safeTrending("movie"),
      },
      {
        key: "cold:acclaimed",
        title: "Critically Acclaimed Cinema",
        subtitle: "The highest rated films of all time",
        type: "movie",
        fetch: () =>
          safeDiscover("movie", { sort_by: "vote_average.desc", "vote_count.gte": "250" }),
      },
      {
        key: "cold:action",
        title: "Action Hits",
        subtitle: "Crowd-pleasing blockbusters",
        type: "movie",
        fetch: () => safeDiscover("movie", { with_genres: "28", sort_by: "popularity.desc" }),
      }
    )
  }
  if (mediaTypeFilter !== "movie") {
    specs.push({
      key: "cold:trending-tv",
      title: "Trending Series Today",
      subtitle: "The shows everyone is talking about",
      type: "tv",
      fetch: () => safeTrending("tv"),
    })
  }

  const rows: CandidateRow[] = []
  for (const spec of specs.slice(0, 4)) {
    const results = await spec.fetch()
    const items = dedupeItems(results.map((r) => toScoredItem(r, spec.type)!))
    if (items.length >= MIN_ROW_ITEMS) {
      rows.push({ key: spec.key, title: spec.title, subtitle: spec.subtitle, type: spec.type, items })
    }
  }
  return rows
}

// ── TMDB fetch guards & multi-page candidate pools ──

const POOL_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours
const candidatePoolCache = new Map<string, { items: CatalogLike[]; timestamp: number }>()

export async function safeDiscoverPages(
  mediaType: "movie" | "tv",
  params: Record<string, string>,
  pages = 3
): Promise<CatalogLike[]> {
  const paramKey = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const poolKey = `${mediaType}:${paramKey}:${pages}`

  const cached = candidatePoolCache.get(poolKey)
  if (cached && Date.now() - cached.timestamp < POOL_CACHE_TTL) {
    return cached.items
  }

  const out: CatalogLike[] = []
  try {
    for (let page = 1; page <= pages; page++) {
      const data =
        mediaType === "movie"
          ? await discoverMovies({ ...params, page: String(page) })
          : await discoverTv({ ...params, page: String(page) })
      out.push(...toDisplayable((data?.results ?? []) as CatalogLike[]))
    }
  } catch (err) {
    console.error(`[Discovery] safeDiscoverPages failed for ${poolKey}:`, err)
  }

  candidatePoolCache.set(poolKey, { items: out, timestamp: Date.now() })
  return out
}

async function safeTrending(mediaType: "movie" | "tv"): Promise<CatalogLike[]> {
  return safeDiscoverPages(mediaType, { sort_by: "popularity.desc" }, 3)
}

async function safeDiscover(
  mediaType: "movie" | "tv",
  params: Record<string, string>
): Promise<CatalogLike[]> {
  return safeDiscoverPages(mediaType, params, 3)
}

function dedupeItems(items: ScoredRowItem[]): ScoredRowItem[] {
  const seen = new Set<string>()
  const out: ScoredRowItem[] = []
  for (const item of items) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out.slice(0, ROW_ITEM_LIMIT)
}

export type FacetSpec = {
  mediaType: "movie" | "tv"
  params: Record<string, string>
  title: string
  subtitle?: string
}

export const FACET_REGISTRY: Record<string, FacetSpec> = {
  // Movie facets
  "recently-released-movies": {
    mediaType: "movie",
    params: { sort_by: "primary_release_date.desc", "vote_count.gte": "50" },
    title: "Recently Released Movies",
  },
  "popular-movies": {
    mediaType: "movie",
    params: { sort_by: "popularity.desc" },
    title: "Popular Movies",
  },
  "top-rated-movies": {
    mediaType: "movie",
    params: { sort_by: "vote_average.desc", "vote_count.gte": "250" },
    title: "Top Rated Classics & Masterpieces",
  },
  "action-adventure-movies": {
    mediaType: "movie",
    params: { with_genres: "28,12", sort_by: "popularity.desc" },
    title: "Action & Adventure",
  },
  "sci-fi-fantasy-movies": {
    mediaType: "movie",
    params: { with_genres: "878,14", sort_by: "popularity.desc" },
    title: "Sci-Fi & Fantasy",
  },
  "comedy-movies": {
    mediaType: "movie",
    params: { with_genres: "35", sort_by: "popularity.desc" },
    title: "Comedy Hits",
  },
  "horror-thriller-movies": {
    mediaType: "movie",
    params: { with_genres: "27,53", sort_by: "popularity.desc" },
    title: "Horror & Suspense Thrillers",
  },

  // TV facets
  "on-the-air-shows": {
    mediaType: "tv",
    params: { sort_by: "popularity.desc" },
    title: "Currently Airing & On The Air",
  },
  "popular-shows": {
    mediaType: "tv",
    params: { sort_by: "popularity.desc" },
    title: "Popular TV Shows",
  },
  "top-rated-shows": {
    mediaType: "tv",
    params: { sort_by: "vote_average.desc", "vote_count.gte": "200" },
    title: "Top Rated & Legendary Series",
  },
  "sci-fi-fantasy-shows": {
    mediaType: "tv",
    params: { with_genres: "10765", sort_by: "popularity.desc" },
    title: "Sci-Fi & Fantasy Series",
  },
  "crime-mystery-shows": {
    mediaType: "tv",
    params: { with_genres: "80,9648", sort_by: "popularity.desc" },
    title: "Crime & Mystery Thrillers",
  },
  "comedy-shows": {
    mediaType: "tv",
    params: { with_genres: "35", sort_by: "popularity.desc" },
    title: "Bingeable Comedies",
  },
  "animation-shows": {
    mediaType: "tv",
    params: { with_genres: "16", sort_by: "popularity.desc" },
    title: "Animation & Anime Series",
  },
}

export async function getFacetScoredItems(
  facetKey: string
): Promise<{ spec: FacetSpec; items: ScoredRowItem[] } | null> {
  const spec = FACET_REGISTRY[facetKey]
  if (!spec) return null
  const catalogItems = await safeDiscoverPages(spec.mediaType, spec.params, 3)
  const items = dedupeItems(
    catalogItems.map((item) => toScoredItem(item, spec.mediaType)!).filter((i): i is ScoredRowItem => i !== null)
  )
  return { spec, items }
}
