import { NextRequest, NextResponse } from "next/server"
import { generateRecommendations, getForYouRecommendations, getBecauseYouWatchedRecommendations } from "@/lib/recommendations"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get("userId") || "default"
    const limit = parseInt(searchParams.get("limit") || "20")
    const type = searchParams.get("type") as "movie" | "tv" | null
    const filter = searchParams.get("filter") // "foryou", "trending", "bygenre"
    const itemId = searchParams.get("itemId") ? parseInt(searchParams.get("itemId")!) : null
    const mediaType = searchParams.get("mediaType") as "movie" | "tv" | null

    let items
    
    if (filter === "foryou") {
      items = await getForYouRecommendations(userId)
    } else if (itemId && mediaType) {
      items = await getBecauseYouWatchedRecommendations(userId, itemId, mediaType)
    } else {
      items = await generateRecommendations(userId, { limit, mediaType: type ?? undefined })
    }

    return NextResponse.json({ items, count: items.length })
  } catch (err) {
    console.error("Recommendations API error:", err)
    return NextResponse.json({ items: [], count: 0, error: "Failed to load recommendations" }, { status: 500 })
  }
}
