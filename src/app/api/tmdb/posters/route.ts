import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { tmdbFetch } from "@/lib/tmdb"
import { checkRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

type ItemRef = { id: number; type: "movie" | "tv" }

type CachedPoster = {
  filePath: string | null
  timestamp: number
}

const posterCache = new Map<string, CachedPoster>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

function getCached(key: string): string | null | undefined {
  const entry = posterCache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    posterCache.delete(key)
    return undefined
  }
  return entry.filePath
}

function setCached(key: string, filePath: string | null) {
  if (posterCache.size > 2000) {
    const now = Date.now()
    for (const [k, v] of posterCache.entries()) {
      if (now - v.timestamp > CACHE_TTL_MS) posterCache.delete(k)
    }
  }
  posterCache.set(key, { filePath, timestamp: Date.now() })
}

async function fetchEnglishHorizontalPoster(type: "movie" | "tv", id: number): Promise<string | null> {
  const key = `${type}-${id}`
  const cached = getCached(key)
  if (cached !== undefined) return cached

  try {
    const res = await tmdbFetch<{
      backdrops?: {
        file_path: string
        iso_639_1: string | null
        vote_average: number
        vote_count: number
      }[]
    }>(`/${type}/${id}/images`, { include_image_language: "en" })

    // Filter strictly to English title-treated backdrops
    const enBackdrops = (res.backdrops || []).filter((b) => b.iso_639_1 === "en")

    if (enBackdrops.length > 0) {
      // Sort by vote count descending, then vote average
      enBackdrops.sort((a, b) => {
        if (b.vote_count !== a.vote_count) {
          return b.vote_count - a.vote_count
        }
        return (b.vote_average || 0) - (a.vote_average || 0)
      })

      const topPath = enBackdrops[0]?.file_path ?? null
      setCached(key, topPath)
      return topPath
    }

    setCached(key, null)
    return null
  } catch {
    setCached(key, null)
    return null
  }
}

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
