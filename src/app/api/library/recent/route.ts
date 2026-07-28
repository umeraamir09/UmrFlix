import { NextResponse } from "next/server"
import { authenticate, getAllItems } from "@/lib/jellyfin"

interface ApiItem {
  id: string
  name: string
  type: string
  providerIds: Record<string, string | undefined>
  imageUrl: string
  dateAdded?: string
  tmdbId: number | null
  tvdbId: number | null
}

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const { token } = await authenticate()
    const items = await getAllItems(token, token)
    
    // Sort by DateCreated desc, take top 20
    const sorted = (items as any[])
      .filter((item: any) => item.DateCreated || item.DateLastMediaAdded)
      .sort((a: any, b: any) => {
        const dateA = new Date(a.DateCreated || a.DateLastMediaAdded || 0)
        const dateB = new Date(b.DateCreated || b.DateLastMediaAdded || 0)
        return dateB.getTime() - dateA.getTime()
      })
      .slice(0, 20)
    
    // Map to include info for display
    const mapped: ApiItem[] = sorted.map((item: any) => {
      const tmdbId = item.ProviderIds?.Tmdb ? parseInt(item.ProviderIds.Tmdb) : null
      const tvdbId = item.ProviderIds?.Tvdb ? parseInt(item.ProviderIds.Tvdb) : null
      
      return {
        id: item.Id,
        name: item.Name,
        type: item.Type === "Series" ? "tv" : "movie",
        providerIds: item.ProviderIds,
        imageUrl: `/api/jellyfin/stream/${item.Id}/primary`,
        dateAdded: item.DateCreated,
        tmdbId,
        tvdbId,
      }
    })
    
    // Filter only items with valid TMDB IDs for display
    const withTmdb = mapped.filter(m => m.tmdbId)
    
    return NextResponse.json({ items: withTmdb, total: withTmdb.length })
  } catch (err) {
    console.error("Recent library API error:", err)
    return NextResponse.json({ items: [], total: 0, error: "Failed to load library items" }, { status: 500 })
  }
}
