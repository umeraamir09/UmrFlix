/**
 * Unified item quality scoring (audit R0-3 / §1.3, §1.4, §4.4).
 *
 * Single source of truth for "how good is this title" used by:
 *   - discovery engine Tier-1 ranking (ranking.ts)
 *   - the displayability filter (catalog.ts isQualityContent)
 *   - genre-page scoring (genre-profile.ts)
 *   - the legacy recommendation engine (recommendations.ts)
 *
 * Core: IMDb Top-250 style Bayesian weighted rating
 *   WR = (v / (v + m)) · R + (m / (v + m)) · C
 * with C ≈ 6.8 (TMDB corpus mean) and m = 300 (movies) / 100 (TV).
 * Thin-voted items regress toward the corpus mean instead of being gifted a
 * free 0.5 quality score; genuinely bad items score ~0.3–0.5.
 */

export type ScoringMediaKind = "movie" | "tv"

/** Prior vote counts (m): movies need wider evidence before we trust R. */
export const BAYES_PRIOR_VOTES: Record<ScoringMediaKind, number> = {
  movie: 300,
  tv: 100,
}

/** TMDB corpus mean rating (C) — the shrinkage target. */
export const CORPUS_MEAN_RATING = 6.8

/**
 * Bayesian weighted rating on the raw 0–10 scale.
 * Missing/invalid vote data regresses fully to the corpus mean.
 */
export function bayesianRating(
  voteCount: number | null | undefined,
  voteAverage: number | null | undefined,
  mediaType: ScoringMediaKind = "movie"
): number {
  const v = typeof voteCount === "number" && Number.isFinite(voteCount) ? Math.max(0, voteCount) : 0
  const r =
    typeof voteAverage === "number" && Number.isFinite(voteAverage)
      ? Math.min(10, Math.max(0, voteAverage))
      : CORPUS_MEAN_RATING
  const m = BAYES_PRIOR_VOTES[mediaType]
  return (v / (v + m)) * r + (m / (v + m)) * CORPUS_MEAN_RATING
}

/**
 * Normalized 0–1 quality score shared by every ranking dialect.
 * Callers that genuinely have no vote metadata pass undefined/undefined and
 * get the neutral corpus-mean score (~0.68), never an artificial floor.
 */
export function bayesianQualityScore(
  voteCount: number | null | undefined,
  voteAverage: number | null | undefined,
  mediaType: ScoringMediaKind = "movie"
): number {
  return bayesianRating(voteCount, voteAverage, mediaType) / 10
}

/**
 * Engagement floor used by the displayability gate (§1.4): a *hard* bar for
 * items that carry vote metadata, scaled by content type. Dailies/soaps have
 * high day-rate popularity but almost no votes — the vote term is what
 * discriminates.
 */
export function meetsEngagementFloor(
  voteCount: number | null | undefined,
  popularity: number | null | undefined,
  mediaType: ScoringMediaKind = "movie"
): boolean {
  const hasVotes = typeof voteCount === "number" && voteCount > 0
  const hasPop = typeof popularity === "number" && popularity > 0

  // No metadata shipped (RowItem-shaped payloads): defer to upstream discover
  // floors rather than deleting the item (§1.4 deliberate pass-through).
  if (!hasVotes && !hasPop) return true

  const minVotes = mediaType === "tv" ? 10 : 15
  const minPopularity = 1.0
  const votes = hasVotes ? (voteCount as number) : 0
  const pop = hasPop ? (popularity as number) : 0

  return votes >= minVotes || pop >= minPopularity
}
