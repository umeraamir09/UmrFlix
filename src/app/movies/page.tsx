import Link from "next/link"
import type { Metadata } from "next"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { TopGenreSelector } from "@/components/TopGenreSelector"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { getTrending, getItemLogo, discoverMovies, type TmdbMovie, type TmdbPaginated } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { getGenreByParam, getMovieGenres, getGenreDiscoverParams, buildGenreDiscoverQuery } from "@/lib/genres"

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
      title: `${selectedGenre.name} Movies — Browse & Stream | UmrFlix`,
      description: `Explore top trending, highest rated, and newly released ${selectedGenre.name} movies on UmrFlix.`,
    }
  }

  return {
    title: "Movies — Blockbusters, Classics & Trending Films | UmrFlix",
    description: "Explore blockbuster films, personalized picks, timeless classics, and genre favorites on UmrFlix.",
  }
}

export default async function MoviesCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<{ genre?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const rawGenre = resolvedSearchParams.genre
  const decodedGenre = rawGenre ? decodeURIComponent(rawGenre) : undefined

  const selectedGenre = decodedGenre ? getGenreByParam(decodedGenre) : null
  const selectedGenreIds = selectedGenre ? selectedGenre.movieGenreIds.join(",") : null

  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null

  try {
    if (selectedGenre) {
      // Fetch genre-specific movies
      const genreMovieData = await discoverMovies({
        with_genres: String(selectedGenreIds),
        sort_by: "popularity.desc",
        ...getGenreDiscoverParams(selectedGenre, "movie"),
      })
      const movieResults = filterReleasedContent(genreMovieData?.results || [])

      const rawHero = movieResults.slice(0, 5)
      heroItems = await Promise.all(
        rawHero.map(async (item: TmdbMovie) => {
          const logo_path = await getItemLogo("movie", item.id)
          return {
            id: item.id,
            title: item.title || "Untitled Movie",
            overview: item.overview || "",
            backdrop_path: item.backdrop_path,
            poster_path: item.poster_path,
            media_type: "movie" as const,
            vote_average: item.vote_average,
            release_date: item.release_date,
            logo_path: logo_path,
          }
        })
      )

      if (movieResults.length > 5) {
        const sp1 = movieResults[5]
        spotlightItem1 = {
          id: sp1.id,
          title: sp1.title || "",
          overview: sp1.overview || "",
          backdrop_path: sp1.backdrop_path,
          media_type: "movie",
        }
      }
    } else {
      // 1. Fetch trending movies
      const trendingMovieData = (await getTrending("movie", "week")) as TmdbPaginated<TmdbMovie>
      const movieResults = filterReleasedContent(trendingMovieData?.results || [])

      // 2. Build hero billboard items
      const rawHero = movieResults.slice(0, 5)
      heroItems = await Promise.all(
        rawHero.map(async (item: TmdbMovie) => {
          const logo_path = await getItemLogo("movie", item.id)
          return {
            id: item.id,
            title: item.title || "Untitled Movie",
            overview: item.overview || "",
            backdrop_path: item.backdrop_path,
            poster_path: item.poster_path,
            media_type: "movie" as const,
            vote_average: item.vote_average,
            release_date: item.release_date,
            logo_path: logo_path,
          }
        })
      )

      // 3. Build spotlight banners
      if (movieResults.length > 5) {
        const sp1 = movieResults[5]
        spotlightItem1 = {
          id: sp1.id,
          title: sp1.title || "",
          overview: sp1.overview || "",
          backdrop_path: sp1.backdrop_path,
          media_type: "movie",
        }
      }

      if (movieResults.length > 8) {
        const sp2 = movieResults[8]
        spotlightItem2 = {
          id: sp2.id,
          title: sp2.title || "",
          overview: sp2.overview || "",
          backdrop_path: sp2.backdrop_path,
          media_type: "movie",
        }
      }
    }
  } catch (err) {
    console.error("Failed to load Movie Catalog Page data:", err)
  }

  const headerOverlay = (
    <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
      <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white drop-shadow-md">
        {selectedGenre ? `${selectedGenre.name} Movies` : "Movies"}
      </h1>
      <TopGenreSelector
        genres={getMovieGenres()}
        mediaType="movie"
        activeGenre={selectedGenre?.name}
        basePath="/movies"
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
            {/* Popular Genre Movies */}
            <MovieRow
              title={`Popular ${selectedGenre.name} Movies`}
              subtitle={`Top trending ${selectedGenre.name.toLowerCase()} films right now`}
              type="movie"
              endpoint={`/api/tmdb/discover/movie?${buildGenreDiscoverQuery(selectedGenre, "movie", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "popularity.desc",
                "vote_count.gte": "20",
                "popularity.gte": "1.5",
                "with_runtime.gte": "20",
              })}`}
            />

            {/* Top Rated Genre Movies */}
            <MovieRow
              title={`Top Rated ${selectedGenre.name} Masterpieces`}
              subtitle={`Highest critically acclaimed ${selectedGenre.name.toLowerCase()} movies of all time`}
              type="movie"
              endpoint={`/api/tmdb/discover/movie?${buildGenreDiscoverQuery(selectedGenre, "movie", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "vote_average.desc",
                "vote_count.gte": "300",
                "popularity.gte": "3.0",
                "with_runtime.gte": "30",
              })}`}
            />

            {/* Mid-page Spotlight Banner */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* New & Recent Genre Releases */}
            <MovieRow
              title={`New & Recent ${selectedGenre.name} Releases`}
              subtitle={`Freshly released ${selectedGenre.name.toLowerCase()} movies`}
              type="movie"
              endpoint={`/api/tmdb/discover/movie?${buildGenreDiscoverQuery(selectedGenre, "movie", {
                with_genres: selectedGenreIds ?? "",
                sort_by: "primary_release_date.desc",
                "vote_count.gte": "5",
                "popularity.gte": "2.0",
                "with_runtime.gte": "20",
              })}`}
            />
          </>
        ) : (
          <>
            {/* Personalized Discovery Rows (Top Picks, micro-genres, BYW) */}
            <PersonalizedFeed mediaType="movie" />

            {/* Recently Released Movies */}
            <MovieRow
              title="Recently Released Movies"
              subtitle="Freshly released movies available for streaming"
              type="movie"
              endpoint="/api/discovery/row?facet=recently-released-movies"
            />

            {/* Popular Movies */}
            <MovieRow
              title="Popular Movies"
              subtitle="Top trending movies everyone is watching"
              type="movie"
              endpoint="/api/discovery/row?facet=popular-movies"
            />

            {/* Mid-page Spotlight Banner 1 */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* Top Rated Classics */}
            <MovieRow
              title="Top Rated Classics & Masterpieces"
              subtitle="Highest critically acclaimed movies of all time"
              type="movie"
              endpoint="/api/discovery/row?facet=top-rated-movies"
            />

            {/* Action & Adventure */}
            <MovieRow
              title="Action & Adventure"
              subtitle="High-octane blockbusters and thrilling journeys"
              type="movie"
              endpoint="/api/discovery/row?facet=action-adventure-movies"
            />

            {/* Sci-Fi & Fantasy */}
            <MovieRow
              title="Sci-Fi & Fantasy"
              subtitle="Explore alien worlds, future realms, and magic"
              type="movie"
              endpoint="/api/discovery/row?facet=sci-fi-fantasy-movies"
            />

            {/* Mid-page Spotlight Banner 2 */}
            {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

            {/* Comedy Hits */}
            <MovieRow
              title="Comedy Hits"
              subtitle="Laugh-out-loud comedies and feel-good movies"
              type="movie"
              endpoint="/api/discovery/row?facet=comedy-movies"
            />

            {/* Horror & Suspense Thrillers */}
            <MovieRow
              title="Horror & Suspense Thrillers"
              subtitle="Pulse-pounding chills and psychological mysteries"
              type="movie"
              endpoint="/api/discovery/row?facet=horror-thriller-movies"
            />
          </>
        )}
      </div>
    </div>
  )
}

