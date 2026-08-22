import type { Metadata } from "next"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { TopGenreSelector } from "@/components/TopGenreSelector"
import { FacetRails } from "@/components/FacetRails"
import { getTrending, getItemLogo, discoverTv, type TmdbTvShow } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { withQualityFloors } from "@/lib/catalog-quality"
import { curateTrending, scriptedTvParams } from "@/lib/content-policy"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { getNextEpisode, getAiringLabel, lookupShowByTvdbId } from "@/lib/tvmaze"
import { authenticate, getAllItems } from "@/lib/jellyfin"
import { getGenreByParam, getTvGenres, getGenreDiscoverParams } from "@/lib/genres"
import { getFacetKeysForGenre } from "@/lib/discovery/facets"

export const revalidate = 1800 // Revalidate page every 30 minutes

export async function generateMetadata({
  searchParams,
}: {
  searchParams?: Promise<{ genre?: string }>
}): Promise<Metadata> {
  const resolved = searchParams ? await searchParams : {}
  const rawGenre = resolved.genre ? decodeURIComponent(resolved.genre) : undefined
  const selectedGenre = rawGenre ? getGenreByParam(rawGenre) : null

  if (selectedGenre) {
    return {
      title: `${selectedGenre.name} TV Shows & Series — Browse & Stream | UmrFlix`,
      description: `Discover top trending, highest rated, and newly airing ${selectedGenre.name} television series on UmrFlix.`,
    }
  }

  return {
    title: "TV Shows & Series — Trending, Airing & Legendary Shows | UmrFlix",
    description: "Discover trending shows, personalized recommendations, airing episodes, and binge-worthy series on UmrFlix.",
  }
}

interface JellyfinApiItem {
  Id: string
  Name: string
  Type: string
  ProviderIds?: {
    Tmdb?: string
    Tvdb?: string
    Imdb?: string
  }
}

export default async function TvShowCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<{ genre?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const rawGenre = resolvedSearchParams.genre
  const decodedGenre = rawGenre ? decodeURIComponent(rawGenre) : undefined

  const selectedGenre = decodedGenre ? getGenreByParam(decodedGenre) : null
  const selectedGenreIds = selectedGenre ? selectedGenre.tvGenreIds.join(",") : null

  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null
  const airingMap: Record<number, string> = {}

  try {
    if (selectedGenre) {
      // Fetch genre-specific TV shows (R0-2 browse floors; genre facets like
      // reality/soap keep their unscripted content via the facet registry's
      // allowUnscriptedTv flag, the hero pool stays scripted-biased).
      const unscriptedGenre = [10762, 10763, 10764, 10766, 10767].some((id) =>
        selectedGenre.tvGenreIds.includes(id)
      )
      const genreTvData = await discoverTv(
        withQualityFloors(
          {
            with_genres: String(selectedGenreIds),
            sort_by: "popularity.desc",
            ...getGenreDiscoverParams(selectedGenre, "tv"),
            ...(unscriptedGenre ? {} : scriptedTvParams()),
          },
          "browse",
          "tv"
        )
      )
      const tvResults = filterReleasedContent(genreTvData?.results || [])

      const rawHero = tvResults.slice(0, 5)
      heroItems = await Promise.all(
        rawHero.map(async (item: TmdbTvShow) => {
          const logo_path = await getItemLogo("tv", item.id)
          return {
            id: item.id,
            title: item.name || "Untitled Series",
            overview: item.overview || "",
            backdrop_path: item.backdrop_path,
            poster_path: item.poster_path,
            media_type: "tv" as const,
            vote_average: item.vote_average,
            release_date: item.first_air_date,
            logo_path: logo_path,
            airingLabel: airingMap[item.id],
          }
        })
      )

      if (tvResults.length > 5) {
        const sp1 = tvResults[5]
        spotlightItem1 = {
          id: sp1.id,
          title: sp1.name || "",
          overview: sp1.overview || "",
          backdrop_path: sp1.backdrop_path,
          media_type: "tv",
        }
      }
    } else {
      // 1. Fetch trending TV shows (§1.7 curated: quality + suitability)
      const trendingTvData = await getTrending("tv", "week")
      const tvResults: TmdbTvShow[] = filterReleasedContent(
        curateTrending(
          (trendingTvData?.results || []).map((item) => ({
            id: item.id,
            popularity: item.popularity,
            voteAverage: item.vote_average,
            voteCount: item.vote_count,
            adult: (item as { adult?: boolean }).adult ?? undefined,
            name: (item as TmdbTvShow).name,
            posterPath: item.poster_path,
            backdropPath: item.backdrop_path,
            raw: item as TmdbTvShow,
          }))
        ).map((e) => e.raw)
      )

      // 2. Fetch Jellyfin series for TVMaze airing schedule badges
      try {
        const { token } = await authenticate()
        const allItems = await getAllItems(token, token)
        const jellyfinSeries = allItems.filter((i: JellyfinApiItem) => i.Type === "Series")

        if (jellyfinSeries.length > 0) {
          const seriesToCheck = jellyfinSeries.slice(0, 10)
          const airingPromises = seriesToCheck.map(async (series) => {
            const tvdbId = series.ProviderIds?.Tvdb ? parseInt(series.ProviderIds.Tvdb) : null
            if (!tvdbId) return

            const show = await lookupShowByTvdbId(tvdbId)
            if (show) {
              const nextEp = await getNextEpisode(show.id)
              const label = getAiringLabel(show, nextEp ?? undefined)
              const tmdbId = series.ProviderIds?.Tmdb ? parseInt(series.ProviderIds.Tmdb) : null
              if (tmdbId && label) {
                airingMap[tmdbId] = label
              }
            }
          })
          await Promise.all(airingPromises)
        }
      } catch {
        console.log("Jellyfin not reachable, skipping airing schedule labels")
      }

      // 3. Personalized TV rows are client-fetched per session via
      //    <PersonalizedFeed mediaType="tv" /> (discovery engine).

      // 4. Build hero billboard items
      const rawHero = tvResults.slice(0, 5)
      heroItems = await Promise.all(
        rawHero.map(async (item: TmdbTvShow) => {
          const logo_path = await getItemLogo("tv", item.id)
          return {
            id: item.id,
            title: item.name || "Untitled Series",
            overview: item.overview || "",
            backdrop_path: item.backdrop_path,
            poster_path: item.poster_path,
            media_type: "tv" as const,
            vote_average: item.vote_average,
            release_date: item.first_air_date,
            logo_path: logo_path,
            airingLabel: airingMap[item.id],
          }
        })
      )

      // 5. Build spotlight banners
      if (tvResults.length > 5) {
        const sp1 = tvResults[5]
        spotlightItem1 = {
          id: sp1.id,
          title: sp1.name || "",
          overview: sp1.overview || "",
          backdrop_path: sp1.backdrop_path,
          media_type: "tv",
        }
      }

      if (tvResults.length > 8) {
        const sp2 = tvResults[8]
        spotlightItem2 = {
          id: sp2.id,
          title: sp2.name || "",
          overview: sp2.overview || "",
          backdrop_path: sp2.backdrop_path,
          media_type: "tv",
        }
      }
    }
  } catch (err) {
    console.error("Failed to load TV Show Catalog Page data:", err)
  }

  const headerOverlay = (
    <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white drop-shadow-md">
        {selectedGenre ? `${selectedGenre.name} Series` : "Series"}
      </h1>
      <TopGenreSelector
        genres={getTvGenres()}
        mediaType="tv"
        activeGenre={selectedGenre?.name}
        basePath="/tvshows"
      />
    </div>
  )

  return (
    <div className="space-y-10 pb-16">
      {/* Hero Billboard with Top Header Overlay */}
      {heroItems.length > 0 && (
        <HeroBillboard items={heroItems} headerOverlay={headerOverlay} />
      )}

      <div className="mx-auto max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44 2xl:-mt-52">
        {selectedGenre ? (
          <>
            {/* R1-3 (§2.3): full facet family filtered to this genre */}
            <FacetRails keys={getFacetKeysForGenre(selectedGenre.slug, "tv")} />
          </>
        ) : (
          <>
            {/* Personalized Discovery Rows (Top Picks, micro-genres, BYW) */}
            <PersonalizedFeed mediaType="tv" />

            {/* Cross-genre facets from the shared registry */}
            <FacetRails
              keys={[
                "on-the-air-shows",
                "top-10-shows",
                "popular-shows",
                "top-rated-shows",
              ]}
            />

            {/* Mid-page Spotlight Banner 1 */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* Genre rails from the data-driven registry */}
            <FacetRails
              keys={[
                "genre-sci-fi-tv-popular",
                "genre-crime-tv-popular",
                "genre-comedy-tv-popular",
                "genre-animation-tv-popular",
                "genre-drama-tv-top-rated",
                "genre-documentary-tv-top-rated",
                "genre-mystery-tv-popular",
                "genre-family-tv-popular",
              ]}
            />

            {/* Mid-page Spotlight Banner 2 */}
            {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

            {/* Specialty rails */}
            <FacetRails keys={["hbo-series", "netflix-originals", "apple-tv-series", "k-dramas", "anime-series"]} />
          </>
        )}
      </div>
    </div>
  )
}
