import Image from "next/image"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { PersonalizedFeed } from "@/components/PersonalizedFeed"
import { FacetRails } from "@/components/FacetRails"
import { getTrending, getItemLogo } from "@/lib/tmdb"
import { filterReleasedContent } from "@/lib/catalog"
import { curateTrending } from "@/lib/content-policy"
import { getNextEpisode, getAiringLabel, lookupShowByTvdbId } from "@/lib/tvmaze"
import { authenticate, getAllItems } from "@/lib/jellyfin"

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
// (trending, Jellyfin items, TVMaze lookups, hero logos) to at most once an
// hour; the hero rotation (timeSeed) advances with each regeneration.
// Continue Watching and the personalized discovery rows (Top Picks, micro-
// genres, Because You Watched) are client-fetched per session via
// <PersonalizedFeed />, keeping this shell shareable across users.
export const revalidate = 3600

function seededShuffle<T>(arr: T[], seed: number): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.abs(Math.sin(seed + i) * 10000)) % (i + 1)
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

// Structural view over the trending movie/tv union so hero and spotlight
// building can read either shape without `any`.
type TrendingMedia = {
  id: number
  title?: string
  name?: string
  overview: string
  backdrop_path: string | null
  poster_path: string | null
  vote_average: number
  release_date?: string
  first_air_date?: string
}

function getTimeSeed(): number {
  return Math.floor(Date.now() / (1000 * 60 * 60))
}

export default async function HomePage() {
  let heroItems: BillboardItem[] = []
  let spotlightItem1: SpotlightItem | null = null
  let spotlightItem2: SpotlightItem | null = null
  let recentlyAddedItems: JellyfinApiItem[] = []
  const airingMap: Record<number, string> = {} // TMDB ID -> airing label

  const timeSeed = getTimeSeed() // Rotates every hour

  try {
    // 1. Fetch trending with release filtering + shared curation (§1.7):
    //    hero rotation requires backdrop quality and a minimum rating, and
    //    every trending consumer demotes explicit-suspect titles.
    const trendingTvData = await getTrending("tv", "week")
    const trendingMovieData = await getTrending("movie", "week")

    const tvResults = filterReleasedContent(
      curateTrending(
        (trendingTvData?.results || []).map((item) => ({
          id: item.id,
          popularity: item.popularity,
          voteAverage: item.vote_average,
          voteCount: item.vote_count,
          adult: (item as { adult?: boolean }).adult ?? undefined,
          name: "title" in item ? undefined : item.name,
          posterPath: item.poster_path,
          backdropPath: item.backdrop_path,
          raw: item,
        }))
      ).map((e) => e.raw as TrendingMedia)
    )
    const movieResults = filterReleasedContent(
      curateTrending(
        (trendingMovieData?.results || []).map((item) => ({
          id: item.id,
          popularity: item.popularity,
          voteAverage: item.vote_average,
          voteCount: item.vote_count,
          adult: (item as { adult?: boolean }).adult ?? undefined,
          title: "title" in item ? item.title : undefined,
          posterPath: item.poster_path,
          backdropPath: item.backdrop_path,
          raw: item,
        }))
      ).map((e) => e.raw as TrendingMedia)
    )
    // §1.7: hero candidates must have a backdrop and clear a rating bar.
    const heroEligible = [...tvResults, ...movieResults].filter(
      (item) => item.backdrop_path && item.vote_average >= 6.5
    )

    // 2. Get Jellyfin items for badge lookup & recently-added row
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

    // 4. Personalized rows (Top Picks, micro-genres, Because You Watched,
    //    contextual triggers) are client-fetched per session via
    //    <PersonalizedFeed /> → /api/discovery/home, keeping this ISR shell
    //    shareable across users (see Discovery Engine in AGENTS.md).

    // 5. Build hero items (Rotated using timeSeed for dynamic homepage hero presentation)
    const heroTv = heroEligible.filter((i) => !i.title).slice(0, 8)
    const heroMovies = heroEligible.filter((i) => i.title).slice(0, 8)
    const rawHeroCandidates = [...heroTv, ...heroMovies]
    const shuffledHeroCandidates = seededShuffle(rawHeroCandidates, timeSeed).slice(0, 5)

    heroItems = await Promise.all(
      shuffledHeroCandidates.map(async (item: TrendingMedia) => {
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

    // 6. Dynamic Spotlight items (Rotated using timeSeed)
    if (tvResults.length > 2) {
      const spIndex = (timeSeed % (tvResults.length - 2)) + 2
      const sp: TrendingMedia = tvResults[spIndex]
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
      const sp2: TrendingMedia = movieResults[sp2Index]
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

      <div className="mx-auto max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44 2xl:-mt-52">
        {/* 2. Personalized Discovery Feed: Top Picks For You at row 1, Continue Watching at row 2, followed by remaining personalized rows */}
        <PersonalizedFeed includeContinueWatching />

        {/* 4. Trending Right Now (§2.6: shared facet registry, server-filtered) */}
        <FacetRails keys={["trending-movies"]} cardVariant="large" />

        {/* 5. Mid-Page Featured Spotlight Banner 1 */}
        {spotlightItem1 && <SpotlightBanner item={spotlightItem1} />}

        {/* 6. Curated cross-genre rails (§2.6: 15+ shared facet rows) */}
        <FacetRails
          keys={[
            "recently-released-movies",
            "top-10-movies",
            "top-rated-movies",
            "on-the-air-shows",
            "top-10-shows",
          ]}
        />

        {/* 7. Global Hits */}
        <FacetRails keys={["popular-movies"]} />

        {/* 8. Genre rails (movie) */}
        <FacetRails
          keys={[
            "genre-action-movie-popular",
            "genre-sci-fi-movie-popular",
            "genre-comedy-movie-popular",
            "genre-horror-movie-popular",
            "genre-drama-movie-top-rated",
          ]}
        />

        {/* 9. Mid-Page Featured Spotlight Banner 2 */}
        {spotlightItem2 && <SpotlightBanner item={spotlightItem2} />}

        {/* 10. Genre rails (TV) */}
        <FacetRails
          keys={[
            "genre-sci-fi-tv-popular",
            "genre-crime-tv-popular",
            "genre-comedy-tv-popular",
            "genre-animation-tv-popular",
            "top-rated-shows",
          ]}
        />

        {/* 11. Specialty rails (R2-4: network + language; §7.8 coming soon) */}
        <FacetRails keys={["coming-soon"]} />
        <FacetRails keys={["hbo-series", "netflix-originals", "k-dramas", "anime-series", "studio-ghibli", "bollywood"]} />

        {/* 12. Recently Added to Your Library */}
        {recentlyAddedItems.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              Recently Added to your Library
            </h2>
            <p className="text-xs text-penpot-text-medium font-medium">Newly downloaded shows and movies in Jellyfin</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 3xl:grid-cols-8 gap-4 pt-2">
              {recentlyAddedItems.slice(0, 6).map((item: JellyfinApiItem) => {
                const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
                const mediaType = item.Type === "Series" ? "tv" : "movie"

                return (
                  <a
                    key={item.Id}
                    href={tmdbId ? `/${mediaType}/${tmdbId}` : "#"}
                    className="block group"
                  >
                    <div className="relative aspect-[240/136] w-full bg-penpot-surface rounded-[8px] flex items-center justify-center overflow-hidden border border-penpot-border shadow-md group-hover:border-penpot-primary-300/50 group-hover:scale-[1.02] transition-all duration-200">
                      <Image
                        src={`/api/jellyfin/image/${item.Id}?type=Backdrop`}
                        alt={item.Name}
                        fill
                        unoptimized
                        className="object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    </div>
                    <h3 className="text-xs font-bold text-white mt-2 truncate group-hover:text-penpot-primary-100 transition-colors">{item.Name}</h3>
                  </a>
                )
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
