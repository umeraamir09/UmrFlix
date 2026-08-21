import { getUserDiscoveryProfile } from "./profile"
import { getRowFatigueMap, getServeLog } from "./store"
import {
  buildTopPicksRow,
  buildMicroGenreRows,
  buildKeywordRow,
  buildSeedRows,
  buildContextualRows,
  buildColdStartRows,
  MIN_ROW_ITEMS,
  type CandidateRow,
  type ScoredRowItem,
} from "./rows"
import {
  scoreItem,
  serveDemotion,
  isRowSuppressed,
  rankRowsMMR,
  fatiguePenalty,
  type RankableRow,
} from "./ranking"
import { cosineSimilarity } from "./vector"
import type { RowItem } from "../recommendations"
import { enrichMediaItemsWithPosters } from "../horizontal-posters"

/**
 * Feed orchestrator: candidate row synthesis → Tier-1 item ranking → Tier-2
 * MMR row ranking with fatigue suppression, serve demotion, and cross-row deduplication.
 */

export type FeedRow = {
  key: string
  title: string
  subtitle?: string
  type: "movie" | "tv"
  items: RowItem[]
}

export type FeedOptions = {
  mediaType?: "movie" | "tv"
  maxRows?: number
  clientHour?: number
}

const DEFAULT_MAX_ROWS = 8
const FEED_FLOOR_ROWS = 6
const FEED_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const feedMemoryCache = new Map<string, { rows: FeedRow[]; timestamp: number }>()

export function invalidateFeedCache(userId: string) {
  for (const key of feedMemoryCache.keys()) {
    if (key.startsWith(`${userId}:`)) feedMemoryCache.delete(key)
  }
}

export async function getPersonalizedFeed(
  userId: string,
  profileId = "default",
  opts: FeedOptions = {}
): Promise<FeedRow[]> {
  const mediaType = opts.mediaType
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS
  const clientHour = opts.clientHour
  const hourBucket = clientHour != null ? (clientHour < 12 ? "am" : "pm") : "all"
  const cacheKey = `${userId}:${profileId}:${mediaType ?? "all"}:${hourBucket}`

  const cached = feedMemoryCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < FEED_CACHE_TTL) {
    return cached.rows
  }

  const [profile, fatigueByKey, serveLog] = await Promise.all([
    getUserDiscoveryProfile(userId, profileId),
    getRowFatigueMap(userId, profileId),
    getServeLog(userId, profileId),
  ])

  // ── Candidate row pool (Module 2) ──
  let candidates: CandidateRow[]
  if (profile.hasProfile) {
    const [topPicks, microGenre, keyword, seeds, contextual] = await Promise.all([
      buildTopPicksRow(profile, mediaType),
      buildMicroGenreRows(profile, mediaType),
      buildKeywordRow(profile, mediaType),
      buildSeedRows(profile, mediaType),
      buildContextualRows(profile, mediaType, clientHour),
    ])
    candidates = [topPicks, ...microGenre, keyword, ...seeds, ...contextual].filter(
      (r): r is CandidateRow => r !== null && r.items.length >= MIN_ROW_ITEMS
    )
    if (candidates.length < 3) {
      candidates.push(...(await buildColdStartRows(mediaType)))
    }
  } else {
    const [topPicks, coldRows] = await Promise.all([
      buildTopPicksRow(profile, mediaType),
      buildColdStartRows(mediaType),
    ])
    candidates = [topPicks, ...coldRows].filter(
      (r): r is CandidateRow => r !== null && r.items.length >= MIN_ROW_ITEMS
    )
  }

  // ── Tier 1: horizontal item ranking + serve demotion + watched filter ──
  const now = Date.now()
  const rankable = new Map<string, RankableRow>()
  const candidateRowsMap = new Map<string, CandidateRow>()
  const scoredItemsByRow = new Map<string, ScoredRowItem[]>()

  function processRow(row: CandidateRow): boolean {
    const maxPopularity = Math.max(...row.items.map((i) => i.popularity), 1)
    const isBywRow = row.key.startsWith("byw:")
    const scored = row.items
      .filter((item) => {
        // Hard filter completed items. For BYW rows, allow interacted items if not completed.
        if (profile.completedKeys.has(item.key)) return false
        if (!isBywRow && profile.interactedKeys.has(item.key)) return false
        return true
      })
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
        return { item, score, sim }
      })

    scored.sort((a, b) => b.score - a.score)
    const ranked = scored.slice(0, 20)
    if (ranked.length < MIN_ROW_ITEMS) return false

    const top3 = ranked.slice(0, 3)
    const topItemScore = top3.reduce((s, r) => s + r.score, 0) / top3.length
    const meanSim = top3.reduce((s, r) => s + r.sim, 0) / top3.length
    const relevance = Math.min(1, Math.max(0.05, (meanSim + 1) / 2))

    rankable.set(row.key, {
      key: row.key,
      itemKeys: ranked.map((r) => r.item.key),
      topItemScore,
      relevance,
    })
    candidateRowsMap.set(row.key, row)
    scoredItemsByRow.set(row.key, ranked.map((r) => r.item))
    return true
  }

  for (const row of candidates) {
    if (isRowSuppressed(fatigueByKey.get(row.key))) continue
    processRow(row)
  }

  // ── Feed floor guarantee (minimum 6 rows) ──
  const targetFloor = Math.min(FEED_FLOOR_ROWS, candidates.length)
  if (rankable.size < targetFloor) {
    for (const row of candidates) {
      if (!rankable.has(row.key)) {
        processRow(row)
      }
      if (rankable.size >= targetFloor) break
    }
  }

  if (rankable.size === 0) return []

  // ── Tier 2: vertical MMR row ranking ──
  const orderedKeys = rankRowsMMR([...rankable.values()], {
    fatigueByKey,
    limit: maxRows,
  })

  // Re-order keys to prioritize "Top Picks" at position 0 if present
  const keysToProcess: string[] = []
  if (rankable.has("top-picks")) {
    keysToProcess.push("top-picks")
  }
  for (const k of orderedKeys) {
    if (!keysToProcess.includes(k)) keysToProcess.push(k)
  }

  // ── Cross-row deduplication & assembly ──
  const seenItems = new Set<string>()
  const finalFeed: FeedRow[] = []

  for (const key of keysToProcess) {
    const rawRow = candidateRowsMap.get(key)
    const items = scoredItemsByRow.get(key)
    if (!rawRow || !items) continue

    const dedupedItems = items.filter((i) => !seenItems.has(i.key))
    if (dedupedItems.length < MIN_ROW_ITEMS) continue

    const selectedItems = dedupedItems.slice(0, 20)
    for (const item of selectedItems) {
      seenItems.add(item.key)
    }

    finalFeed.push({
      key: rawRow.key,
      title: rawRow.title,
      subtitle: rawRow.subtitle,
      type: rawRow.type,
      items: selectedItems.map((i) => i.rowItem),
    })

    if (finalFeed.length >= maxRows) break
  }

  // Enrich row items with English logo-treated backdrops
  const allRowItems = finalFeed.flatMap((row) => row.items)
  if (allRowItems.length > 0) {
    await enrichMediaItemsWithPosters(allRowItems)
  }

  if (feedMemoryCache.size > 200) {
    for (const [k, v] of feedMemoryCache.entries()) {
      if (now - v.timestamp >= FEED_CACHE_TTL) feedMemoryCache.delete(k)
    }
    if (feedMemoryCache.size > 200) {
      const oldestKey = feedMemoryCache.keys().next().value
      if (oldestKey) feedMemoryCache.delete(oldestKey)
    }
  }
  feedMemoryCache.set(cacheKey, { rows: finalFeed, timestamp: Date.now() })
  return finalFeed
}

/** Score a single candidate against the user vector (genre pages reuse this). */
export function affinityScore(userVector: number[], itemVector: number[]): number {
  const sim = cosineSimilarity(userVector, itemVector)
  return (sim + 1) / 2
}

/** Exposed for tests. */
export { fatiguePenalty }
