import { NextRequest, NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"
import { setRadarrMovies, getRadarrMovies } from "@/lib/cache"

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true"

  try {
    if (!forceRefresh) {
      const cached = getRadarrMovies()
      if (cached) {
        return NextResponse.json(Array.from(cached.values()))
      }
    }
    const movies = await radarr.getMovies()
    setRadarrMovies(movies)
    return NextResponse.json(movies)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Radarr movies"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const movie = await radarr.addMovie(body)
    return NextResponse.json(movie, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add movie"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
