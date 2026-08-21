import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPersonalizedFeed } from "@/lib/discovery/engine"
import { recordServeLog } from "@/lib/discovery/store"

export const dynamic = "force-dynamic"

type CacheEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[]
  timestamp: number
}

const homeFeedCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 20_000 // 20-second per-user cache

/**
 * Personalized home/genre feed rows for the current session user.
 * Client-fetched (SWR) so the ISR page shells stay cacheable across users.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId ?? "default-user"

    const { searchParams } = new URL(req.url)
    const mediaTypeParam = searchParams.get("mediaType")
    const mediaType =
      mediaTypeParam === "movie" || mediaTypeParam === "tv" ? mediaTypeParam : undefined
    const hourParam = searchParams.get("hour")
    const clientHour = hourParam ? Number.parseInt(hourParam, 10) : undefined

    const cacheKey = `${userId}:${mediaType || "all"}:${clientHour || "default"}`
    const now = Date.now()
    const cached = homeFeedCache.get(cacheKey)

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ rows: cached.rows })
    }

    const rows = await getPersonalizedFeed(userId, "default", { mediaType, clientHour })
    homeFeedCache.set(cacheKey, { rows, timestamp: now })

    if (rows.length > 0 && session?.userId) {
      const servedItemKeys = rows.flatMap((r) => r.items.map((i) => `${i.media_type ?? "movie"}:${i.id}`))
      void recordServeLog(userId, "default", servedItemKeys)
    }

    return NextResponse.json({ rows })
  } catch (err) {
    console.error("[Discovery] Home feed failed:", err)
    return NextResponse.json({ rows: [] })
  }
}
