import { NextResponse } from "next/server"
import { authenticate, getAllItems, JellyfinItem } from "@/lib/jellyfin"
import { setJellyfinIndex } from "@/lib/cache"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"

export const dynamic = "force-dynamic"

export interface JellyfinLibraryItem {
  jellyfinId: string
  title: string
  type: "movie" | "tv"
  tmdbId: number | null
  tvdbId: number | null
  imdbId: string | null
  year: number | null
  posterUrl: string
  backdropUrl: string
  dateAdded?: string
}

type ExtendedJellyfinItem = JellyfinItem & {
  ProductionYear?: number
  PremiereDate?: string
  DateCreated?: string
  DateLastMediaAdded?: string
  Overview?: string
}

async function resolveTmdbIdFromTvdb(tvdbId: number): Promise<number | null> {
  try {
    const res = await tmdbProxyFetch(`/3/find/${tvdbId}?external_source=tvdb_id`, { timeoutMs: 3_000 })
    if (!res.ok) return null
    const data = await res.json()
    const tvResults = data.tv_results ?? []
    const movieResults = data.movie_results ?? []
    if (tvResults.length > 0) return tvResults[0].id
    if (movieResults.length > 0) return movieResults[0].id
    return null
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const { token, userId } = await authenticate()
    const rawItems: JellyfinItem[] = await getAllItems(token, userId)

    // Update internal Jellyfin index cache for availability mapping
    setJellyfinIndex(rawItems)

    const movies: JellyfinLibraryItem[] = []
    const series: JellyfinLibraryItem[] = []

    const tvdbResolveQueue: { item: JellyfinLibraryItem }[] = []

    for (const rawItem of rawItems) {
      const item = rawItem as ExtendedJellyfinItem
      const type = item.Type === "Series" ? "tv" : "movie"
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb, 10) : null
      const tvdbId = item.ProviderIds?.Tvdb ? parseInt(item.ProviderIds.Tvdb, 10) : null
      const imdbId = item.ProviderIds?.Imdb ?? null

      let year: number | null = null
      if (item.ProductionYear) {
        year = item.ProductionYear
      } else if (item.PremiereDate) {
        const d = new Date(item.PremiereDate)
        if (!isNaN(d.getTime())) year = d.getFullYear()
      }

      const libItem: JellyfinLibraryItem = {
        jellyfinId: item.Id,
        title: item.Name,
        type,
        tmdbId: isNaN(tmdbId as number) ? null : tmdbId,
        tvdbId: isNaN(tvdbId as number) ? null : tvdbId,
        imdbId,
        year,
        posterUrl: `/api/jellyfin/image/${item.Id}?type=Primary`,
        backdropUrl: `/api/jellyfin/image/${item.Id}?type=Backdrop`,
        dateAdded: item.DateCreated || item.DateLastMediaAdded,
      }

      if (type === "movie") {
        movies.push(libItem)
      } else {
        series.push(libItem)
        if (!libItem.tmdbId && libItem.tvdbId) {
          tvdbResolveQueue.push({ item: libItem })
        }
      }
    }

    // Resolve missing TMDB IDs for series in parallel (batch limit of 10 for performance)
    if (tvdbResolveQueue.length > 0) {
      const toResolve = tvdbResolveQueue.slice(0, 10)
      await Promise.all(
        toResolve.map(async (entry) => {
          if (entry.item.tvdbId) {
            const resolved = await resolveTmdbIdFromTvdb(entry.item.tvdbId)
            if (resolved) {
              entry.item.tmdbId = resolved
            }
          }
        })
      )
    }

    return NextResponse.json({
      movies,
      series,
      total: movies.length + series.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch Jellyfin library"
    console.error("Library API error:", message)
    return NextResponse.json(
      { movies: [], series: [], total: 0, error: message },
      { status: 502 }
    )
  }
}
