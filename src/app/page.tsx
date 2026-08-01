import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { ContinueWatchingSection } from "@/components/ContinueWatchingSection"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { getTrending, getItemLogo } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { generateRecommendations, getTmdbRecommendations } from "@/lib/recommendations"
import { getNextEpisode, getAiringLabel, lookupShowByTvdbId } from "@/lib/tvmaze"
import { authenticate, getAllItems, getResumeItems } from "@/lib/jellyfin"

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

// ISR bounds the per-request cost of the homepage's heavy server-side build
// (trending, Jellyfin items, TVMaze lookups, recommendations, hero logos) to at
// most once an hour; the hero rotation (timeSeed) advances with each
// regeneration. All personalized surfaces on the page (Continue Watching and
// the dynamic rows) are client-fetched, so the cached shell stays correct.
export const revalidate = 3600

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.abs(Math.sin(seed + i) * 10000)) % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

const DYNAMIC_CATEGORY_POOL = [
  {
    title: "Action & Thrillers",
    subtitle: "Pulse-pounding blockbusters and suspenseful thrillers",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?with_genres=28,53&sort_by=popularity.desc",
  },
  {
    title: "Sci-Fi & Fantasy Universes",
    subtitle: "Future realms, alien encounters, and epic magic",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?with_genres=878,14&sort_by=popularity.desc",
  },
  {
    title: "Binge-Worthy Series",
    subtitle: "Top-rated television shows and fan-favorite series",
    type: "tv" as const,
    endpoint: "/api/tmdb/tv/top_rated",
  },
  {
    title: "Laugh-Out-Loud Comedies",
    subtitle: "Feel-good comedies and hilarious stories",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?with_genres=35&sort_by=popularity.desc",
  },
  {
    title: "Mind-Bending Mysteries",
    subtitle: "Unravel crime sagas, detective procedurals, and dark secrets",
    type: "tv" as const,
    endpoint: "/api/tmdb/discover/tv?with_genres=80,9648&sort_by=popularity.desc",
  },
  {
    title: "Hidden Gems",
    subtitle: "High rated, under-the-radar masterpieces worth discovering",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?sort_by=vote_average.desc&vote_count.gte=50&vote_count.lte=400",
  },
  {
    title: "Nostalgic 2000s Cinema",
    subtitle: "Modern classics and iconic movies from the 2000s",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?primary_release_date.gte=2000-01-01&primary_release_date.lte=2009-12-31&sort_by=popularity.desc",
  },
  {
    title: "Animation & Family Night",
    subtitle: "Wholesome entertainment for all ages",
    type: "movie" as const,
    endpoint: "/api/tmdb/discover/movie?with_genres=16,10751&sort_by=popularity.desc",
  },
]

export default async function HomePage() {
  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null
  let forYouItems: any[] = []
  let becauseYouWatchedSeed: { title: string; items: any[] } | null = null
  let recentlyAddedItems: JellyfinApiItem[] = []
  const airingMap: Record<number, string> = {} // TMDB ID -> airing label

  const timeSeed = Math.floor(Date.now() / (1000 * 60 * 60)) // Rotates every hour
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  try {
    // 1. Fetch trending with release filtering
    const trendingTvData = await getTrending("tv", "week")
    const trendingMovieData = await getTrending("movie", "week")

    // Filter released content only
    const tvResults = filterReleasedContent(trendingTvData?.results || [])
    const movieResults = filterReleasedContent(trendingMovieData?.results || [])

    // 2. Get Jellyfin items for badge lookup & watch history seeds
    let jellyfinSeries: JellyfinApiItem[] = []
    try {
      const { token } = await authenticate()
      // Pre-existing: the token doubles as userId, resolving against the
      // server's single Jellyfin account. Until multi-account support lands,
      // per-app-user profile data is effectively identical for everyone.
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
      console.log("Jellyfin not available, skipping personalized library content")
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
          const tmdbId = series.ProviderIds?.Tmdb ? parseInt(series.ProviderIds.Tmdb) : null
          if (tmdbId && label) {
            airingMap[tmdbId] = label
          }
        }
      })

      await Promise.all(airingPromises)
    }

    // 4. Generate personalized recommendations ("Top Picks For You")
    try {
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
    } catch (e) {
      console.error("Failed to generate recommendations:", e)
    }

    // 5. Generate "Because You Watched {Title}" dynamic row - rotates seed title automatically over time
    try {
      const resumeItems = await getResumeItems(20)
      const validSeeds = resumeItems.filter((item) => item.ProviderIds?.Tmdb)
      if (validSeeds.length > 0) {
        const seedIndex = timeSeed % validSeeds.length
        const seedItem = validSeeds[seedIndex]
        const seedTmdbId = parseInt(seedItem.ProviderIds!.Tmdb!, 10)
        const seedMediaType = seedItem.Type === "Movie" ? "movie" : "tv"
        const recs = await getTmdbRecommendations(seedTmdbId, seedMediaType)
        const formatted = recs.map((rec: any) => ({
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
        }))
        if (formatted.length > 0) {
          becauseYouWatchedSeed = {
            title: seedItem.Name,
            items: formatted,
          }
        }
      }
    } catch (e) {
      console.error("Failed to load Because You Watched seed:", e)
    }

    // 6. Build hero items (Rotated using timeSeed for dynamic homepage hero presentation)
    const rawHeroCandidates = [...tvResults.slice(0, 8), ...movieResults.slice(0, 8)]
    const shuffledHeroCandidates = seededShuffle(rawHeroCandidates, timeSeed).slice(0, 5)

    heroItems = await Promise.all(
      shuffledHeroCandidates.map(async (item: any) => {
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

    // 7. Dynamic Spotlight items (Rotated using timeSeed)
    if (tvResults.length > 2) {
      const spIndex = (timeSeed % (tvResults.length - 2)) + 2
      const sp = tvResults[spIndex] as any
      spotlightItem1 = {
        id: sp.id,
        title: sp.name || sp.title || "",
        overview: sp.overview || "",
        backdrop_path: sp.backdrop_path,
        media_type: "tv",
      }
    }

    if (movieResults.length > 2) {
      const sp2Index = ((timeSeed + 1) % (movieResults.length - 2)) + 2
      const sp2 = movieResults[sp2Index] as any
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

  // Pick rotated dynamic category rows from pool
  const selectedDynamicRows = seededShuffle(DYNAMIC_CATEGORY_POOL, timeSeed).slice(0, 4)

  return (
    <div className="space-y-10 pb-16">
      {/* 1. Hero Spotlight Carousel */}
      {heroItems.length > 0 && <HeroBillboard items={heroItems} />}

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44">
        {/* 2. Top Picks For You (AI / Watch History Powered) */}
        {forYouItems.length > 0 && (
          <MovieRow
            title="Top Picks For You"
            subtitle="Personalized recommendations based on your viewing history"
            type="movie"
            customItems={forYouItems}
          />
        )}

        {/* 3. Continue Watching */}
        <ContinueWatchingSection />

        {/* 4. Trending Right Now */}
        <MovieRow
          title="Trending Right Now"
          subtitle="What everyone is watching this week"
          type="tv"
          endpoint="/api/tmdb/trending/all/week"
        />

        {/* 5. Because You Watched {Title} */}
        {becauseYouWatchedSeed && (
          <MovieRow
            title={`Because You Watched ${becauseYouWatchedSeed.title}`}
            subtitle={`Recommendations inspired by your recent viewing of ${becauseYouWatchedSeed.title}`}
            type="movie"
            customItems={becauseYouWatchedSeed.items}
          />
        )}

        {/* 6. Mid-Page Featured Spotlight Banner 1 */}
        {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

        {/* 7. Something New To You */}
        <MovieRow
          title="Something New To You"
          subtitle="Freshly released movies available for home streaming"
          type="movie"
          endpoint={`/api/tmdb/discover/movie?sort_by=primary_release_date.desc&primary_release_date.lte=${thirtyDaysAgo}&vote_count.gte=10`}
        />

        {/* 8. Critically Acclaimed */}
        <MovieRow
          title="Critically Acclaimed"
          subtitle="Highest rated masterworks and critically acclaimed cinema"
          type="movie"
          endpoint="/api/tmdb/discover/movie?sort_by=vote_average.desc&vote_count.gte=250"
        />

        {/* 9. Global Hits */}
        <MovieRow
          title="Global Hits"
          subtitle="Worldwide blockbusters and top chart toppers"
          type="movie"
          endpoint="/api/tmdb/trending/movie/week"
        />

        {/* 10. Recently Added to Your Library */}
        {recentlyAddedItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              Recently Added to your Library
            </h2>
            <p className="text-xs text-gray-400 font-medium">Newly downloaded shows and movies in Jellyfin</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 pt-2">
              {recentlyAddedItems.slice(0, 8).map((item: JellyfinApiItem) => {
                const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
                const mediaType = item.Type === "Series" ? "tv" : "movie"

                return (
                  <a
                    key={item.Id}
                    href={tmdbId ? `/${mediaType}/${tmdbId}` : "#"}
                    className="block group"
                  >
                    <div className="aspect-[2/3] w-full bg-card rounded-none flex items-center justify-center overflow-hidden border border-border group-hover:border-accent transition-colors">
                      {item.ProviderIds?.Tmdb ? (
                        <img
                          src={`https://image.tmdb.org/t/p/w342/poster_path${item.ProviderIds.Tmdb}.jpg`}
                          alt={item.Name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <span className="text-gray-500 text-xs text-center px-2">No Poster</span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-white mt-1 truncate group-hover:text-accent transition-colors">{item.Name}</h3>
                  </a>
                )
              })}
            </div>
          </section>
        )}

        {/* 11. Mid-Page Featured Spotlight Banner 2 */}
        {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

        {/* 12-15. Dynamically Rotated Category Rows */}
        {selectedDynamicRows.map((row) => (
          <MovieRow
            key={row.title}
            title={row.title}
            subtitle={row.subtitle}
            type={row.type}
            endpoint={row.endpoint}
          />
        ))}
      </div>
    </div>
  )
}
