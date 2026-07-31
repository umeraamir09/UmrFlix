import { NextRequest, NextResponse } from "next/server"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"

export const dynamic = "force-dynamic"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  try {
    const { slug } = await params
    const path = "/3/" + (slug && slug.length > 0 ? slug.join("/") : "")
    const search = new URLSearchParams()
    search.set("language", "en-US")

    for (const [key, value] of request.nextUrl.searchParams) {
      search.set(key, value)
    }

    const res = await tmdbProxyFetch(`${path}?${search.toString()}`, { timeoutMs: 8_000 })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    console.error("TMDB API proxy error:", err)
    return NextResponse.json({ error: "Failed to fetch from TMDB API" }, { status: 500 })
  }
}
