import type { Metadata } from "next"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { TopGenreSelector } from "@/components/TopGenreSelector"
import { getTrending, getItemLogo, discoverTv, type TmdbTvShow, type TmdbPaginated } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { getNextEpisode, getAiringLabel, lookupShowByTvdbId } from "@/lib/tvmaze"
import { authenticate, getAllItems } from "@/lib/jellyfin"
import { getGenreByParam, getTvGenres, getGenreDiscoverParams, buildGenreDiscoverQuery } from "@/lib/genres"

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
      // Fetch genre-specific TV shows
      const genreTvData = await discoverTv({
        with_genres: String(selectedGenreIds),
        sort_by: "popularity.desc",
        ...getGenreDiscoverParams(selectedGenre, "tv"),
      })
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
      // 1. Fetch trending TV shows
      const trendingTvData = (await getTrending("tv", "week")) as TmdbPaginated<TmdbTvShow>
      const tvResults = filterReleasedContent(trendingTvData?.results || [])

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
            {/* Popular Genre TV Shows */}
            <MovieRow
              title={`Popular ${selectedGenre.name} Series`}
              subtitle={`Top trending ${selectedGenre.name.toLowerCase()} shows right now`}
              type="tv"
              endpoint={`/api/tmdb/discover/tv?${buildGenreDiscoverQuery(selectedGenre, "tv", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "popularity.desc",
                "vote_count.gte": "10",
                "popularity.gte": "1.5",
              })}`}
            />

            {/* Top Rated Genre TV Shows */}
            <MovieRow
              title={`Top Rated ${selectedGenre.name} Series`}
              subtitle={`Highest rated ${selectedGenre.name.toLowerCase()} series of all time`}
              type="tv"
              endpoint={`/api/tmdb/discover/tv?${buildGenreDiscoverQuery(selectedGenre, "tv", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "vote_average.desc",
                "vote_count.gte": "150",
                "popularity.gte": "3.0",
              })}`}
            />

            {/* Mid-page Spotlight Banner */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* New & Recently Airing Genre TV Shows */}
            <MovieRow
              title={`New & Recently Airing ${selectedGenre.name}`}
              subtitle={`Freshly aired ${selectedGenre.name.toLowerCase()} television series`}
              type="tv"
              endpoint={`/api/tmdb/discover/tv?${buildGenreDiscoverQuery(selectedGenre, "tv", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "first_air_date.desc",
                "vote_count.gte": "3",
                "popularity.gte": "2.0",
              })}`}
            />
          </>
        ) : (
          <>
            {/* Personalized Discovery Rows (Top Picks, micro-genres, BYW) */}
            <PersonalizedFeed mediaType="tv" />

            {/* On The Air & Currently Airing */}
            <MovieRow
              title="Currently Airing & On The Air"
              subtitle="Series actively broadcasting new episodes right now"
              type="tv"
              endpoint="/api/discovery/row?facet=on-the-air-shows"
            />

            {/* Popular TV Shows */}
            <MovieRow
              title="Popular TV Shows"
              subtitle="Top trending series this week"
              type="tv"
              endpoint="/api/discovery/row?facet=popular-shows"
            />

            {/* Mid-page Spotlight Banner 1 */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* Top Rated Series */}
            <MovieRow
              title="Top Rated & Legendary Series"
              subtitle="Highest rated television series of all time"
              type="tv"
              endpoint="/api/discovery/row?facet=top-rated-shows"
            />

            {/* Sci-Fi & Fantasy Series */}
            <MovieRow
              title="Sci-Fi & Fantasy Series"
              subtitle="Mind-bending adventures, dystopian futures, and magic"
              type="tv"
              endpoint="/api/discovery/row?facet=sci-fi-fantasy-shows"
            />

            {/* Crime & Mystery Thrillers */}
            <MovieRow
              title="Crime & Mystery Thrillers"
              subtitle="Detective procedurals, dark secrets, and criminal underworlds"
              type="tv"
              endpoint="/api/discovery/row?facet=crime-mystery-shows"
            />

            {/* Mid-page Spotlight Banner 2 */}
            {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

            {/* Binge-Worthy Comedies */}
            <MovieRow
              title="Bingeable Comedies"
              subtitle="Sitcoms and comedy series to brighten your day"
              type="tv"
              endpoint="/api/discovery/row?facet=comedy-shows"
            />

            {/* Animation & Anime */}
            <MovieRow
              title="Animation & Anime Series"
              subtitle="Top-rated animated series and anime shows"
              type="tv"
              endpoint="/api/discovery/row?facet=animation-shows"
            />
          </>
        )}
      </div>
    </div>
  )
}
