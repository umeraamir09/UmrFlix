import Link from "next/link"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { GenreFilterBar } from "@/components/GenreFilterBar"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { getTrending, getItemLogo, discoverMovies } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { getGenreByParam, getMovieGenres, getGenreDiscoverParams, buildGenreDiscoverQuery } from "@/lib/genres"

export const revalidate = 1800 // Revalidate page every 30 minutes

export default async function MovieCatalogPage({
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
        rawHero.map(async (item: any) => {
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
        const sp1 = movieResults[5] as any
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
      const trendingMovieData = await getTrending("movie", "week")
      const movieResults = filterReleasedContent(trendingMovieData?.results || [])

      // 2. Personalized movie rows are client-fetched per session via
      //    <PersonalizedFeed mediaType="movie" /> (discovery engine).

      // 3. Build hero billboard items
      const rawHero = movieResults.slice(0, 5)
      heroItems = await Promise.all(
        rawHero.map(async (item: any) => {
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

      // 4. Build spotlight banners
      if (movieResults.length > 5) {
        const sp1 = movieResults[5] as any
        spotlightItem1 = {
          id: sp1.id,
          title: sp1.title || "",
          overview: sp1.overview || "",
          backdrop_path: sp1.backdrop_path,
          media_type: "movie",
        }
      }

      if (movieResults.length > 8) {
        const sp2 = movieResults[8] as any
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

  return (
    <div className="space-y-10 pb-16">
      {/* Hero Billboard */}
      {heroItems.length > 0 && <HeroBillboard items={heroItems} />}

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44">
        {/* Header & Genre Filter Bar */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border/50 pb-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
                {selectedGenre ? `${selectedGenre.name} Movies` : "Movies"}
              </h1>
              <p className="text-sm text-foreground-muted mt-1 font-medium">
                {selectedGenre
                  ? `Explore popular blockbusters, top rated classics, and recent releases in ${selectedGenre.name}.`
                  : "Explore blockbuster films, personalized picks, timeless classics, and genre favorites."}
              </p>
            </div>
            {selectedGenre && (
              <Link
                href={`/genre/${selectedGenre.slug}`}
                className="shrink-0 inline-flex items-center gap-2 rounded-none border border-accent/50 bg-surface px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-all hover:bg-accent hover:border-accent hover:scale-[1.02] active:scale-95"
              >
                Dedicated {selectedGenre.name} Page →
              </Link>
            )}
          </div>
          <GenreFilterBar
            genres={getMovieGenres()}
            mediaType="movie"
            activeGenre={selectedGenre?.name}
          />
        </div>

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
