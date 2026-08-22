import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { generateRecommendations, getForYouRecommendations, getBecauseYouWatchedRecommendations } from "@/lib/recommendations"

export const dynamic = "force-dynamic"

/**
 * Legacy recommendation endpoint (§4.5). Kept as a thin adapter: the userId
 * now comes from the session — never a client query param (§5.4) — and `limit`
 * is clamped. The dead "trending"/"bygenre" filter values are gone.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)

    // §5.4: personalization must derive from the server session; a client
    // `userId` param can no longer poison (or share) another user's cache.
    const session = await getSession()
    const userId = session?.userId ?? "default-user"

    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20))
    const type = searchParams.get("type") as "movie" | "tv" | null
    const filter = searchParams.get("filter") // "foryou" is the only live value
    const itemId = searchParams.get("itemId") ? parseInt(searchParams.get("itemId")!, 10) : null
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
