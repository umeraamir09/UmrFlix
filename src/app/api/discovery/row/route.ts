import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserDiscoveryProfile } from "@/lib/discovery/profile"
import { getFacetScoredItems } from "@/lib/discovery/facets"
import { scoreItem, serveDemotion } from "@/lib/discovery/ranking"
import { getServeLog, recordServeLog } from "@/lib/discovery/store"
import { enrichMediaItemsWithPosters } from "@/lib/horizontal-posters"
import { contentSuitability } from "@/lib/catalog"

export const dynamic = "force-dynamic"

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
      getServeLog(userId, profileId),
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
      const servedKeys = rankedItems.map((i) => i.key)
      void recordServeLog(userId, profileId, servedKeys)
    }

    const rowItems = rankedItems.map((i) => i.rowItem)
    await enrichMediaItemsWithPosters(rowItems)

    return NextResponse.json({ results: rowItems, hasMore })
  } catch (err) {
    console.error("[Discovery] Row facet endpoint failed:", err)
    return NextResponse.json({ results: [] })
  }
}
