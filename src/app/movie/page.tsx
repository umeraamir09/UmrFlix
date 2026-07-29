import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { GenreFilterBar } from "@/components/GenreFilterBar"
import { getTrending, getItemLogo, discoverMovies } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { generateRecommendations } from "@/lib/recommendations"

export const revalidate = 1800 // Revalidate page every 30 minutes

const MOVIE_GENRES = [
  { name: "Action", id: 28 },
  { name: "Adventure", id: 12 },
  { name: "Animation", id: 16 },
  { name: "Comedy", id: 35 },
  { name: "Crime", id: 80 },
  { name: "Documentary", id: 99 },
  { name: "Drama", id: 18 },
  { name: "Family", id: 10751 },
  { name: "Fantasy", id: 14 },
  { name: "Horror", id: 27 },
  { name: "Mystery", id: 9648 },
  { name: "Romance", id: 10749 },
  { name: "Sci-Fi", id: 878 },
  { name: "Thriller", id: 53 },
]

export default async function MovieCatalogPage({
  searchParams,
}: {
  searchParams?: Promise<{ genre?: string }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const rawGenre = resolvedSearchParams.genre
  const decodedGenre = rawGenre ? decodeURIComponent(rawGenre) : undefined

  const selectedGenre = decodedGenre
    ? MOVIE_GENRES.find(
        (g) =>
          g.name.toLowerCase() === decodedGenre.toLowerCase() ||
          String(g.id) === decodedGenre
      )
    : null

  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null
  let forYouItems: any[] = []

  try {
    if (selectedGenre) {
      // Fetch genre-specific movies
      const genreMovieData = await discoverMovies({
        with_genres: String(selectedGenre.id),
        sort_by: "popularity.desc",
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

      // 2. Fetch personalized movie recommendations based on Jellyfin watch history
      const recommendations = await generateRecommendations("default", {
        limit: 20,
        mediaType: "movie",
      })

      forYouItems = recommendations.map((rec: any) => ({
        id: rec.tmdbId,
        title: rec.title,
        name: rec.name,
        poster_path: rec.poster_path,
        backdrop_path: rec.backdrop_path,
        overview: rec.overview,
        release_date: rec.release_date,
        first_air_date: rec.first_air_date,
        vote_average: rec.vote_average,
        media_type: "movie",
      }))

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
          </div>
          <GenreFilterBar
            genres={MOVIE_GENRES}
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
              endpoint={`/api/tmdb/discover/movie?with_genres=${selectedGenre.id}&sort_by=popularity.desc`}
            />

            {/* Top Rated Genre Movies */}
            <MovieRow
              title={`Top Rated ${selectedGenre.name} Masterpieces`}
              subtitle={`Highest critically acclaimed ${selectedGenre.name.toLowerCase()} movies of all time`}
              type="movie"
              endpoint={`/api/tmdb/discover/movie?with_genres=${selectedGenre.id}&sort_by=vote_average.desc&vote_count.gte=100`}
            />

            {/* Mid-page Spotlight Banner */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* New & Recent Genre Releases */}
            <MovieRow
              title={`New & Recent ${selectedGenre.name} Releases`}
              subtitle={`Freshly released ${selectedGenre.name.toLowerCase()} movies`}
              type="movie"
              endpoint={`/api/tmdb/discover/movie?with_genres=${selectedGenre.id}&sort_by=primary_release_date.desc`}
            />
          </>
        ) : (
          <>
            {/* Personalized Recommendations */}
            {forYouItems.length > 0 && (
              <MovieRow
                title="Recommended Movies For You"
                subtitle="Based on films you watch on Jellyfin"
                type="movie"
                customItems={forYouItems}
              />
            )}

            {/* Now Playing / Fresh Releases */}
            <MovieRow
              title="Now Playing & In Theaters"
              subtitle="New releases hitting screens right now"
              type="movie"
              endpoint="/api/tmdb/movie/now_playing"
            />

            {/* Popular Movies */}
            <MovieRow
              title="Popular Movies"
              subtitle="Top trending movies everyone is watching"
              type="movie"
              endpoint="/api/tmdb/trending/movie/week"
            />

            {/* Mid-page Spotlight Banner 1 */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* Top Rated Classics */}
            <MovieRow
              title="Top Rated Classics & Masterpieces"
              subtitle="Highest critically acclaimed movies of all time"
              type="movie"
              endpoint="/api/tmdb/movie/top_rated"
            />

            {/* Action & Adventure */}
            <MovieRow
              title="Action & Adventure"
              subtitle="High-octane blockbusters and thrilling journeys"
              type="movie"
              endpoint="/api/tmdb/discover/movie?with_genres=28,12&sort_by=popularity.desc"
            />

            {/* Sci-Fi & Fantasy */}
            <MovieRow
              title="Sci-Fi & Fantasy"
              subtitle="Explore alien worlds, future realms, and magic"
              type="movie"
              endpoint="/api/tmdb/discover/movie?with_genres=878,14&sort_by=popularity.desc"
            />

            {/* Mid-page Spotlight Banner 2 */}
            {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

            {/* Comedy Hits */}
            <MovieRow
              title="Comedy Hits"
              subtitle="Laugh-out-loud comedies and feel-good movies"
              type="movie"
              endpoint="/api/tmdb/discover/movie?with_genres=35&sort_by=popularity.desc"
            />

            {/* Horror & Suspense Thrillers */}
            <MovieRow
              title="Horror & Suspense Thrillers"
              subtitle="Pulse-pounding chills and psychological mysteries"
              type="movie"
              endpoint="/api/tmdb/discover/movie?with_genres=27,53&sort_by=popularity.desc"
            />
          </>
        )}
      </div>
    </div>
  )
}
