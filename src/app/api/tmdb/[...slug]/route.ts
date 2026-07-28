import { NextRequest, NextResponse } from "next/server"
import { env } from "@/lib/env"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const TMDB_BASE = env("TMDB_API_BASE") || "https://api.themoviedb.org/3"
    const TMDB_KEY = env("TMDB_API_KEY")
    const { slug } = await params
    const path = "/" + (slug && slug.length > 0 ? slug.join("/") : "")
    const url = new URL(`${TMDB_BASE}${path}`)
    url.searchParams.set("api_key", TMDB_KEY)
    url.searchParams.set("language", "en-US")

    for (const [key, value] of request.nextUrl.searchParams) {
      url.searchParams.set(key, value)
    }

    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), 8_000)
    try {
      const res = await fetch(url.toString(), { signal: controller.signal })
      const data = await res.json()
      return NextResponse.json(data, { status: res.status })
    } finally {
      clearTimeout(id)
    }
  } catch (err) {
    console.error("TMDB API proxy error:", err)
    return NextResponse.json({ error: "Failed to fetch from TMDB API" }, { status: 500 })
  }
}
