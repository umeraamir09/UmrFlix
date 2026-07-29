import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isItemInMyList } from "@/lib/my-list-store"

export async function GET(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId || "default-user"

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id") || undefined
    const tmdbId = searchParams.get("tmdbId") ? Number(searchParams.get("tmdbId")) : undefined
    const jellyfinId = searchParams.get("jellyfinId") || undefined
    const mediaType = (searchParams.get("mediaType") as "movie" | "tv") || undefined

    const bookmarked = await isItemInMyList(userId, {
      id,
      tmdbId,
      jellyfinId,
      mediaType,
    })

    return NextResponse.json({ bookmarked })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to check bookmark status"
    return NextResponse.json({ error: message, bookmarked: false }, { status: 500 })
  }
}
