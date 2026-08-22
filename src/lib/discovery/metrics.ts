import { getRowStats } from "./store"
import { cosineSimilarity } from "./vector"

/**
 * Offline metrics harness (audit §7.12 / R2-2).
 *
 * Computes the health numbers that catch "feels random" regressions:
 *   - row CTR (global bandit stats: clicks / impressions per row key)
 *   - overall engagement rate
 *   - intra-list diversity over the cached item-feature vectors
 *   - exploration spread (share of rows with < 5 impressions — unexplored)
 *
 * Pure computation over the stores; safe to run nightly (cron hits the
 * /api/discovery/metrics route) or on demand.
 */

export type RowCtrEntry = {
  rowKey: string
  impressions: number
  clicks: number
  ctr: number
}

export type DiscoveryMetrics = {
  computedAt: number
  rowStats: {
    totalRows: number
    totalImpressions: number
    totalClicks: number
    overallCtr: number
    byRow: RowCtrEntry[]
    medianRowCtr: number
  }
  exploration: {
    /** Share of observed rows with fewer than 5 impressions (unexplored). */
    unexploredShare: number
  }
  diversity: {
    /** Mean pairwise dissimilarity (1 − cosine) across cached item vectors. */
    intraListDiversity: number
    sampleSize: number
  }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export async function computeDiscoveryMetrics(
  sampleItemVectors: number[][]
): Promise<DiscoveryMetrics> {
  const stats = await getRowStats()
  const entries: RowCtrEntry[] = []
  let totalImpressions = 0
  let totalClicks = 0

  for (const stat of stats.values()) {
    totalImpressions += stat.totalImpressions
    totalClicks += stat.totalClicks
    entries.push({
      rowKey: stat.rowCategoryKey,
      impressions: stat.totalImpressions,
      clicks: stat.totalClicks,
      ctr: stat.totalImpressions > 0 ? stat.totalClicks / stat.totalImpressions : 0,
    })
  }
  entries.sort((a, b) => b.ctr - a.ctr)

  const unexplored = entries.filter((e) => e.impressions < 5).length

  // Intra-list diversity: mean pairwise dissimilarity over the sample.
  let diversitySum = 0
  let pairs = 0
  const sample = sampleItemVectors.filter((v) => v.length > 0)
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      diversitySum += 1 - cosineSimilarity(sample[i], sample[j])
      pairs++
    }
  }

  return {
    computedAt: Date.now(),
    rowStats: {
      totalRows: entries.length,
      totalImpressions,
      totalClicks,
      overallCtr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      byRow: entries.slice(0, 25),
      medianRowCtr: median(entries.map((e) => e.ctr)),
    },
    exploration: {
      unexploredShare: entries.length > 0 ? unexplored / entries.length : 0,
    },
    diversity: {
      intraListDiversity: pairs > 0 ? diversitySum / pairs : 0,
      sampleSize: sample.length,
    },
  }
}
