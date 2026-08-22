import { GENRES, getGenreDiscoverParams, type GenreDef } from "../genres"
import { qualityFloorParams } from "../catalog-quality"
import { UNSCRIPTED_TV_GENRE_IDS } from "../content-policy"
import { safeDiscoverPages, safeCuratedList, toScoredItems, type CuratedListKind, type ScoredRowItem } from "./rows"

/**
 * Data-driven facet registry (audit R1-3 / §2.3, §2.6).
 *
 * The legacy 14 hand-written facets are replaced by a generated family:
 * Popular / Top Rated / New per genre per media type from the canonical
 * `genres.ts` registry (≈40+ facets), plus curated-endpoint facets (real
 * `/tv/on_the_air`, Top-10 rails — R1-6), network/provider rails and
 * language rails (R2-4 / §7.4, §7.7).
 *
 * Facets are lazy: only requested keys hit TMDB, and every discover-based
 * facet flows through the 6h pool cache with the central quality floors.
 */

export type FacetSpec = {
  mediaType: "movie" | "tv"
  /** TMDB discover params (ignored when `source` is set). */
  params: Record<string, string>
  title: string
  subtitle?: string
  /** Curated TMDB list endpoint instead of /discover. */
  source?: CuratedListKind
  /** Render with ordinal Top-10 badges (§7.2). */
  isTop10?: boolean
  /** Skip the default scripted-TV bias (unscripted genre facets). */
  allowUnscriptedTv?: boolean
  /** §1.9: accept international titles without an English overview. */
  allowMissingOverview?: boolean
  /** §7.8: keep future/cinema-window releases (Coming Soon rails). */
  includeFutureReleases?: boolean
  /** Genre slug the facet belongs to (genre-mode page filtering, R1-3). */
  genreSlug?: string
  /** Extra discover params from the genre def (e.g. anime → origin country). */
  genreDiscoverParams?: Record<string, string>
}

function today(): string {
  return new Date().toISOString().split("T")[0]
}

// ── Hand-curated cross-genre facets ──

function coreFacets(): FacetSpec[] {
  return [
    // Movie facets
    {
      mediaType: "movie",
      params: {
        sort_by: "primary_release_date.desc",
        ...qualityFloorParams("fresh", "movie"),
        "with_runtime.gte": "20",
        "primary_release_date.lte": today(),
      },
      title: "Recently Released Movies",
      subtitle: "Freshly released movies available for streaming",
    },
    {
      mediaType: "movie",
      params: { sort_by: "popularity.desc", ...qualityFloorParams("browse", "movie"), "with_runtime.gte": "20" },
      title: "Popular Movies",
      subtitle: "Top trending movies everyone is watching",
    },
    {
      mediaType: "movie",
      params: { sort_by: "vote_average.desc", ...qualityFloorParams("curated", "movie"), "with_runtime.gte": "30" },
      title: "Top Rated Classics & Masterpieces",
      subtitle: "Highest critically acclaimed movies of all time",
    },
    {
      mediaType: "movie",
      source: "movie-popular",
      params: {},
      title: "Top 10 Movies Today",
      subtitle: "The most-watched movies right now",
      isTop10: true,
    },
    {
      mediaType: "movie",
      source: "trending-movie",
      params: {},
      title: "Trending Movies Right Now",
      subtitle: "What everyone is watching this week",
    },
    // TV facets
    {
      mediaType: "tv",
      source: "on-the-air",
      params: {},
      title: "Currently Airing & On The Air",
      subtitle: "Series actively broadcasting new episodes right now",
    },
    {
      mediaType: "tv",
      params: { sort_by: "popularity.desc", ...qualityFloorParams("browse", "tv") },
      title: "Popular TV Shows",
      subtitle: "Top trending series this week",
    },
    {
      mediaType: "tv",
      params: { sort_by: "vote_average.desc", ...qualityFloorParams("curated", "tv") },
      title: "Top Rated & Legendary Series",
      subtitle: "Highest rated television series of all time",
    },
    {
      mediaType: "tv",
      source: "tv-popular",
      params: {},
      title: "Top 10 Shows Today",
      subtitle: "The most-watched series right now",
      isTop10: true,
    },
    {
      mediaType: "tv",
      source: "trending-tv",
      params: {},
      title: "Trending Series Right Now",
      subtitle: "The shows everyone is talking about this week",
    },
  ]
}

// ── Generated genre facets (Popular / Top Rated / New × genre × media) ──

type GenreFacetKind = "popular" | "top-rated" | "new"

function genreFacetTitle(kind: GenreFacetKind, genre: GenreDef, mediaType: "movie" | "tv"): string {
  const noun = mediaType === "movie" ? "Movies" : "Series"
  switch (kind) {
    case "popular":
      return `Popular ${genre.name} ${noun}`
    case "top-rated":
      return `Top Rated ${genre.name} ${mediaType === "movie" ? "Masterpieces" : "Series"}`
    case "new":
      return `New & Recent ${genre.name} ${noun}`
  }
}

function genreFacetSubtitle(kind: GenreFacetKind, genre: GenreDef): string {
  switch (kind) {
    case "popular":
      return `Top trending ${genre.name.toLowerCase()} titles right now`
    case "top-rated":
      return `Highest critically acclaimed ${genre.name.toLowerCase()} titles of all time`
    case "new":
      return `Freshly released ${genre.name.toLowerCase()} titles`
  }
}

function buildGenreFacets(): FacetSpec[] {
  const out: FacetSpec[] = []
  for (const genre of GENRES) {
    for (const mediaType of ["movie", "tv"] as const) {
      const genreIds = mediaType === "movie" ? genre.movieGenreIds : genre.tvGenreIds
      if (genreIds.length === 0) continue
      const extras = getGenreDiscoverParams(genre, mediaType)
      const allowUnscriptedTv = genre.tvGenreIds.some((id) => UNSCRIPTED_TV_GENRE_IDS.includes(id))

      const kinds: GenreFacetKind[] = ["popular", "top-rated", "new"]
      for (const kind of kinds) {
        const params: Record<string, string> = {
          with_genres: genreIds.join("|"),
          ...(extras ?? {}),
        }
        if (kind === "popular") {
          Object.assign(params, qualityFloorParams("browse", mediaType), { sort_by: "popularity.desc" })
          if (mediaType === "movie") params["with_runtime.gte"] = "20"
        } else if (kind === "top-rated") {
          Object.assign(params, qualityFloorParams("curated", mediaType), { sort_by: "vote_average.desc" })
          if (mediaType === "movie") params["with_runtime.gte"] = "30"
        } else {
          Object.assign(params, qualityFloorParams("fresh", mediaType), {
            sort_by: mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc",
          })
          const key = mediaType === "movie" ? "primary_release_date" : "first_air_date"
          params[`${key}.lte`] = today()
        }
        out.push({
          mediaType,
          params,
          title: genreFacetTitle(kind, genre, mediaType),
          subtitle: genreFacetSubtitle(kind, genre),
          ...(allowUnscriptedTv ? { allowUnscriptedTv: true } : {}),
          genreSlug: genre.slug,
          genreDiscoverParams: extras,
        })
      }
    }
  }
  return out
}

// ── Network / studio / language rails (R2-4 / §7.4, §7.7) ──

function specialityFacets(): FacetSpec[] {
  const today = new Date().toISOString().split("T")[0]
  const weekAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  return [
    {
      mediaType: "tv",
      params: { sort_by: "popularity.desc", with_networks: "49", ...qualityFloorParams("browse", "tv") },
      title: "HBO Series",
      subtitle: "Prestige television from HBO",
    },
    {
      mediaType: "tv",
      params: { sort_by: "popularity.desc", with_networks: "213", ...qualityFloorParams("browse", "tv") },
      title: "Netflix Originals",
      subtitle: "Series made by Netflix",
    },
    {
      mediaType: "tv",
      params: { sort_by: "popularity.desc", with_networks: "2552", ...qualityFloorParams("browse", "tv") },
      title: "Apple TV+ Series",
      subtitle: "Award-winning Apple originals",
    },
    {
      mediaType: "movie",
      params: { sort_by: "popularity.desc", with_companies: "10342", ...qualityFloorParams("browse", "movie") },
      title: "Studio Ghibli",
      subtitle: "The beloved films of Studio Ghibli",
    },
    // §1.9/§7.7: language rails accept titles without an English overview —
    // the missing blurb demotes in ranking instead of deleting the item.
    {
      mediaType: "tv",
      params: {
        sort_by: "popularity.desc",
        with_original_language: "ko",
        ...qualityFloorParams("browse", "tv"),
      },
      title: "K-Dramas",
      subtitle: "The Korean dramas everyone is talking about",
      allowMissingOverview: true,
    },
    {
      mediaType: "tv",
      params: {
        sort_by: "popularity.desc",
        with_original_language: "ja",
        with_genres: "16",
        ...qualityFloorParams("browse", "tv"),
      },
      title: "Anime Series",
      subtitle: "Japanese animation favourites",
      allowUnscriptedTv: true,
      allowMissingOverview: true,
    },
    {
      mediaType: "movie",
      params: {
        sort_by: "popularity.desc",
        with_original_language: "hi",
        ...qualityFloorParams("browse", "movie"),
      },
      title: "Bollywood",
      subtitle: "The biggest films out of India",
      allowMissingOverview: true,
    },
    // §7.5: collection/franchise rails — /collection/{id} parts in release order.
    {
      mediaType: "movie",
      source: "collection:10",
      params: {},
      title: "Star Wars — The Complete Saga",
      subtitle: "Every theatrical film, in release order",
    },
    {
      mediaType: "movie",
      source: "collection:119",
      params: {},
      title: "The Lord of the Rings & The Hobbit",
      subtitle: "Middle-earth, in release order",
    },
    {
      mediaType: "movie",
      source: "collection:1241",
      params: {},
      title: "Harry Potter — All Films",
      subtitle: "The Wizarding World saga, in release order",
    },
    {
      mediaType: "movie",
      source: "collection:263",
      params: {},
      title: "The Dark Knight Trilogy",
      subtitle: "Christopher Nolan's Gotham, in release order",
    },
    // §7.8: Coming Soon — the theatrical/future window becomes a deliberate
    // opt-in rail instead of being silently excluded everywhere else.
    {
      mediaType: "movie",
      params: {
        sort_by: "popularity.desc",
        "primary_release_date.gte": today,
        "primary_release_date.lte": new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        // Upcoming titles carry neither ratings nor votes yet (even the
        // biggest films sit at vc=0 until release) — quality here is
        // attention: a popularity floor only.
        "popularity.gte": "3",
      },
      title: "Coming Soon & In Theaters",
      subtitle: "Upcoming releases heading to cinemas and streaming",
      includeFutureReleases: true,
    },
    // §7.10: scheduled content velocity — new episodes airing this week.
    {
      mediaType: "tv",
      params: {
        sort_by: "popularity.desc",
        "air_date.gte": today,
        "air_date.lte": weekAhead,
        ...qualityFloorParams("fresh", "tv"),
      },
      title: "New Episodes Airing This Week",
      subtitle: "Series with fresh episodes in the next seven days",
    },
    // Opt-in daily/unscripted rail (§1.6): Reality|Soap|Talk|News.
    {
      mediaType: "tv",
      params: {
        sort_by: "popularity.desc",
        with_genres: UNSCRIPTED_TV_GENRE_IDS.join("|"),
        ...qualityFloorParams("browse", "tv"),
      },
      title: "Reality, Talk & Daily Dramas",
      subtitle: "Unscripted series and daily favourites",
      allowUnscriptedTv: true,
    },
  ]
}

function buildRegistry(): Record<string, FacetSpec> {
  const registry: Record<string, FacetSpec> = {}

  // Keep the legacy keys stable so existing pages/links keep working, and
  // give speciality rails stable slugs independent of their display titles.
  const legacyKeys: Record<string, string> = {
    "Recently Released Movies": "recently-released-movies",
    "Popular Movies": "popular-movies",
    "Top Rated Classics & Masterpieces": "top-rated-movies",
    "Top 10 Movies Today": "top-10-movies",
    "Trending Movies Right Now": "trending-movies",
    "Currently Airing & On The Air": "on-the-air-shows",
    "Popular TV Shows": "popular-shows",
    "Top Rated & Legendary Series": "top-rated-shows",
    "Top 10 Shows Today": "top-10-shows",
    "Trending Series Right Now": "trending-shows",
    "New Episodes Airing This Week": "airing-this-week",
    "Coming Soon & In Theaters": "coming-soon",
    "Star Wars — The Complete Saga": "star-wars-saga",
    "The Lord of the Rings & The Hobbit": "middle-earth",
    "Harry Potter — All Films": "harry-potter",
    "The Dark Knight Trilogy": "dark-knight-trilogy",
  }
  for (const spec of coreFacets()) {
    const key = legacyKeys[spec.title] ?? slugifyFacetTitle(spec.title)
    registry[key] = spec
  }

  for (const spec of buildGenreFacets()) {
    const kind = spec.title.startsWith("Popular ")
      ? "popular"
      : spec.title.startsWith("Top Rated ")
        ? "top-rated"
        : "new"
    registry[`genre-${spec.genreSlug}-${spec.mediaType}-${kind}`] = spec
  }

  for (const spec of specialityFacets()) {
    registry[legacyKeys[spec.title] ?? slugifyFacetTitle(spec.title)] = spec
  }

  return registry
}

function slugifyFacetTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

export const FACET_REGISTRY: Record<string, FacetSpec> = buildRegistry()

/** Ordered facet keys for a media-type page (cross-genre first, then genre family). */
export function getFacetKeysForMediaType(mediaType: "movie" | "tv"): string[] {
  return Object.entries(FACET_REGISTRY)
    .filter(([, spec]) => spec.mediaType === mediaType && !spec.genreSlug)
    .map(([key]) => key)
}

/** Genre-mode facet family (R1-3): the full family filtered to one genre. */
export function getFacetKeysForGenre(genreSlug: string, mediaType: "movie" | "tv"): string[] {
  return Object.entries(FACET_REGISTRY)
    .filter(([, spec]) => spec.mediaType === mediaType && spec.genreSlug === genreSlug)
    .map(([key]) => key)
}

export function getFacetSpec(facetKey: string): FacetSpec | undefined {
  return FACET_REGISTRY[facetKey]
}

/**
 * Pool + score a facet's items (R1-1 pagination: `page` selects the next
 * 2-TMDB-page bundle from the cached pool).
 */
export async function getFacetScoredItems(
  facetKey: string,
  page = 1
): Promise<{ spec: FacetSpec; items: ScoredRowItem[]; hasMore: boolean } | null> {
  const spec = FACET_REGISTRY[facetKey]
  if (!spec) return null

  const bundlePages = 2
  const safePage = Math.max(1, Math.floor(page))
  let catalogItems
  if (spec.source) {
    catalogItems = await safeCuratedList(spec.source, safePage)
  } else {
    catalogItems = await safeDiscoverPages(spec.mediaType, spec.params, bundlePages, {
      startPage: (safePage - 1) * bundlePages + 1,
      allowUnscriptedTv: spec.allowUnscriptedTv,
      allowMissingOverview: spec.allowMissingOverview,
      includeFutureReleases: spec.includeFutureReleases,
    })
  }

  const items = toScoredItems(catalogItems, spec.mediaType)
  const offset = (safePage - 1) * 20
  return {
    spec,
    items: items.slice(offset, offset + 20),
    hasMore: items.length > offset + 20 || catalogItems.length >= bundlePages * 20,
  }
}
