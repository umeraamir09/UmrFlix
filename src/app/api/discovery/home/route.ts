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
/** §5.7: hard LRU cap — unbounded `?hour=` values were a memory DoS. */
const MAX_CACHE_ENTRIES = 500

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
    const profileIdParam = searchParams.get("profileId")
    const profileId = profileIdParam && /^[\w-]{1,64}$/.test(profileIdParam) ? profileIdParam : "default"

    // §5.7: validate hour ∈ 0..23 — midnight (0) previously aliased to
    // "default" and arbitrary ints created permanent cache entries.
    const hourParam = searchParams.get("hour")
    let clientHour: number | undefined
    if (hourParam !== null) {
      const parsed = Number.parseInt(hourParam, 10)
      if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 23) {
        clientHour = parsed
      }
    }

    // §5.7: key the route cache by am/pm like the engine, so feeds stay
    // coherent instead of fragmenting per raw hour.
    const hourBucket = clientHour !== undefined ? (clientHour < 12 ? "am" : "pm") : "all"
    const cacheKey = `${userId}:${profileId}:${mediaType || "all"}:${hourBucket}`
    const now = Date.now()
    const cached = homeFeedCache.get(cacheKey)

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ rows: cached.rows })
    }

    const rows = await getPersonalizedFeed(userId, profileId, { mediaType, clientHour })

    if (homeFeedCache.size > MAX_CACHE_ENTRIES) {
      const overflow = homeFeedCache.size - MAX_CACHE_ENTRIES
      const oldest = [...homeFeedCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, overflow)
      for (const [k] of oldest) homeFeedCache.delete(k)
    }
    homeFeedCache.set(cacheKey, { rows, timestamp: now })

    // §5.2 (R0-1): fatigue is recorded only on genuine viewport impressions
    // (MovieRow IntersectionObserver beacon), never at serve time.
    if (rows.length > 0 && session?.userId) {
      const servedItemKeys = rows.flatMap((r) => r.items.map((i) => `${i.media_type ?? "movie"}:${i.id}`))
      void recordServeLog(userId, profileId, servedItemKeys)
    }

    return NextResponse.json({ rows })
  } catch (err) {
    console.error("[Discovery] Home feed failed:", err)
    return NextResponse.json({ rows: [] })
  }
}
