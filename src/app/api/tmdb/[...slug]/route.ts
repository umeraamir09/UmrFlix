import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"
import { checkRateLimit } from "@/lib/rate-limit"
import { enrichMediaItemsWithPosters, fetchEnglishHorizontalPoster } from "@/lib/horizontal-posters"

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

    if (search.has("include_image_language")) {
      const langs = search
        .get("include_image_language")
        ?.split(",")
        .map((s) => s.trim())
        .filter((s) => s && s.toLowerCase() !== "null")
      if (langs && langs.length > 0) {
        search.set("include_image_language", langs.join(","))
      } else {
        search.set("include_image_language", "en")
      }
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

    // Enrich items with English title-treated backdrops before sending to client
    const ENRICHABLE_ROOTS = new Set(["search", "discover", "trending", "movie", "tv"])
    if (
      ENRICHABLE_ROOTS.has(slug[0]) &&
      typeof data === "object" &&
      data !== null
    ) {
      const dataObj = data as Record<string, unknown>
      const defaultType: "movie" | "tv" = slug.includes("tv") ? "tv" : "movie"

      if (Array.isArray(dataObj.results)) {
        await enrichMediaItemsWithPosters(
          dataObj.results as Array<{
            id: number
            media_type?: string
            backdrop_path?: string | null
            title?: string
            name?: string
          }>,
          defaultType
        )
      } else if (typeof dataObj.id === "number" && (slug[0] === "movie" || slug[0] === "tv")) {
        const enPoster = await fetchEnglishHorizontalPoster(slug[0], dataObj.id)
        if (enPoster) {
          dataObj.backdrop_path = enPoster
        }
      }
    }

    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    })
  } catch (err) {
    console.error("TMDB API proxy error:", err)
    return NextResponse.json({ error: "Failed to fetch from TMDB API" }, { status: 500 })
  }
}
