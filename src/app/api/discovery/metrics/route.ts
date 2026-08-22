import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { computeDiscoveryMetrics } from "@/lib/discovery/metrics"
import { FACET_REGISTRY, getFacetScoredItems } from "@/lib/discovery/facets"

export const dynamic = "force-dynamic"

/**
 * Offline metrics endpoint (§7.12 / R2-2). Session-gated. Samples a couple of
 * cached facet pools for the diversity term; everything else comes from the
 * global row bandit stats.
 */
export async function GET() {
  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sampleKeys = ["popular-movies", "popular-shows"].filter((k) => k in FACET_REGISTRY)
  const vectors: number[][] = []
  for (const key of sampleKeys) {
    const facet = await getFacetScoredItems(key, 1).catch(() => null)
    if (!facet) continue
    for (const item of facet.items.slice(0, 20)) vectors.push(item.vector)
  }

  const metrics = await computeDiscoveryMetrics(vectors)
  return NextResponse.json(metrics)
}
