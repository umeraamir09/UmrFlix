import { NextResponse } from "next/server"
import { authenticate, getAllItems, type JellyfinItem } from "@/lib/jellyfin"
import { lookupShowByTvdbId, getNextEpisode, getAiringLabel, type TvMazeShow } from "@/lib/tvmaze"

interface ApiItem {
  id: string
  tmdbId: number | null
  tvdbId: number | null
  name: string
  tvmaze: { id: number; name: string; status: string } | null
  nextEpisode: { airdate: string; airtime: string; season: number; number: number } | null
  airingLabel: string | null
}

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { token } = await authenticate()
    const jellyfinItems = await getAllItems(token, token)
    
    // Filter only TV series
    const seriesItems = jellyfinItems.filter((item: JellyfinItem) => item.Type === "Series")
    
    // For each series, try to get TVMaze info
    const series = await Promise.all(
      seriesItems.slice(0, 20).map(async (item: JellyfinItem) => {
        const tvdbId = item.ProviderIds?.Tvdb ? parseInt(item.ProviderIds.Tvdb) : null
        let tvmazeData: TvMazeShow | null = null
        
        if (tvdbId) {
          tvmazeData = await lookupShowByTvdbId(tvdbId)
        }
        
        const nextEpisode = tvmazeData ? await getNextEpisode(tvmazeData.id) : null
        const airingLabel = tvmazeData ? getAiringLabel(tvmazeData, nextEpisode ?? undefined) : null
        
        const result: ApiItem = {
          tmdbId: item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null,
          tvdbId,
          name: item.Name,
          id: item.Id,
          tvmaze: tvmazeData ? {
            id: tvmazeData.id,
            name: tvmazeData.name,
            status: tvmazeData.status,
          } : null,
          nextEpisode: nextEpisode ? {
            airdate: nextEpisode.airdate,
            airtime: nextEpisode.airtime,
            season: nextEpisode.season,
            number: nextEpisode.number,
          } : null,
          airingLabel,
        }
        
        return result
      })
    )
    
    // Filter for only currently airing shows
    const currentlyAiring = series.filter(s => s.airingLabel || s.nextEpisode)
    
    return NextResponse.json({ series: currentlyAiring, total: currentlyAiring.length })
  } catch (err) {
    console.error("Airing status API error:", err)
    return NextResponse.json({ series: [], total: 0, error: "Failed to load airing status" }, { status: 500 })
  }
}
