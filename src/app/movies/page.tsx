import type { Metadata } from "next"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { TopGenreSelector } from "@/components/TopGenreSelector"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { FacetRails } from "@/components/FacetRails"
import { getTrending, getItemLogo, discoverMovies, type TmdbMovie } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { withQualityFloors } from "@/lib/catalog-quality"
import { curateTrending } from "@/lib/content-policy"
import { getGenreByParam, getMovieGenres, getGenreDiscoverParams } from "@/lib/genres"
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
      // Fetch genre-specific movies (R0-2: browse floors on the hero pool)
      const genreMovieData = await discoverMovies(
        withQualityFloors(
          {
            with_genres: String(selectedGenreIds),
            sort_by: "popularity.desc",
            ...getGenreDiscoverParams(selectedGenre, "movie"),
          },
          "browse",
          "movie"
        )
      )
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
      // 1. Fetch trending movies (§1.7: curated — quality + suitability)
      const trendingMovieData = await getTrending("movie", "week")
      const movieResults: TmdbMovie[] = filterReleasedContent(
        curateTrending(
          (trendingMovieData?.results || []).map((item) => ({
            id: item.id,
            popularity: item.popularity,
            voteAverage: item.vote_average,
            voteCount: item.vote_count,
            adult: (item as { adult?: boolean }).adult ?? undefined,
            title: (item as TmdbMovie).title,
            posterPath: item.poster_path,
            backdropPath: item.backdrop_path,
            raw: item as TmdbMovie,
          }))
        ).map((e) => e.raw)
      )

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
            {/* R1-3 (§2.3): genre mode renders the full facet family filtered
                to this genre — Popular / Top Rated / New from the shared
                registry — instead of 3 hand-written discover rows. */}
            <FacetRails keys={getFacetKeysForGenre(selectedGenre.slug, "movie")} />
          </>
        ) : (
          <>
            {/* Personalized Discovery Rows (Top Picks, micro-genres, BYW) */}
            <PersonalizedFeed mediaType="movie" />

            {/* Cross-genre facets from the shared registry */}
            <FacetRails
              keys={[
                "recently-released-movies",
                "top-10-movies",
                "popular-movies",
                "top-rated-movies",
              ]}
            />

            {/* Mid-page Spotlight Banner 1 */}
            {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

            {/* Genre rails from the data-driven registry */}
            <FacetRails
              keys={[
                "genre-action-movie-popular",
                "genre-sci-fi-movie-popular",
                "genre-comedy-movie-popular",
                "genre-horror-movie-popular",
                "genre-thriller-movie-popular",
                "genre-drama-movie-top-rated",
                "genre-romance-movie-popular",
                "genre-animation-movie-popular",
                "genre-documentary-movie-top-rated",
                "genre-crime-movie-popular",
              ]}
            />

            {/* Mid-page Spotlight Banner 2 */}
            {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

            {/* Specialty rails */}
            <FacetRails keys={["studio-ghibli", "bollywood"]} />
          </>
        )}
      </div>
    </div>
  )
}

