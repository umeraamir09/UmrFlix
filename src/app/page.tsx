import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { ContinueWatchingSection } from "@/components/ContinueWatchingSection"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { getTrending, getItemLogo } from "@/lib/tmdb"

export const revalidate = 3600 // Revalidate home page every hour

export default async function HomePage() {
  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null

  try {
    const trendingTvData = await getTrending("tv", "week")
    const trendingMovieData = await getTrending("movie", "week")

    const tvResults = trendingTvData?.results || []
    const movieResults = trendingMovieData?.results || []

    const rawHero = [...tvResults.slice(0, 3), ...movieResults.slice(0, 2)]
    heroItems = await Promise.all(
      rawHero.map(async (item: any) => {
        const type: "movie" | "tv" = item.title ? "movie" : "tv"
        const logo_path = await getItemLogo(type, item.id)
        return {
          id: item.id,
          title: item.title || item.name || "Untitled",
          overview: item.overview || "",
          backdrop_path: item.backdrop_path,
          poster_path: item.poster_path,
          media_type: type,
          vote_average: item.vote_average,
          release_date: item.release_date || item.first_air_date,
          logo_path: logo_path,
        }
      })
    )

    if (tvResults.length > 3) {
      const sp: any = tvResults[3]
      spotlightItem1 = {
        id: sp.id,
        title: sp.name || sp.title || "",
        overview: sp.overview || "",
        backdrop_path: sp.backdrop_path,
        media_type: "tv",
      }
    }

    if (movieResults.length > 3) {
      const sp2: any = movieResults[3]
      spotlightItem2 = {
        id: sp2.id,
        title: sp2.title || sp2.name || "",
        overview: sp2.overview || "",
        backdrop_path: sp2.backdrop_path,
        media_type: "movie",
      }
    }
  } catch (err) {
    console.error("Failed to load TMDB homepage data:", err)
  }

  return (
    <div className="space-y-10 pb-16">
      {/* 1. Hero Spotlight Carousel */}
      {heroItems.length > 0 && <HeroBillboard items={heroItems} />}

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44">
        {/* 2. Most Popular Row (Overlapping the Hero Billboard backdrop like Crunchyroll) */}
        <MovieRow
          title="Most Popular"
          subtitle="Top trending titles this week"
          type="tv"
          endpoint="/api/tmdb/trending/tv/week"
        />

        {/* 3. Continue Watching – fetched live from Jellyfin, hidden when empty */}
        <ContinueWatchingSection />

        {/* 4. Inspired by You Row */}
        <MovieRow
          title="Inspired by You"
          subtitle="Based on your recent watch history"
          type="movie"
          endpoint="/api/tmdb/trending/movie/week"
        />

        {/* 5. Mid-Page Featured Spotlight Banner 1 */}
        {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

        {/* 6. Top Picks for You Row */}
        <MovieRow
          title="Top Picks for You"
          subtitle="Recommended for your next binge"
          type="tv"
          endpoint="/api/tmdb/trending/tv/day"
        />

        {/* 7. Trending Movies from Current Season */}
        <MovieRow
          title="Blockbuster Movies"
          subtitle="Popular films available in your catalog"
          type="movie"
          endpoint="/api/tmdb/trending/movie/day"
        />

        {/* 8. Mid-Page Featured Spotlight Banner 2 */}
        {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}
      </div>
    </div>
  )
}
