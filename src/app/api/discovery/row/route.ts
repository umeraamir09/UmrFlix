import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserDiscoveryProfile } from "@/lib/discovery/profile"
import { getFacetScoredItems } from "@/lib/discovery/rows"
import { scoreItem, serveDemotion } from "@/lib/discovery/ranking"
import { cosineSimilarity } from "@/lib/discovery/vector"
import { getServeLog, recordServeLog } from "@/lib/discovery/store"

export const dynamic = "force-dynamic"

/**
 * GET /api/discovery/row?facet=<key>
 * Drop-in replacement for static row endpoints on /movie and /tvshows.
 * Returns pooled, personally ranked, watched-filtered items.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const facetKey = searchParams.get("facet")
    if (!facetKey) {
      return NextResponse.json({ results: [] }, { status: 400 })
    }

    const facetData = await getFacetScoredItems(facetKey)
    if (!facetData) {
      return NextResponse.json({ results: [] })
    }

    const { spec, items } = facetData
    const session = await getSession()
    const userId = session?.userId ?? "default-user"

    const [profile, serveLog] = await Promise.all([
      getUserDiscoveryProfile(userId, "default"),
      getServeLog(userId, "default"),
    ])

    const now = Date.now()
    const maxPopularity = Math.max(...items.map((i) => i.popularity), 1)

    const scored = items
      .filter((item) => !profile.completedKeys.has(item.key) && !profile.interactedKeys.has(item.key))
      .map((item) => {
        const sim = cosineSimilarity(profile.vector, item.vector)
        let score = scoreItem({
          userVector: profile.vector,
          itemVector: item.vector,
          popularity: item.popularity,
          voteAverage: item.voteAverage,
          voteCount: item.voteCount,
          releaseYear: item.releaseYear,
          maxPopularity,
          isWatched: false,
        })

        const serveEntry = serveLog.get(item.key)
        if (serveEntry && now - serveEntry.lastServedAt < 72 * 60 * 60 * 1000) {
          score *= serveDemotion(serveEntry.count)
        }

        return { item, score }
      })

    // If profile/filtering empties the pool, fall back to candidate pool order
    const rankedItems =
      scored.length >= 5
        ? scored.sort((a, b) => b.score - a.score).slice(0, 20).map((s) => s.item)
        : items.slice(0, 20)

    const servedKeys = rankedItems.map((i) => i.key)
    void recordServeLog(userId, "default", servedKeys)

    return NextResponse.json({ results: rankedItems.map((i) => i.rowItem) })
  } catch (err) {
    console.error("[Discovery] Row facet endpoint failed:", err)
    return NextResponse.json({ results: [] })
  }
}
