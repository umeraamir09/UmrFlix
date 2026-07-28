import { NextRequest, NextResponse } from "next/server"
import { env } from "@/lib/env"

const TMDB_BASE = env("TMDB_API_BASE")
const TMDB_KEY = env("TMDB_API_KEY")

const reverseCache = new Map<string, { tmdbId: number; type: string }>()
let cacheTimestamp = 0
const CACHE_TTL = 3600_000

export async function GET(request: NextRequest) {
  const tvdbId = request.nextUrl.searchParams.get("tvdbId")
  const imdbId = request.nextUrl.searchParams.get("imdbId")

  const externalId = tvdbId ?? imdbId
  const source = tvdbId ? "tvdb_id" : imdbId ? "imdb_id" : null

  if (!externalId || !source) {
    return NextResponse.json({ error: "Provide tvdbId or imdbId" }, { status: 400 })
  }

  const cacheKey = `${source}:${externalId}`
  if (Date.now() - cacheTimestamp < CACHE_TTL) {
    const cached = reverseCache.get(cacheKey)
    if (cached) return NextResponse.json(cached)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5_000)
  try {
    const url = `${TMDB_BASE}/find/${externalId}?external_source=${source}&api_key=${TMDB_KEY}`
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      return NextResponse.json({ error: "Lookup failed" }, { status: 502 })
    }
    const data = await res.json()

    const movieResults = data.movie_results ?? []
    const tvResults = data.tv_results ?? []

    if (tvResults.length > 0) {
      const result = { tmdbId: tvResults[0].id, type: "tv" as const }
      reverseCache.set(cacheKey, result)
      cacheTimestamp = Date.now()
      clearTimeout(timeoutId)
      return NextResponse.json(result)
    }

    if (movieResults.length > 0) {
      const result = { tmdbId: movieResults[0].id, type: "movie" as const }
      reverseCache.set(cacheKey, result)
      cacheTimestamp = Date.now()
      clearTimeout(timeoutId)
      return NextResponse.json(result)
    }

    clearTimeout(timeoutId)
    return NextResponse.json({ tmdbId: null, type: null }, { status: 404 })
  } catch (e) {
    clearTimeout(timeoutId)
    return NextResponse.json({ error: "Lookup failed" }, { status: 502 })
  }
}
