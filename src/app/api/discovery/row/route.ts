import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserDiscoveryProfile } from "@/lib/discovery/profile"
import { getFacetScoredItems } from "@/lib/discovery/facets"
import { scoreItem, serveDemotion } from "@/lib/discovery/ranking"
import { getServeLog, recordServeLog, type ServeEntry } from "@/lib/discovery/store"
import { enrichMediaItemsWithPosters } from "@/lib/horizontal-posters"
import { contentSuitability } from "@/lib/catalog"

export const dynamic = "force-dynamic"

/**
 * Performance guards for the per-row hot path (a 25-rail page fires this
 * endpoint once per rail):
 *  - serve-log reads hit a 10s in-memory micro-cache instead of Convex per row
 *  - serve-log writes are content-hashed so identical serves aren't re-recorded
 *    (§5.6) and anonymous sessions skip them entirely
 */
const SERVE_LOG_CACHE_TTL = 10_000
const serveLogCache = new Map<string, { map: Map<string, ServeEntry>; timestamp: number }>()

async function getServeLogCached(userId: string, profileId: string): Promise<Map<string, ServeEntry>> {
  const key = `${userId}:${profileId}`
  const cached = serveLogCache.get(key)
  if (cached && Date.now() - cached.timestamp < SERVE_LOG_CACHE_TTL) return cached.map
  const map = await getServeLog(userId, profileId)
  if (serveLogCache.size > 500) serveLogCache.clear()
  serveLogCache.set(key, { map, timestamp: Date.now() })
  return map
}

const lastRowServeHashes = new Map<string, string>()

function recordServeLogDeduped(userId: string, profileId: string, scopeKey: string, itemKeys: string[]): void {
  const hash = itemKeys.join(",")
  const dedupeKey = `${userId}:${profileId}:${scopeKey}`
  if (lastRowServeHashes.get(dedupeKey) === hash) return
  lastRowServeHashes.set(dedupeKey, hash)
  if (lastRowServeHashes.size > 2000) lastRowServeHashes.clear()
  void recordServeLog(userId, profileId, itemKeys).catch(() => {})
}

/**
 * GET /api/discovery/row?facet=<key>&page=<n>
 * Drop-in replacement for static row endpoints on /movie and /tvshows.
 * Returns pooled, personally ranked, watched-filtered items.
 *
 * R1-1: `page` paginates through the cached candidate pool (each page serves
 * the next 20 items from a fresh 2-TMDB-page pool bundle).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const facetKey = searchParams.get("facet")
    if (!facetKey) {
      return NextResponse.json({ results: [] }, { status: 400 })
    }
    const pageParam = searchParams.get("page")
    const page = pageParam ? Math.max(1, Number.parseInt(pageParam, 10) || 1) : 1
    const profileIdParam = searchParams.get("profileId")
    const profileId = profileIdParam && /^[\w-]{1,64}$/.test(profileIdParam) ? profileIdParam : "default"

    const facetData = await getFacetScoredItems(facetKey, page)
    if (!facetData) {
      return NextResponse.json({ results: [] })
    }

    const { items, hasMore } = facetData
    const session = await getSession()
    const userId = session?.userId ?? "default-user"

    const [profile, serveLog] = await Promise.all([
      getUserDiscoveryProfile(userId, profileId),
      getServeLogCached(userId, profileId),
    ])

    const now = Date.now()
    const maxPopularity = Math.max(...items.map((i) => i.popularity), 1)

    const scored = items
      .filter((item) => !profile.completedKeys.has(item.key) && !profile.interactedKeys.has(item.key))
      .filter((item) => !profile.hiddenKeys.has(item.key))
      .map((item) => {
        let score = scoreItem({
          userVector: profile.vector,
          itemVector: item.vector,
          popularity: item.popularity,
          voteAverage: item.voteAverage,
          voteCount: item.voteCount,
          releaseYear: item.releaseYear,
          maxPopularity,
          mediaType: facetData.spec.mediaType,
        })
        score *= contentSuitability(item.rowItem)

        const serveEntry = serveLog.get(item.key)
        if (serveEntry && now - serveEntry.lastServedAt < 72 * 60 * 60 * 1000) {
          score *= serveDemotion(serveEntry.count)
        }

        return { item, score }
      })

    // §5.5 (R0-6): if profile/watched filtering empties the pool, top up from
    // the next pool page — NEVER fall back to raw pool order, which bypassed
    // the watched filter two lines up.
    let rankedItems = scored.sort((a, b) => b.score - a.score).slice(0, 20).map((s) => s.item)
    if (rankedItems.length < 5 && hasMore) {
      const nextPage = await getFacetScoredItems(facetKey, page + 1)
      if (nextPage) {
        const topUp = nextPage.items
          .filter(
            (item) =>
              !profile.completedKeys.has(item.key) &&
              !profile.interactedKeys.has(item.key) &&
              !profile.hiddenKeys.has(item.key)
          )
          .slice(0, 20 - rankedItems.length)
        rankedItems = [...rankedItems, ...topUp]
      }
    }

    if (session?.userId) {
      recordServeLogDeduped(userId, profileId, `${facetKey}:p${page}`, rankedItems.map((i) => i.key))
    }

    const rowItems = rankedItems.map((i) => i.rowItem)
    // Performance: resolve warm-cache backdrops synchronously, fetch the rest
    // in the background — the row paints immediately and the client poster
    // batch covers first-load gaps.
    await enrichMediaItemsWithPosters(rowItems, undefined, { cachedOnly: true })
    void Promise.resolve()
      .then(() => new Promise((resolve) => setTimeout(resolve, 25)))
      .then(() => enrichMediaItemsWithPosters(rowItems))
      .catch(() => {})

    return NextResponse.json({ results: rowItems, hasMore })
  } catch (err) {
    console.error("[Discovery] Row facet endpoint failed:", err)
    return NextResponse.json({ results: [] })
  }
}
