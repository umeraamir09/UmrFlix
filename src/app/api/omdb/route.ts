import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { env } from "@/lib/env"
import { getBreaker } from "@/lib/circuit-breaker"

export const dynamic = "force-dynamic"

export type OmdbData = {
  Title?: string
  Year?: string
  Rated?: string
  Released?: string
  Runtime?: string
  Genre?: string
  Director?: string
  Writer?: string
  Actors?: string
  Plot?: string
  Language?: string
  Country?: string
  Awards?: string
  Poster?: string
  Ratings?: { Source: string; Value: string }[]
  Metascore?: string
  imdbRating?: string
  imdbVotes?: string
  imdbID?: string
  Type?: string
  Response?: string
  Error?: string
}

const omdbBreaker = getBreaker("omdbBreaker", { failureThreshold: 3, resetTimeoutMs: 30_000 })

export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!checkRateLimit(`omdb:${session.userId}`, { windowMs: 10_000, maxRequests: 30 })) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const imdbId = searchParams.get("i")

  if (!imdbId || !/^tt\d+$/.test(imdbId)) {
    return NextResponse.json({ error: "Invalid or missing IMDb ID parameter 'i'" }, { status: 400 })
  }

  const apiKey = env("OMDB_API_KEY")
  if (!apiKey) {
    return NextResponse.json({ error: "OMDB_API_KEY is not configured" }, { status: 500 })
  }

  if (!omdbBreaker.canExecute()) {
    return NextResponse.json({ error: "OMDb service temporarily unavailable" }, { status: 503 })
  }

  try {
    const res = await fetch(`http://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    })

    if (!res.ok) {
      omdbBreaker.recordFailure()
      return NextResponse.json({ error: `OMDb returned HTTP ${res.status}` }, { status: res.status })
    }

    const data: OmdbData = await res.json()
    if (data.Response === "False") {
      // OMDb returned an explicit error response e.g. {"Response":"False","Error":"Movie not found!"}
      return NextResponse.json(data, { status: 404 })
    }

    omdbBreaker.recordSuccess()
    return NextResponse.json(data)
  } catch (err) {
    omdbBreaker.recordFailure()
    console.error("Failed to fetch OMDb data:", err)
    return NextResponse.json({ error: "Failed to connect to OMDb API" }, { status: 500 })
  }
}
