import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"
import { checkRateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const ALLOWED_ROOTS = new Set(["movie", "tv", "search", "find", "discover", "configuration", "trending"])
const SEGMENT_RE = /^[a-zA-Z0-9_-]+$/

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!checkRateLimit(`tmdb:${session.userId}`, { windowMs: 10_000, maxRequests: 30 })) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 })
  }

  try {
    const { slug } = await params
    if (!slug || slug.length === 0 || !ALLOWED_ROOTS.has(slug[0])) {
      return NextResponse.json({ error: "Invalid TMDB endpoint" }, { status: 400 })
    }
    if (!slug.every((segment) => SEGMENT_RE.test(segment))) {
      return NextResponse.json({ error: "Invalid path segment" }, { status: 400 })
    }

    const path = "/3/" + slug.map((segment) => encodeURIComponent(segment)).join("/")
    const search = new URLSearchParams()
    search.set("language", "en-US")

    for (const [key, value] of request.nextUrl.searchParams) {
      search.set(key, value)
    }

    const res = await tmdbProxyFetch(`${path}?${search.toString()}`)

    const bodyText = await res.text()
    let data: unknown = { error: "Proxy returned a non-JSON response" }
    if (bodyText) {
      try {
        data = JSON.parse(bodyText)
      } catch {
        data = { error: "Proxy returned a non-JSON response" }
      }
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: "TMDB request failed", status: res.status },
        { status: res.status >= 500 ? 502 : res.status }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error("TMDB API proxy error:", err)
    return NextResponse.json({ error: "Failed to fetch from TMDB API" }, { status: 500 })
  }
}
