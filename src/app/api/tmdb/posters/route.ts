import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { fetchEnglishHorizontalPoster } from "@/lib/horizontal-posters"

export const dynamic = "force-dynamic"

type ItemRef = { id: number; type: "movie" | "tv" }

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!checkRateLimit(`tmdb-posters:${session.userId}`, { windowMs: 10_000, maxRequests: 60 })) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  try {
    const body = (await request.json()) as { items?: ItemRef[] }
    const items = body.items || []

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ results: {} })
    }

    // Limit batch size to 40 items per request
    const batch = items.slice(0, 40)
    const results: Record<string, string | null> = {}

    await Promise.all(
      batch.map(async (item) => {
        if (!item.id || (item.type !== "movie" && item.type !== "tv")) return
        const key = `${item.type}-${item.id}`
        const posterPath = await fetchEnglishHorizontalPoster(item.type, item.id)
        results[key] = posterPath
      })
    )

    return NextResponse.json({ results })
  } catch (err) {
    console.error("Failed to batch fetch horizontal posters:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
