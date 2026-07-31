import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"
import { checkRateLimit } from "@/lib/rate-limit"

const reverseCache = new Map<string, { tmdbId: number; type: string; timestamp: number }>()
const CACHE_TTL = 3600_000

function pruneCache() {
  const now = Date.now()
  for (const [key, entry] of reverseCache) {
    if (now - entry.timestamp > CACHE_TTL) {
      reverseCache.delete(key)
    }
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!checkRateLimit(`tmdb-id:${session.userId}`, { windowMs: 10_000, maxRequests: 30 })) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const tvdbId = request.nextUrl.searchParams.get("tvdbId")
  const imdbId = request.nextUrl.searchParams.get("imdbId")

  const externalId = tvdbId ?? imdbId
  const source = tvdbId ? "tvdb_id" : imdbId ? "imdb_id" : null

  if (!externalId || !source) {
    return NextResponse.json({ error: "Provide tvdbId or imdbId" }, { status: 400 })
  }

  if (source === "tvdb_id" && !/^\d+$/.test(externalId)) {
    return NextResponse.json({ error: "tvdbId must be numeric" }, { status: 400 })
  }
  if (source === "imdb_id" && !/^tt\d+$/i.test(externalId)) {
    return NextResponse.json({ error: "imdbId must match tt<digits>" }, { status: 400 })
  }

  const cacheKey = `${source}:${externalId}`
  const cached = reverseCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ tmdbId: cached.tmdbId, type: cached.type })
  }

  try {
    const res = await tmdbProxyFetch(`/3/find/${externalId}?external_source=${source}`, { timeoutMs: 5_000 })
    if (!res.ok) {
      return NextResponse.json({ error: "Lookup failed" }, { status: 502 })
    }
    const data = await res.json()

    const movieResults = data.movie_results ?? []
    const tvResults = data.tv_results ?? []

    const result =
      tvResults.length > 0
        ? { tmdbId: tvResults[0].id, type: "tv" as const }
        : movieResults.length > 0
          ? { tmdbId: movieResults[0].id, type: "movie" as const }
          : null

    if (result) {
      pruneCache()
      reverseCache.set(cacheKey, { ...result, timestamp: Date.now() })
      return NextResponse.json(result)
    }

    return NextResponse.json({ tmdbId: null, type: null }, { status: 404 })
  } catch {
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 })
  }
}
