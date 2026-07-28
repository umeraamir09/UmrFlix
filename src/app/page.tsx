import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { ContinueWatchingSection } from "@/components/ContinueWatchingSection"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { getTrending, getItemLogo } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { generateRecommendations } from "@/lib/recommendations"
import { getNextEpisode, getAiringLabel } from "@/lib/tvmaze"
import { authenticate, getAllItems } from "@/lib/jellyfin"
import { lookupShowByTvdbId } from "@/lib/tvmaze"

// Type for Jellyfin items
interface JellyfinApiItem {
  Id: string
  Name: string
  Type: string
  DateCreated?: string
  DateLastMediaAdded?: string
  ProviderIds?: {
    Tmdb?: string
    Tvdb?: string
    Imdb?: string
  }
}

interface JellyfinSeries extends JellyfinApiItem {
  Type: "Series"
}

export const revalidate = 1800 // Revalidate home page every 30 minutes

export default async function HomePage() {
  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null
  let forYouItems: any[] = []
  let recentlyAddedItems: JellyfinApiItem[] = []
  const airingMap: Record<number, string> = {} // TMDB ID -> airing label

  try {
    // 1. Fetch trending with release filtering
    const trendingTvData = await getTrending("tv", "week")
    const trendingMovieData = await getTrending("movie", "week")

    // Filter released content only
    const tvResults = filterReleasedContent(trendingTvData?.results || [])
    const movieResults = filterReleasedContent(trendingMovieData?.results || [])

    // 2. Get Jellyfin items for badge lookup
    let jellyfinSeries: JellyfinApiItem[] = []
    try {
      const { token } = await authenticate()
      const allItems = await getAllItems(token, token)
      jellyfinSeries = allItems.filter((i: JellyfinApiItem) => i.Type === "Series")
      
      // Recently added from Jellyfin (sorted by DateCreated)
      recentlyAddedItems = allItems
        .filter((item: JellyfinApiItem) => item.DateCreated || item.DateLastMediaAdded)
        .sort((a: JellyfinApiItem, b: JellyfinApiItem) => {
          const dateA = new Date(a.DateCreated || a.DateLastMediaAdded || 0)
          const dateB = new Date(b.DateCreated || b.DateLastMediaAdded || 0)
          return dateB.getTime() - dateA.getTime()
        })
        .slice(0, 10)
    } catch {
      console.log("Jellyfin not available, skipping personalized content")
    }

    // 3. Get TVMaze airing labels for library shows
    if (jellyfinSeries.length > 0) {
      const seriesToCheck = jellyfinSeries.slice(0, 10) as JellyfinSeries[]
      const airingPromises = seriesToCheck.map(async (series) => {
        const tvdbId = series.ProviderIds?.Tvdb ? parseInt(series.ProviderIds.Tvdb) : null
        if (!tvdbId) return
        
        const show = await lookupShowByTvdbId(tvdbId)
        if (show) {
          const nextEp = await getNextEpisode(show.id)
          const label = getAiringLabel(show, nextEp ?? undefined)
          // Map TMDB ID for the series to the airing label
          const tmdbId = series.ProviderIds?.Tmdb ? parseInt(series.ProviderIds.Tmdb) : null
          if (tmdbId && label) {
            airingMap[tmdbId] = label
          }
        }
      })
      
      await Promise.all(airingPromises)
    }

    // 4. Generate personalized recommendations
    const recommendations = await generateRecommendations("default", { limit: 20 })
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
      media_type: rec.media_type,
      airingLabel: rec.media_type === "tv" ? airingMap[rec.tmdbId] : undefined,
    }))

    // 5. Build hero items (filtered)
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
          airingLabel: type === "tv" ? airingMap[item.id] : undefined,
        }
      })
    )

    // 6. Spotlight items
    if (tvResults.length > 3) {
      const sp = tvResults[3] as any
      spotlightItem1 = {
        id: sp.id,
        title: sp.name || sp.title || "",
        overview: sp.overview || "",
        backdrop_path: sp.backdrop_path,
        media_type: "tv",
      }
    }

    if (movieResults.length > 3) {
      const sp2 = movieResults[3] as any
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
        {/* 2. Most Popular Row */}
        <MovieRow
          title="Most Popular"
          subtitle="Top trending titles this week"
          type="tv"
          endpoint="/api/tmdb/trending/tv/week"
        />

        {/* 3. Continue Watching */}
        <ContinueWatchingSection />

        {/* 4. For You Row - AI-powered personalized recommendations */}
        {forYouItems.length > 0 && (
          <MovieRow
            title="For You"
            subtitle="Personalized recommendations based on your viewing"
            type="movie"
            customItems={forYouItems}
          />
        )}

        {/* 5. Mid-Page Featured Spotlight Banner 1 */}
        {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

        {/* 6. Trending Movies from Current Season */}
        <MovieRow
          title="Trending Movies"
          subtitle="Popular films available in your catalog"
          type="movie"
          endpoint="/api/tmdb/trending/movie/day"
        />

        {/* 7. Top Rated Series */}
        <MovieRow
          title="Top Rated"
          subtitle="Highest rated content"
          type="tv"
          endpoint="/api/tmdb/tv/top_rated"
        />

        {/* 8. Recently Added to Your Library */}
        {recentlyAddedItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              Recently Added to your Library
            </h2>
            <p className="text-xs text-gray-400 font-medium">Newly downloaded shows and movies</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 pt-2">
              {recentlyAddedItems.slice(0, 8).map((item: JellyfinApiItem) => {
                const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
                const mediaType = item.Type === "Series" ? "tv" : "movie"
                
                return (
                  <a
                    key={item.Id}
                    href={tmdbId ? `/${mediaType}/${tmdbId}` : "#"}
                    className="block"
                  >
                    <div className="aspect-[2/3] w-full bg-card rounded-none flex items-center justify-center overflow-hidden">
                      {item.ProviderIds?.Tmdb ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w342/poster_path${item.ProviderIds.Tmdb}.jpg`}
                          alt={item.Name}
                          className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <span className="text-gray-500 text-xs text-center px-2">No Poster</span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-white mt-1 truncate">{item.Name}</h3>
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* 9. Mid-Page Featured Spotlight Banner 2 */}
        {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}
      </div>
    </div>
  )
}
