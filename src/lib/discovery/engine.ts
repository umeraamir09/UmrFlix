import { getUserDiscoveryProfile } from "./profile"
import { getRowFatigueMap, getServeLog, getRowStatsCached, recordServeLog } from "./store"
import {
  buildTopPicksRow,
  buildMicroGenreRows,
  buildKeywordRows,
  buildSeedRows,
  buildContextualRows,
  buildColdStartRows,
  buildWatchAgainRow,
  buildDailyFormatRow,
  enrichCandidateVectors,
  MIN_ROW_ITEMS,
  ROW_ITEM_LIMIT,
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
 * MMR row ranking with fatigue suppression, UCB1 exploration, serve demotion,
 * and cross-row deduplication.
 *
 * R1-2: the builder family expanded from 6 builders/8-row ceiling to a
 * 24-row feed — movie AND TV micro-genre variants, three keyword rows,
 * multi-seed BYW, watch-it-again, contextual triggers driven by the user's
 * own peak viewing hour, and an opt-in daily-format row.
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

/** R1-2: raised from 8 — Netflix-class feeds need 20–30 rows. */
export const DEFAULT_MAX_ROWS = 24
export const FEED_FLOOR_ROWS = 6
const FEED_CACHE_TTL = 10 * 60 * 1000 // 10 minutes
const MAX_FEED_CACHE_ENTRIES = 200
const feedMemoryCache = new Map<string, { rows: FeedRow[]; timestamp: number }>()

export function invalidateFeedCache(userId: string) {
  for (const key of feedMemoryCache.keys()) {
    if (key.startsWith(`${userId}:`)) feedMemoryCache.delete(key)
  }
}

/**
 * §5.6: serve-log recording is keyed by payload content hash — refreshing a
 * cache-warm feed no longer re-records identical serves (which accelerated
 * 0.85^n demotion for no user-visible reason).
 */
const lastServeHashes = new Map<string, string>()

function feedContentHash(rows: FeedRow[]): string {
  return rows.map((r) => `${r.key}[${r.items.map((i) => `${i.media_type ?? "movie"}:${i.id}`).join(",")}]`).join("|")
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

  const [profile, fatigueByKey, serveLog, rowStats] = await Promise.all([
    getUserDiscoveryProfile(userId, profileId),
    getRowFatigueMap(userId, profileId),
    getServeLog(userId, profileId),
    getRowStatsCached(),
  ])

  // ── Candidate row pool (Module 2, R1-2 scale-out) ──
  let candidates: CandidateRow[]
  if (profile.hasProfile) {
    const [topPicks, microGenre, keywords, seeds, contextual, watchAgain, daily] = await Promise.all([
      buildTopPicksRow(profile, mediaType),
      buildMicroGenreRows(profile, mediaType),
      buildKeywordRows(profile, mediaType),
      buildSeedRows(profile, mediaType),
      buildContextualRows(profile, mediaType, clientHour),
      buildWatchAgainRow(profile, mediaType),
      buildDailyFormatRow(profile, mediaType),
    ])
    candidates = [
      topPicks,
      ...microGenre,
      ...keywords,
      ...seeds,
      ...contextual,
      watchAgain,
      daily,
    ].filter((r): r is CandidateRow => r !== null && r.items.length >= MIN_ROW_ITEMS)
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

  // ── Dense candidate vectors (R2-1): enrich the personalization-bearing
  // rows from the Convex item-feature cache; misses fill in the background
  // for the next build.
  // Performance budget: enrich only the top-picks pool (12 items). The old
  // 5-row × 24-item budget fired up to 120 Convex lookups plus background
  // detail fetches per feed build; the precompute route owns bulk warming.
  await Promise.all(
    candidates
      .filter((row) => row.key === "top-picks")
      .map(async (row) => {
        row.items = await enrichCandidateVectors(row.items, { topN: 12 })
      })
  )

  // ── Tier 1: horizontal item ranking + serve demotion + watched filter ──
  const now = Date.now()
  const rankable = new Map<string, RankableRow>()
  const candidateRowsMap = new Map<string, CandidateRow>()
  const scoredItemsByRow = new Map<string, { item: ScoredRowItem; score: number; sim: number }[]>()

  function processRow(row: CandidateRow): boolean {
    const maxPopularity = Math.max(...row.items.map((i) => i.popularity), 1)
    const isBywRow = row.key.startsWith("byw:")
    const scored = row.items
      .filter((item) => {
        // Hard filter completed items. For BYW rows, allow interacted items if not completed.
        if (profile.completedKeys.has(item.key)) return false
        if (!isBywRow && profile.interactedKeys.has(item.key)) return false
        // §7.1: explicit "Not Interested" hides the item from every row.
        if (profile.hiddenKeys.has(item.key) && row.key !== "watch-it-again") return false
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
          mediaType: row.type,
        })
        const serveEntry = serveLog.get(item.key)
        if (serveEntry && now - serveEntry.lastServedAt < 72 * 60 * 60 * 1000) {
          score *= serveDemotion(serveEntry.count)
        }
        // §1.9: international titles without an English overview are demoted
        // (0.85×), not deleted — the policy is down-rank, never hard-block.
        if (!item.rowItem.overview) score *= 0.85
        return { item, score, sim }
      })

    scored.sort((a, b) => b.score - a.score)
    const ranked = scored.slice(0, ROW_ITEM_LIMIT)
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
    scoredItemsByRow.set(row.key, ranked)
    return true
  }

  for (const row of candidates) {
    if (isRowSuppressed(fatigueByKey.get(row.key))) continue
    processRow(row)
  }

  // ── Feed floor guarantee (minimum 6 rows) ──
  // If rankable rows fall below floor due to suppression or a small candidate
  // pool, evaluate fallback cold-start rows while strictly enforcing suppression
  // (R0-1: never resurrect suppressed rows to fill the floor).
  if (rankable.size < FEED_FLOOR_ROWS) {
    const coldRows = await buildColdStartRows(mediaType)
    for (const row of coldRows) {
      if (rankable.has(row.key)) continue
      if (isRowSuppressed(fatigueByKey.get(row.key))) continue
      processRow(row)
      if (rankable.size >= FEED_FLOOR_ROWS) break
    }
  }

  if (rankable.size === 0) return []

  // ── Tier 2: vertical MMR row ranking (now with UCB1 exploration, §5.3) ──
  const orderedKeys = rankRowsMMR([...rankable.values()], {
    fatigueByKey,
    statsByKey: rowStats,
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
    const scored = scoredItemsByRow.get(key)
    if (!rawRow || !scored) continue

    const dedupedItems = scored.filter((s) => !seenItems.has(s.item.key))
    if (dedupedItems.length < MIN_ROW_ITEMS) continue

    const selectedItems = dedupedItems.slice(0, ROW_ITEM_LIMIT)
    for (const s of selectedItems) {
      seenItems.add(s.item.key)
    }

    finalFeed.push({
      key: rawRow.key,
      title: rawRow.title,
      subtitle: rawRow.subtitle,
      type: rawRow.type,
      items: selectedItems.map((s) => {
        // §7.3: Netflix-style % Match on cards, from the same cosine the
        // ranker already computed. §3.5 honesty: cold-start users have no
        // personal vector — badgeing those rows would be fake personalization.
        if (profile.hasProfile) {
          s.item.rowItem.matchPct = Math.round(50 + (45 * (s.sim + 1)) / 2)
        } else {
          delete s.item.rowItem.matchPct
        }
        return s.item.rowItem
      }),
    })

    if (finalFeed.length >= maxRows) break
  }

  // §7.11 exploration budget: one curated non-personalized slot spliced
  // mid-feed, so the surface keeps introducing content from outside the
  // user's filter bubble (MMR alone exploits; it does not explore).
  if (profile.hasProfile && finalFeed.length >= 6) {
    const coldRows = await buildColdStartRows(mediaType)
    const unexplored = coldRows.find(
      (r) => !finalFeed.some((f) => f.key === r.key) && !isRowSuppressed(fatigueByKey.get(r.key))
    )
    if (unexplored) {
      const explorationItems = unexplored.items
        .filter(
          (i) =>
            !seenItems.has(i.key) &&
            !profile.completedKeys.has(i.key) &&
            !profile.interactedKeys.has(i.key) &&
            !profile.hiddenKeys.has(i.key)
        )
        .slice(0, ROW_ITEM_LIMIT)
      if (explorationItems.length >= MIN_ROW_ITEMS) {
        for (const item of explorationItems) seenItems.add(item.key)
        finalFeed.splice(Math.min(4, finalFeed.length), 0, {
          key: unexplored.key,
          title: unexplored.title,
          subtitle: unexplored.subtitle,
          type: unexplored.type,
          items: explorationItems.map((i) => i.rowItem),
        })
      }
    }
  }

  // Enrich row items with English logo-treated backdrops
  const allRowItems = finalFeed.flatMap((row) => row.items)
  if (allRowItems.length > 0) {
    await enrichMediaItemsWithPosters(allRowItems)
  }

  // §5.6: record serves only when the payload content actually changed.
  const contentHash = feedContentHash(finalFeed)
  const serveDedupeKey = `${userId}:${profileId}`
  if (contentHash !== lastServeHashes.get(serveDedupeKey)) {
    lastServeHashes.set(serveDedupeKey, contentHash)
    const servedItemKeys = finalFeed.flatMap((r) => r.items.map((i) => `${i.media_type ?? "movie"}:${i.id}`))
    void recordServeLog(userId, profileId, servedItemKeys).catch(() => {})
  }

  if (feedMemoryCache.size > MAX_FEED_CACHE_ENTRIES) {
    for (const [k, v] of feedMemoryCache.entries()) {
      if (now - v.timestamp >= FEED_CACHE_TTL) feedMemoryCache.delete(k)
    }
    if (feedMemoryCache.size > MAX_FEED_CACHE_ENTRIES) {
      const overflow = feedMemoryCache.size - MAX_FEED_CACHE_ENTRIES
      const oldest = [...feedMemoryCache.entries()]
        .sort((a, b) => a[1].timestamp - b[1].timestamp)
        .slice(0, overflow)
      for (const [k] of oldest) feedMemoryCache.delete(k)
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
