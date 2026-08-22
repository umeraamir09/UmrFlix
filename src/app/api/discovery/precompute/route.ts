import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { FACET_REGISTRY, getFacetScoredItems } from "@/lib/discovery/facets"
import { resolveItemProfile } from "@/lib/discovery/profile"
import { getCachedItemProfile } from "@/lib/discovery/store"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Item-feature precompute (audit R2-1 / §6.2).
 *
 * Warms the Convex `itemFeatures` cache for the top items of the core facet
 * pools so profile builds and candidate-vector enrichment (dense 128-D
 * vectors with cast + keywords) read cache-local instead of hitting TMDB
 * per-request. Scheduled externally (PM2 cron / any scheduler):
 *
 *   POST /api/discovery/precompute   (session or x-cron-secret header)
 *
 * DISCOVERY_PRECOMPUTE_SECRET is optional — when unset only authenticated
 * sessions may trigger the job.
 */
export async function POST(req: Request) {
  const secret = process.env.DISCOVERY_PRECOMPUTE_SECRET
  const providedSecret = req.headers.get("x-cron-secret")
  if (secret && providedSecret !== secret) {
    const session = await getSession()
    if (!session?.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  // The pools every feed/facet ranks from — keep the order stable so a
  // partial run makes progress instead of reshuffling.
  const warmKeys = [
    "trending-movies",
    "trending-shows",
    "popular-movies",
    "popular-shows",
    "top-rated-movies",
    "top-rated-shows",
    "on-the-air-shows",
    "recently-released-movies",
  ].filter((k) => k in FACET_REGISTRY)

  let resolved = 0
  let cacheHits = 0
  let failures = 0

  for (const key of warmKeys) {
    const facet = await getFacetScoredItems(key, 1).catch(() => null)
    if (!facet) continue

    // Bounded concurrency (TMDB guidance ~50 req/s; 8 keeps well under).
    const chunkSize = 8
    const top = facet.items.slice(0, 24)
    for (let i = 0; i < top.length; i += chunkSize) {
      const chunk = top.slice(i, i + chunkSize)
      await Promise.all(
        chunk.map(async (item) => {
          const [mediaType, idRaw] = item.key.split(":")
          if (mediaType !== "movie" && mediaType !== "tv") return
          const tmdbId = Number.parseInt(idRaw, 10)
          if (!Number.isFinite(tmdbId)) return

          const cached = await getCachedItemProfile(mediaType, tmdbId)
          if (cached) {
            cacheHits++
            return
          }
          const profile = await resolveItemProfile(tmdbId, mediaType).catch(() => null)
          if (profile) resolved++
          else failures++
        })
      )
    }
  }

  return NextResponse.json({
    ok: true,
    pools: warmKeys.length,
    resolved,
    cacheHits,
    failures,
  })
}
