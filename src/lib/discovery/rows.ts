import {
  discoverMovies,
  discoverTv,
  tvOnTheAir,
  tvAiringToday,
  tvPopular,
  tvTopRated,
  moviePopular,
  movieTopRated,
  movieNowPlaying,
  movieUpcoming,
  trending,
  tmdbFetch,
  collectionDetail,
  type TmdbMovie,
  type TmdbTvShow,
  type TmdbPaginated,
} from "../tmdb"
import { filterReleasedContent, filterDisplayableContent } from "../catalog"
import { toRowItem, getTmdbRecommendations, type RowItem } from "../recommendations"
import { qualityFloorParams, withQualityFloors, type MediaKind } from "../catalog-quality"
import {
  scriptedTvParams,
  suitabilityMultiplier,
  curateTrending,
  UNSCRIPTED_TV_GENRE_IDS,
} from "../content-policy"
import {
  buildItemVector,
  GENRE_DIM_LABELS,
  DECADE_LABELS,
  GENRE_DIM_TO_TMDB,
  joinGenreIds,
  decadeBucketToYearRange,
} from "./vector"
import { getCachedItemProfile } from "./store"
import { resolveItemProfile } from "./profile"
import type { UserDiscoveryProfile } from "./profile"

/**
 * Dynamic row synthesis (Discovery Engine, Module 2): micro-genre rows from
 * the profile's dominant features, "Because You Watched" seed rows, contextual
 * trigger rows, watch-it-again, network/language rails, and a curated
 * cold-start pool with full movie/TV parity (audit R1-2).
 */

export type ScoredRowItem = {
  key: string // "movie:123"
  vector: number[]
  popularity: number
  voteAverage: number
  voteCount: number
  releaseYear: number | null
  rowItem: RowItem
  /** True once the vector was enriched from a resolved item profile. */
  dense?: boolean
}

export type CandidateRow = {
  key: string
  title: string
  subtitle?: string
  type: "movie" | "tv"
  items: ScoredRowItem[]
}

export const MIN_ROW_ITEMS = 5
/** Served page size — one "page" of a row (R1-1 pagination unit). */
export const ROW_ITEM_LIMIT = 20
/** Pool retention (R0-6 over-fetch): keep up to 60 candidates post-filter so
 * pagination (R1-1) and client filtering headroom never starve a row. */
export const POOL_ITEM_LIMIT = 60

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

/** Convert a raw catalog pool into deduped, pool-capped scored items. */
export function toScoredItems(items: CatalogLike[], mediaType: "movie" | "tv"): ScoredRowItem[] {
  return dedupeItems(items.map((item) => toScoredItem(item, mediaType)!).filter((i): i is ScoredRowItem => i !== null))
}

function toDisplayable(
  results: CatalogLike[],
  allowMissingOverview = false,
  includeFutureReleases = false
): CatalogLike[] {
  return filterDisplayableContent(
    filterReleasedContent(results, { includeFutureReleases, includeCinemas: includeFutureReleases }),
    { allowMissingOverview, includeFutureReleases }
  ) as CatalogLike[]
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

/** Genre ids for a dim+media, or null when the mapping is empty (skip row). */
function dimGenreIds(genreDim: number, mediaType: MediaKind): number[] | null {
  const ids = GENRE_DIM_TO_TMDB[genreDim]?.[mediaType]
  if (!ids || ids.length === 0) return null
  return ids
}

// ── Row builders ──

/** "Top Picks For You" — cross-catalog pool ranked purely by S_item later. */
export async function buildTopPicksRow(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow | null> {
  const genreDim = profile.topGenreDims[0]
  const movieGenreIds = genreDim !== undefined ? dimGenreIds(genreDim, "movie") : null
  const tvGenreIds = genreDim !== undefined ? dimGenreIds(genreDim, "tv") : null

  const [movies, tv, genreMovies, genreTv] = await Promise.all([
    mediaTypeFilter !== "tv" ? safeTrending("movie") : Promise.resolve([]),
    mediaTypeFilter !== "movie" ? safeTrending("tv") : Promise.resolve([]),
    mediaTypeFilter !== "tv" && movieGenreIds
      ? safeDiscover("movie", {
          with_genres: joinGenreIds(movieGenreIds),
          ...qualityFloorParams("browse", "movie"),
          "with_runtime.gte": "20",
        })
      : Promise.resolve([]),
    mediaTypeFilter !== "movie" && tvGenreIds
      ? safeDiscover("tv", {
          with_genres: joinGenreIds(tvGenreIds),
          ...qualityFloorParams("browse", "tv"),
        })
      : Promise.resolve([]),
  ])

  const items = [
    ...movies.map((m) => toScoredItem(m, "movie")),
    ...tv.map((t) => toScoredItem(t, "tv")),
    ...genreMovies.map((m) => toScoredItem(m, "movie")),
    ...genreTv.map((t) => toScoredItem(t, "tv")),
  ].filter((i): i is ScoredRowItem => i !== null)

  const deduped = dedupeItems(items)
  if (deduped.length < MIN_ROW_ITEMS) return null

  return {
    key: "top-picks",
    title:
      mediaTypeFilter === "movie"
        ? "Recommended Movies For You"
        : mediaTypeFilter === "tv"
          ? "Recommended Shows For You"
          : "Top Picks For You",
    subtitle: profile.hasProfile
      ? "Ranked by your personal taste profile"
      : "Popular with members right now — watch a few titles to personalize this row",
    type: mediaTypeFilter ?? "movie",
    items: deduped,
  }
}

/**
 * Micro-genre rows from the profile's dominant genre/decade features.
 * R1-2/§3.1: each dim now yields BOTH movie and TV variants (when a mapping
 * exists) so the home feed is never a movie monoculture; MMR picks between
 * them downstream.
 */
export async function buildMicroGenreRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  if (!profile.hasProfile) return []
  const rows: CandidateRow[] = []
  const range = profile.topDecadeBucket !== null ? decadeBucketToYearRange(profile.topDecadeBucket) : null

  for (const genreDim of profile.topGenreDims.slice(0, 3)) {
    for (const targetType of ["movie", "tv"] as const) {
      if (mediaTypeFilter && targetType !== mediaTypeFilter) continue
      const ids = dimGenreIds(genreDim, targetType)
      // §1.5: skip the variant entirely when there is no mapping — never
      // issue an empty with_genres filter (which returns unfiltered popular
      // content wearing a personalization label).
      if (!ids) continue

      const baseParams: Record<string, string> = withQualityFloors(
        {
          sort_by: "popularity.desc",
          ...(targetType === "movie" ? { "with_runtime.gte": "20" } : {}),
        },
        "browse",
        targetType
      )
      if (range) {
        baseParams["primary_release_date.gte"] = `${range.gte}-01-01`
        baseParams["primary_release_date.lte"] = `${range.lte}-12-31`
      }

      const results = await safeDiscover(targetType, {
        ...baseParams,
        with_genres: joinGenreIds(ids),
      })

      let items = dedupeItems(results.map((r) => toScoredItem(r, targetType)!))

      // Small-library merge (Module 5.2): merge upward into the parent genre
      // cluster when the decade-narrowed pool is too small. The fallback
      // carries the same browse floors (audit R0-2 hole).
      if (items.length < MIN_ROW_ITEMS && range) {
        const fallback = await safeDiscover(
          targetType,
          withQualityFloors(
            { sort_by: "popularity.desc", with_genres: joinGenreIds(ids) },
            "browse",
            targetType
          )
        )
        items = dedupeItems([...items, ...fallback.map((r) => toScoredItem(r, targetType)!)])
      }

      if (items.length < MIN_ROW_ITEMS) continue

      rows.push({
        key: `micro-genre:${genreDim}:${targetType}${range ? `:${profile.topDecadeBucket}` : ""}`,
        title: microGenreTitle(genreDim, items.length >= MIN_ROW_ITEMS && range ? profile.topDecadeBucket : null),
        subtitle: "A micro-genre synthesized from your recent taste signals",
        type: targetType,
        items,
      })
    }
  }

  return rows
}

/**
 * "[Theme] & [Genre]" rows from the profile's dominant TMDB keywords.
 * R1-2/§3.3: up to 3 distinct keyword rows (the profile tracks 10 keywords —
 * the previous builder used exactly one).
 */
export async function buildKeywordRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  if (!profile.hasProfile || profile.topKeywords.length === 0 || profile.topGenreDims.length === 0) {
    return []
  }
  const rows: CandidateRow[] = []
  const usedGenreDims = new Set<number>()

  for (const keyword of profile.topKeywords.slice(0, 5)) {
    if (rows.length >= 3) break
    // Alternate media types so the home feed gets keyword variety on both
    // sides (§3.1); respect an explicit filter.
    const targetType: MediaKind =
      mediaTypeFilter ?? (rows.length % 2 === 0 ? "movie" : "tv")
    const genreDim =
      profile.topGenreDims.find((d) => !usedGenreDims.has(d)) ?? profile.topGenreDims[0]
    const ids = genreDim !== undefined ? dimGenreIds(genreDim, targetType) : null
    const genreLabel = genreDim !== undefined ? (GENRE_DIM_LABELS[genreDim] ?? "Picks") : "Picks"
    if (genreDim !== undefined) usedGenreDims.add(genreDim)

    const results = await safeDiscover(targetType, {
      sort_by: "vote_average.desc",
      ...qualityFloorParams("niche", targetType),
      with_keywords: String(keyword.id),
      ...(ids ? { with_genres: joinGenreIds(ids) } : {}),
    })
    const items = dedupeItems(results.map((r) => toScoredItem(r, targetType)!))
    if (items.length < MIN_ROW_ITEMS) continue

    rows.push({
      key: `keyword:${keyword.id}:${targetType}`,
      title: `${capitalize(keyword.name)} & ${genreLabel}`,
      subtitle: "A theme you keep coming back to",
      type: targetType,
      items,
    })
  }

  return rows
}

/** "Because You Watched {Title}" seed rows (Module 2.2, R1-2 multi-seed). */
export async function buildSeedRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  for (const seed of profile.seedCandidates.slice(0, 4)) {
    if (mediaTypeFilter && seed.mediaType !== mediaTypeFilter) continue
    try {
      // §3.2: mix /recommendations and /similar per seed for variety.
      const [recs, similar] = await Promise.all([
        getTmdbRecommendations(seed.tmdbId, seed.mediaType),
        getTmdbSimilar(seed.tmdbId, seed.mediaType),
      ])
      const merged = interleave(recs, similar)
      const items = dedupeItems(
        merged
          .filter((r) => !profile.completedKeys.has(`${r.media_type}:${r.tmdbId}`))
          .filter((r) => !profile.hiddenKeys?.has(`${r.media_type}:${r.tmdbId}`))
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
        subtitle = "More titles like what you saved to your list"
      } else if (seed.eventType === "request") {
        title = `Because You Requested ${seed.title}`
        subtitle = "Recommendations inspired by your request"
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

function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    if (i < a.length) out.push(a[i])
    if (i < b.length) out.push(b[i])
  }
  return out
}

async function getTmdbSimilar(
  itemId: number,
  mediaType: "movie" | "tv"
): Promise<Awaited<ReturnType<typeof getTmdbRecommendations>>> {
  try {
    const data = await tmdbFetch<TmdbPaginated<TmdbMovie | TmdbTvShow>>(`/${mediaType}/${itemId}/similar`)
    return (data.results ?? []).map((item) => ({
      id: item.id,
      tmdbId: item.id,
      title: "title" in item ? item.title! : item.name!,
      name: "name" in item ? item.name : undefined,
      media_type: mediaType,
      poster_path: item.poster_path,
      backdrop_path: item.backdrop_path,
      overview: item.overview,
      release_date: "release_date" in item ? item.release_date : undefined,
      first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
      vote_average: item.vote_average,
      vote_count: item.vote_count,
      popularity: item.popularity,
      genre_ids: "genre_ids" in item ? item.genre_ids || [] : [],
      source: "similar" as const,
      score: 0,
    }))
  } catch {
    return []
  }
}

/**
 * "Watch It Again" (§7.6/R1-2): completed titles resurfaced from the Convex
 * item-feature cache (profile builds keep these warm).
 */
export async function buildWatchAgainRow(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow | null> {
  if (!profile.hasProfile || profile.completedKeys.size === 0) return null

  const items: ScoredRowItem[] = []
  for (const key of profile.completedKeys) {
    if (items.length >= ROW_ITEM_LIMIT) break
    const [mediaTypeRaw, idRaw] = key.split(":")
    if (mediaTypeRaw !== "movie" && mediaTypeRaw !== "tv") continue
    if (mediaTypeFilter && mediaTypeRaw !== mediaTypeFilter) continue
    const tmdbId = Number.parseInt(idRaw, 10)
    if (!Number.isFinite(tmdbId)) continue

    const cached = await getCachedItemProfile(mediaTypeRaw, tmdbId)
    if (!cached) continue
    const rowItem = toRowItem(
      {
        id: cached.tmdbId,
        title: cached.title,
        name: cached.title,
        poster_path: null,
        backdrop_path: null,
        overview: "",
        release_date: cached.mediaType === "movie" ? (cached.releaseDate ?? "") : undefined,
        first_air_date: cached.mediaType === "tv" ? (cached.releaseDate ?? "") : undefined,
        vote_average: cached.voteAverage,
        vote_count: cached.voteCount,
        popularity: cached.popularity,
        genre_ids: cached.genreIds,
      } as TmdbMovie,
      cached.mediaType
    )
    // Completed items skip the displayability filter — the user watched them.
    items.push({
      key: key,
      vector: cached.vector,
      popularity: cached.popularity,
      voteAverage: cached.voteAverage,
      voteCount: cached.voteCount,
      releaseYear: cached.releaseYear,
      rowItem,
      dense: true,
    })
  }

  if (items.length < MIN_ROW_ITEMS) return null
  return {
    key: "watch-it-again",
    title: "Watch It Again",
    subtitle: "Titles you have finished and might revisit",
    type: mediaTypeFilter ?? "movie",
    items,
  }
}

/**
 * Contextual triggers (Module 2.3, R1-2/§3.4): late-night driven by the
 * user's own peak viewing hour (not wall-clock stereotypes), bite-sized
 * picks, weekend family, and short-episode TV — each with TV variants.
 */
export async function buildContextualRows(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv",
  clientHour?: number
): Promise<CandidateRow[]> {
  const rows: CandidateRow[] = []
  const hour = profile.peakViewingHour ?? clientHour ?? new Date().getHours()
  const isWeekend = [0, 6].includes(new Date().getDay())

  // Late night: derive genres from the user's own taste when it leans
  // dark/thrilling; default to Thriller|Horror movies + Crime|Mystery TV.
  const darkDims = new Set([11, 13, 16, 4])
  const userDark = profile.topGenreDims.find((d) => darkDims.has(d))
  const lateNightMovieGenres = userDark !== undefined ? dimGenreIds(userDark, "movie") ?? [53, 27] : [53, 27]
  if (hour >= 22 || hour < 3) {
    for (const targetType of ["movie", "tv"] as const) {
      if (mediaTypeFilter && targetType !== mediaTypeFilter) continue
      const genreIds =
        targetType === "movie" ? lateNightMovieGenres : [80, 9648] // Crime|Mystery (TV thriller proxy)
      const results = await safeDiscover(targetType, {
        with_genres: joinGenreIds(genreIds),
        sort_by: "popularity.desc",
        ...qualityFloorParams("browse", targetType),
      })
      const items = dedupeItems(results.map((r) => toScoredItem(r, targetType)!))
      if (items.length >= MIN_ROW_ITEMS) {
        rows.push({
          key: `context:late-night:${targetType}`,
          title: "Late Night Thrillers",
          subtitle: "Edge-of-your-seat picks for after dark",
          type: targetType,
          items,
        })
      }
    }
  }

  // Bite-sized: short watches matching the user's habits — movies ≤ 40 min
  // or ≤ 30-minute TV episodes.
  if (profile.meanWatchMinutes !== null && profile.meanWatchMinutes < 35) {
    for (const targetType of ["movie", "tv"] as const) {
      if (mediaTypeFilter && targetType !== mediaTypeFilter) continue
      const results = await safeDiscover(targetType, {
        sort_by: "popularity.desc",
        "with_runtime.lte": targetType === "movie" ? "40" : "30",
        ...qualityFloorParams("browse", targetType),
      })
      const items = dedupeItems(results.map((r) => toScoredItem(r, targetType)!))
      if (items.length >= MIN_ROW_ITEMS) {
        rows.push({
          key: `context:bite-sized:${targetType}`,
          title: "Bite-Sized Stories",
          subtitle: "Short watches that fit your schedule",
          type: targetType,
          items,
        })
      }
    }
  }

  // Weekend family picks (§3.4): family/animation on weekend daytime.
  if (isWeekend && hour >= 9 && hour < 20) {
    for (const targetType of ["movie", "tv"] as const) {
      if (mediaTypeFilter && targetType !== mediaTypeFilter) continue
      const ids =
        targetType === "movie" ? [10751, 16] : dimGenreIds(7, "tv") ?? [10751]
      const results = await safeDiscover(targetType, {
        with_genres: joinGenreIds(ids),
        sort_by: "popularity.desc",
        ...qualityFloorParams("browse", targetType),
      })
      const items = dedupeItems(results.map((r) => toScoredItem(r, targetType)!))
      if (items.length >= MIN_ROW_ITEMS) {
        rows.push({
          key: `context:weekend-family:${targetType}`,
          title: "Weekend Family Picks",
          subtitle: "Something for everyone to watch together",
          type: targetType,
          items,
        })
      }
    }
  }

  return rows
}

/**
 * Opt-in daily-format row (§1.6): Reality|Soap|Talk|News surfaces ONLY when
 * the user's taste vector actually favors dim 19.
 */
export async function buildDailyFormatRow(
  profile: UserDiscoveryProfile,
  mediaTypeFilter?: "movie" | "tv"
): Promise<CandidateRow | null> {
  if (!profile.topGenreDims.includes(19)) return null
  if (mediaTypeFilter === "movie") return null

  const results = await safeDiscover("tv", {
    with_genres: joinGenreIds(UNSCRIPTED_TV_GENRE_IDS),
    sort_by: "popularity.desc",
    ...qualityFloorParams("browse", "tv"),
  })
  const items = dedupeItems(results.map((r) => toScoredItem(r, "tv")!))
  if (items.length < MIN_ROW_ITEMS) return null
  return {
    key: "daily-formats",
    title: "Reality, Talk & Daily Dramas",
    subtitle: "Unscripted picks because you watch them",
    type: "tv",
    items,
  }
}

/** Curated cold-start pool (Module 5.1, R1-2 parity): 6+ specs per media type. */
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
        key: "cold:popular-movies",
        title: "Popular Movies",
        subtitle: "The crowd favourites, week after week",
        type: "movie",
        fetch: () => safeCuratedList("movie-popular"),
      },
      {
        key: "cold:acclaimed",
        title: "Critically Acclaimed Cinema",
        subtitle: "The highest rated films of all time",
        type: "movie",
        fetch: () =>
          safeDiscover("movie", { sort_by: "vote_average.desc", ...qualityFloorParams("curated", "movie") }),
      },
      {
        key: "cold:action",
        title: "Action Hits",
        subtitle: "Crowd-pleasing blockbusters",
        type: "movie",
        fetch: () =>
          safeDiscover("movie", {
            with_genres: "28",
            sort_by: "popularity.desc",
            ...qualityFloorParams("browse", "movie"),
          }),
      },
      {
        key: "cold:comedy-movies",
        title: "Comedy Favourites",
        subtitle: "Guaranteed laughs",
        type: "movie",
        fetch: () =>
          safeDiscover("movie", {
            with_genres: "35",
            sort_by: "popularity.desc",
            ...qualityFloorParams("browse", "movie"),
          }),
      },
      {
        key: "cold:new-releases",
        title: "New Movie Releases",
        subtitle: "Fresh from the last few weeks",
        type: "movie",
        fetch: () =>
          safeDiscover("movie", {
            sort_by: "primary_release_date.desc",
            ...qualityFloorParams("fresh", "movie"),
            "with_runtime.gte": "20",
          }),
      }
    )
  }
  if (mediaTypeFilter !== "movie") {
    specs.push(
      {
        key: "cold:trending-tv",
        title: "Trending Series Today",
        subtitle: "The shows everyone is talking about",
        type: "tv",
        fetch: () => safeTrending("tv"),
      },
      {
        key: "cold:popular-shows",
        title: "Popular Series",
        subtitle: "Bingeable favourites right now",
        type: "tv",
        fetch: () => safeCuratedList("tv-popular"),
      },
      {
        key: "cold:on-the-air",
        title: "Airing New Episodes",
        subtitle: "Series broadcasting right now",
        type: "tv",
        fetch: () => safeCuratedList("on-the-air"),
      },
      {
        key: "cold:acclaimed-shows",
        title: "Critically Acclaimed Series",
        subtitle: "The highest rated shows of all time",
        type: "tv",
        fetch: () =>
          safeDiscover("tv", { sort_by: "vote_average.desc", ...qualityFloorParams("curated", "tv") }),
      },
      {
        key: "cold:drama-shows",
        title: "Gripping Dramas",
        subtitle: "Character-driven stories",
        type: "tv",
        fetch: () =>
          safeDiscover("tv", {
            with_genres: "18",
            sort_by: "popularity.desc",
            ...qualityFloorParams("browse", "tv"),
          }),
      },
      {
        key: "cold:scifi-shows",
        title: "Sci-Fi & Fantasy Series",
        subtitle: "Other worlds, weekly",
        type: "tv",
        fetch: () =>
          safeDiscover("tv", {
            with_genres: "10765",
            sort_by: "popularity.desc",
            ...qualityFloorParams("browse", "tv"),
          }),
      }
    )
  }

  const rows: CandidateRow[] = []
  // Alternate movie/TV specs when both lists are present so a cold home feed
  // shows mixed content from the start (§2.4).
  const ordered: typeof specs = []
  const movieSpecs = specs.filter((s) => s.type === "movie")
  const tvSpecs = specs.filter((s) => s.type === "tv")
  const interleaved = interleave(movieSpecs, tvSpecs)
  ordered.push(...interleaved)

  for (const spec of ordered) {
    const results = await spec.fetch()
    const items = dedupeItems(results.map((r) => toScoredItem(r, spec.type)!))
    if (items.length >= MIN_ROW_ITEMS) {
      rows.push({ key: spec.key, title: spec.title, subtitle: spec.subtitle, type: spec.type, items })
    }
  }
  return rows
}

// ── Dense candidate enrichment (R2-1 / §4.1) ──

/**
 * Enrich candidate vectors for the top-N items of a row through the Convex
 * item-feature cache (people + keyword dims). Cache hits are synchronous;
 * misses trigger a background detail fetch (SingleFlight'd by the store) so
 * the *next* feed build — pool caches live 6h — gets dense vectors without
 * stalling this one.
 */
export async function enrichCandidateVectors(
  items: ScoredRowItem[],
  opts: { topN?: number; backgroundFill?: boolean } = {}
): Promise<ScoredRowItem[]> {
  const topN = opts.topN ?? 24
  const slice = items.slice(0, topN)
  const enriched = await Promise.all(
    slice.map(async (item) => {
      const [mediaType, idRaw] = item.key.split(":")
      if (mediaType !== "movie" && mediaType !== "tv") return item
      const tmdbId = Number.parseInt(idRaw, 10)
      if (!Number.isFinite(tmdbId)) return item

      const cached = await getCachedItemProfile(mediaType, tmdbId)
      if (cached) {
        return { ...item, vector: cached.vector, dense: true }
      }
      if (opts.backgroundFill !== false) {
        void resolveItemProfile(tmdbId, mediaType).catch(() => {})
      }
      return item
    })
  )
  return [...enriched, ...items.slice(topN)]
}

// ── TMDB fetch guards & multi-page candidate pools ──

const POOL_CACHE_TTL = 6 * 60 * 60 * 1000 // 6 hours
const MAX_POOL_CACHE_ENTRIES = 300
const candidatePoolCache = new Map<string, { items: CatalogLike[]; timestamp: number }>()

function sweepPoolCache() {
  const now = Date.now()
  for (const [key, entry] of candidatePoolCache) {
    if (now - entry.timestamp >= POOL_CACHE_TTL) candidatePoolCache.delete(key)
  }
  if (candidatePoolCache.size > MAX_POOL_CACHE_ENTRIES) {
    const overflow = candidatePoolCache.size - MAX_POOL_CACHE_ENTRIES
    const oldest = [...candidatePoolCache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, overflow)
    for (const [key] of oldest) candidatePoolCache.delete(key)
  }
}

export type SafeDiscoverOptions = {
  /** Skip the default scripted-TV bias (opt-in dailies/unscripted rows). */
  allowUnscriptedTv?: boolean
  /** First TMDB page to fetch (R1-1 pagination: page bundles of `pages`). */
  startPage?: number
  /** §1.9: accept international titles without an English overview. */
  allowMissingOverview?: boolean
  /** §7.8: keep future/cinema-window releases (Coming Soon rails). */
  includeFutureReleases?: boolean
}

export async function safeDiscoverPages(
  mediaType: "movie" | "tv",
  params: Record<string, string>,
  pages = 2,
  opts: SafeDiscoverOptions = {}
): Promise<CatalogLike[]> {
  const startPage = Math.max(1, opts.startPage ?? 1)
  const paramKey = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")
  const poolKey = `${mediaType}:${paramKey}:${pages}:${startPage}`

  sweepPoolCache()
  const cached = candidatePoolCache.get(poolKey)
  if (cached && Date.now() - cached.timestamp < POOL_CACHE_TTL) {
    return cached.items
  }

  const out: CatalogLike[] = []
  try {
    for (let page = startPage; page < startPage + pages; page++) {
      const data =
        mediaType === "movie"
          ? await discoverMovies({ ...params, page: String(page) })
          : await discoverTv({ ...params, page: String(page) })
      out.push(
        ...toDisplayable(
          (data?.results ?? []) as CatalogLike[],
          opts.allowMissingOverview,
          opts.includeFutureReleases
        )
      )
    }
  } catch (err) {
    console.error(`[Discovery] safeDiscoverPages failed for ${poolKey}:`, err)
  }

  candidatePoolCache.set(poolKey, { items: out, timestamp: Date.now() })
  return out
}

async function safeDiscover(
  mediaType: "movie" | "tv",
  params: Record<string, string>,
  opts: SafeDiscoverOptions = {}
): Promise<CatalogLike[]> {
  const paramsWithPolicy: Record<string, string> = { ...params }
  // Content policy (R0-4/§1.6): general TV rows bias to scripted content so
  // dailies/soaps/talk/news never dominate by default.
  if (mediaType === "tv" && !opts.allowUnscriptedTv && paramsWithPolicy.with_type === undefined) {
    Object.assign(paramsWithPolicy, scriptedTvParams())
  }
  paramsWithPolicy.include_adult = "false"
  return safeDiscoverPages(mediaType, paramsWithPolicy, 2, opts)
}

/** True `/trending` (§3.5) with the shared curation post-filter (§1.7). */
const trendingCache = new Map<string, { items: CatalogLike[]; timestamp: number }>()
const TRENDING_TTL = 30 * 60 * 1000

async function safeTrending(mediaType: "movie" | "tv"): Promise<CatalogLike[]> {
  const key = `${mediaType}:week`
  const cached = trendingCache.get(key)
  if (cached && Date.now() - cached.timestamp < TRENDING_TTL) return cached.items

  let items: CatalogLike[] = []
  try {
    const data = await trending(mediaType, "week")
    const curated = curateTrending(
      (data?.results ?? []).map((item) => {
        return {
          id: item.id,
          popularity: item.popularity,
          voteAverage: item.vote_average,
          voteCount: item.vote_count,
          adult: ("adult" in item ? item.adult : undefined) ?? undefined,
          title: "title" in item ? item.title : undefined,
          name: "name" in item ? item.name : undefined,
          posterPath: item.poster_path,
          backdropPath: item.backdrop_path,
          raw: item,
        }
      })
    )
    items = curated.map((entry) => entry.raw as CatalogLike)
  } catch (err) {
    console.error(`[Discovery] safeTrending failed for ${mediaType}:`, err)
  }

  trendingCache.set(key, { items, timestamp: Date.now() })
  return items
}

/**
 * Curated TMDB list endpoints (Appendix A.4) — soap-free by construction.
 * Used by the airing facet (R1-6) and cold-start parity rows (R1-2).
 */
const curatedListCache = new Map<string, { items: CatalogLike[]; timestamp: number }>()

/** Curated TMDB list endpoints; `collection:<id>` addresses /collection/{id} (§7.5). */
export type CuratedListKind =
  | "on-the-air"
  | "airing-today"
  | "movie-popular"
  | "tv-popular"
  | "movie-top-rated"
  | "tv-top-rated"
  | "movie-now-playing"
  | "movie-upcoming"
  | "trending-movie"
  | "trending-tv"
  | `collection:${number}`

export async function safeCuratedList(
  kind: CuratedListKind,
  page = 1
): Promise<CatalogLike[]> {
  // Real /trending (§3.5) already carries its own curation post-filter.
  if (kind === "trending-movie") return safeTrending("movie")
  if (kind === "trending-tv") return safeTrending("tv")

  // Franchise/collection rails (§7.5): /collection/{id} parts in release order.
  if (kind.startsWith("collection:")) {
    const collectionId = Number.parseInt(kind.slice("collection:".length), 10)
    if (!Number.isFinite(collectionId)) return []
    const cacheKey = `${kind}:${page}`
    const cachedCollection = curatedListCache.get(cacheKey)
    if (cachedCollection && Date.now() - cachedCollection.timestamp < TRENDING_TTL) {
      return cachedCollection.items
    }
    let collectionItems: CatalogLike[] = []
    try {
      const detail = await collectionDetail(collectionId, page)
      const parts = (detail?.parts ?? []) as CatalogLike[]
      const sorted = [...parts].sort((a, b) => {
        const da = "release_date" in a ? a.release_date ?? "" : ""
        const db = "release_date" in b ? b.release_date ?? "" : ""
        return da.localeCompare(db)
      })
      collectionItems = toDisplayable(sorted.filter((r) => r.adult !== true))
    } catch (err) {
      console.error(`[Discovery] safeCuratedList failed for ${kind}:`, err)
    }
    curatedListCache.set(cacheKey, { items: collectionItems, timestamp: Date.now() })
    return collectionItems
  }

  const key = `${kind}:${page}`
  const cached = curatedListCache.get(key)
  if (cached && Date.now() - cached.timestamp < TRENDING_TTL) return cached.items

  let items: CatalogLike[] = []
  try {
    let data: TmdbPaginated<TmdbMovie | TmdbTvShow> | null = null
    switch (kind) {
      case "on-the-air":
        data = await tvOnTheAir(page)
        break
      case "airing-today":
        data = await tvAiringToday(page)
        break
      case "movie-popular":
        data = await moviePopular(page)
        break
      case "tv-popular":
        data = await tvPopular(page)
        break
      case "movie-top-rated":
        data = await movieTopRated(page)
        break
      case "tv-top-rated":
        data = await tvTopRated(page)
        break
      case "movie-now-playing":
        data = await movieNowPlaying(page)
        break
      case "movie-upcoming":
        data = await movieUpcoming(page)
        break
    }
    const results = (data?.results ?? []) as CatalogLike[]
    // Curated endpoints have no filters server-side either; apply the shared
    // displayability + explicit-demote pipeline once, server-side (§1.7/§1.8).
    const filtered = toDisplayable(results.filter((r) => r.adult !== true))
    const demoted = filtered
      .map((item) => ({
        item,
        mult: suitabilityMultiplier({
          adult: item.adult,
          title: "title" in item ? item.title : "name" in item ? item.name : undefined,
        }),
      }))
      .sort((a, b) => b.mult - a.mult)
      .map(({ item }) => item)
    items = demoted
  } catch (err) {
    console.error(`[Discovery] safeCuratedList failed for ${kind}:`, err)
  }

  curatedListCache.set(key, { items, timestamp: Date.now() })
  return items
}

export function dedupeItems(items: ScoredRowItem[]): ScoredRowItem[] {
  const seen = new Set<string>()
  const out: ScoredRowItem[] = []
  for (const item of items) {
    if (seen.has(item.key)) continue
    seen.add(item.key)
    out.push(item)
  }
  return out.slice(0, POOL_ITEM_LIMIT)
}
