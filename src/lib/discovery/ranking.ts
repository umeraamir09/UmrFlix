import { cosineSimilarity } from "./vector"
import { bayesianQualityScore } from "../scoring"
import type { RowFatigue, RowStats } from "./store"

/**
 * Two-tiered ranking (Discovery Engine, Modules 3 & 4):
 *   Tier 1 — horizontal item ranking S_item within a row
 *   Tier 2 — vertical row ranking S_row with MMR diversity + UCB1 exploration
 *             and exponential visual-fatigue decay.
 */

// ── Tier 1: item scoring ──

export const ITEM_SCORE_WEIGHTS = {
  similarity: 0.50,
  quality: 0.20,
  popularity: 0.15,
  recency: 0.15,
} as const

export type ItemScoreInput = {
  userVector: number[]
  itemVector: number[]
  popularity: number
  voteAverage: number
  voteCount?: number | null
  releaseYear: number | null
  /** ln-normalization anchor: max popularity across the candidate pool. */
  maxPopularity: number
  mediaType?: "movie" | "tv"
  /**
   * Content-suitability multiplier from the content policy (audit §1.1):
   * explicit/adult items are demoted to near-zero instead of hidden.
   */
  suitability?: number
}

/**
 * S_item(u,i,r) = w1·Sim + w2·Quality + w3·PopularityNorm + w4·Recency
 *
 * Quality uses the Bayesian weighted rating (R0-3): thin-voted items regress
 * toward the TMDB corpus mean — no more free 0.5 for <50-vote obscurities.
 */
export function scoreItem(input: ItemScoreInput): number {
  const sim = cosineSimilarity(input.userVector, input.itemVector)

  const popularityNorm =
    input.maxPopularity > 0
      ? Math.log(1 + input.popularity) / Math.log(1 + input.maxPopularity)
      : 0

  const quality = bayesianQualityScore(input.voteCount, input.voteAverage, input.mediaType ?? "movie")

  let recency = 0.5
  if (input.releaseYear) {
    const currentYear = new Date().getFullYear()
    recency = Math.exp(-Math.max(0, currentYear - input.releaseYear) / 5)
  }

  const raw =
    ITEM_SCORE_WEIGHTS.similarity * sim +
    ITEM_SCORE_WEIGHTS.quality * quality +
    ITEM_SCORE_WEIGHTS.popularity * popularityNorm +
    ITEM_SCORE_WEIGHTS.recency * recency

  return raw * (input.suitability ?? 1)
}

/** Cross-surface serve demotion: x0.85 per serve within 72 h (Module 5). */
export function serveDemotion(serves: number): number {
  return Math.pow(0.85, Math.max(0, serves))
}

// ── Fatigue (Module 4.2) ──

export const FATIGUE_DECAY = 0.75
export const FATIGUE_SUPPRESS_THRESHOLD = 4
export const FATIGUE_SUPPRESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

export function fatiguePenalty(unclickedImpressions: number): number {
  return Math.pow(FATIGUE_DECAY, Math.max(0, unclickedImpressions))
}

/** K ≥ 4 within the last 7 days ⇒ row is suppressed from the feed. */
export function isRowSuppressed(fatigue: RowFatigue | undefined, now = Date.now()): boolean {
  if (!fatigue) return false
  return (
    fatigue.unclickedImpressions >= FATIGUE_SUPPRESS_THRESHOLD &&
    now - fatigue.lastSeenTimestamp < FATIGUE_SUPPRESS_WINDOW_MS
  )
}

// ── Tier 2: row ranking ──

export const MMR_MU = 0.7

/** UCB1 exploration scale (audit §5.3): S_row' = S_row + c·√(ln N / (1+n)). */
export const UCB1_EXPLORATION_C = 0.08

export type RankableRow = {
  key: string
  /** Item ids ("movie:123") in ranked order — used for MMR overlap. */
  itemKeys: string[]
  /** Mean S_item of the top-3 ranked items. */
  topItemScore: number
  /** Thematic affinity of the row with the user vector, in (0,1]. */
  relevance: number
}

export function rowUtility(
  row: RankableRow,
  fatigue: RowFatigue | undefined
): number {
  const penalty = fatiguePenalty(fatigue?.unclickedImpressions ?? 0)
  return row.topItemScore * row.relevance * penalty
}

/**
 * UCB1 exploration bonus: rows with few impressions relative to the global
 * total get a bounded boost so new/unexplored rows can surface instead of
 * losing structurally to established rows. With zero data it is 0.
 */
export function explorationBonus(
  rowStats: RowStats | undefined,
  totalImpressions: number
): number {
  if (!rowStats || totalImpressions <= 0) return 0
  const n = rowStats.totalImpressions
  return UCB1_EXPLORATION_C * Math.sqrt(Math.log(totalImpressions + 1) / (1 + n))
}

export function rowOverlap(a: RankableRow, b: RankableRow): number {
  if (a.itemKeys.length === 0 || b.itemKeys.length === 0) return 0
  const bSet = new Set(b.itemKeys)
  let intersection = 0
  for (const key of a.itemKeys) if (bSet.has(key)) intersection++
  return intersection / Math.min(a.itemKeys.length, b.itemKeys.length)
}

/**
 * Greedy Maximum Marginal Relevance row selection:
 *   next = argmax [ μ·S_row − (1−μ)·max Overlap(r, alreadySelected) ]
 *
 * S_row includes the UCB1 exploration bonus from global row bandit stats
 * (audit §5.3 — previously the table was write-only).
 */
export function rankRowsMMR(
  candidates: RankableRow[],
  ctx: {
    fatigueByKey: Map<string, RowFatigue>
    statsByKey?: Map<string, RowStats>
    limit?: number
  }
): string[] {
  const limit = ctx.limit ?? candidates.length
  const statsByKey = ctx.statsByKey ?? new Map<string, RowStats>()
  const totalImpressions = [...statsByKey.values()].reduce((s, r) => s + r.totalImpressions, 0)

  const utilities = new Map<string, number>()
  for (const row of candidates) {
    const base = rowUtility(row, ctx.fatigueByKey.get(row.key))
    utilities.set(row.key, base + explorationBonus(statsByKey.get(row.key), totalImpressions))
  }

  const remaining = new Map(candidates.map((r) => [r.key, r]))
  const selected: RankableRow[] = []
  const orderedKeys: string[] = []

  while (remaining.size > 0 && orderedKeys.length < limit) {
    let bestKey: string | null = null
    let bestValue = -Infinity

    for (const row of remaining.values()) {
      const maxOverlap =
        selected.length === 0
          ? 0
          : Math.max(...selected.map((s) => rowOverlap(row, s)))

      const value = MMR_MU * (utilities.get(row.key) ?? 0) - (1 - MMR_MU) * maxOverlap
      if (value > bestValue) {
        bestValue = value
        bestKey = row.key
      }
    }

    if (!bestKey) break
    selected.push(remaining.get(bestKey)!)
    remaining.delete(bestKey)
    orderedKeys.push(bestKey)
  }

  return orderedKeys
}
