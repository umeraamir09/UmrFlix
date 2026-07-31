import { NextRequest, NextResponse } from "next/server"
import { getTmdbToTvdbMapping, setTmdbToTvdbMapping } from "@/lib/cache"
import { tmdbProxyFetch } from "@/lib/tmdb-proxy"

export async function GET(request: NextRequest) {
  const tmdbId = request.nextUrl.searchParams.get("tmdbId")
  if (!tmdbId) {
    return NextResponse.json({ error: "tmdbId is required" }, { status: 400 })
  }

  const id = Number(tmdbId)
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "tmdbId must be a positive integer" }, { status: 400 })
  }

  const cached = getTmdbToTvdbMapping(id)
  if (cached !== undefined) {
    return NextResponse.json({ tmdbId: id, tvdbId: cached, cached: true })
  }

  try {
    const res = await tmdbProxyFetch(`/3/tv/${id}/external_ids`, { timeoutMs: 5_000 })
    if (!res.ok) {
      return NextResponse.json({ tmdbId: id, tvdbId: null, error: "TMDB lookup failed" }, { status: 502 })
    }
    const data = await res.json()
    const tvdbId: number | null = data.tvdb_id ?? null
    if (tvdbId !== null) {
      setTmdbToTvdbMapping(id, tvdbId)
    }
    return NextResponse.json({ tmdbId: id, tvdbId, cached: false })
  } catch {
    return NextResponse.json({ tmdbId: id, tvdbId: null, error: "TMDB lookup failed" }, { status: 502 })
  }
}
