/**
 * Central TMDB discover quality floors (audit R0-2).
 *
 * TMDB `popularity` is an unbounded, decaying engagement metric: official
 * /discover reference payloads show page-1 values of ~900–9300 (movies) and
 * ~1300–2700 (TV). Historical floors of 1.0–2.0 excluded almost nothing,
 * letting daily soaps / telenovelas (huge day-rate, tiny vote counts) dominate
 * every row. See docs/catalog-audit.md §1.2, §1.6, Appendix A.7.
 *
 * Lanes:
 *  - browse:  default popularity-sorted rails (genre hits, popular, micro-genre,
 *             top-picks pools, decade rows). Baseline bar.
 *  - curated: all-time-best rails sorted by rating (top-rated, acclaimed).
 *             Stricter: junk must be impossible here.
 *  - fresh:   "New & Recent" rails where freshness is the point. Low vote floor,
 *             NO popularity floor (brand-new titles haven't accrued attention),
 *             back-protected by a minimum rating instead.
 *  - niche:   rating-sorted narrow pools (keyword rows, hidden gems) where
 *             moderate obscurity is intentional; vote floor only.
 */

export type MediaKind = "movie" | "tv"

export type QualityLane = "browse" | "curated" | "fresh" | "niche"

export interface QualityFloor {
  voteCountGte: number
  /** null = do not emit a popularity floor for this lane */
  popularityGte: number | null
  /** optional rating backstop (used by the fresh lane) */
  voteAverageGte?: number
}

export const CATALOG_QUALITY_FLOORS: Record<QualityLane, Record<MediaKind, QualityFloor>> = {
  browse: {
    movie: { voteCountGte: 75, popularityGte: 3 },
    tv: { voteCountGte: 30, popularityGte: 3 },
  },
  curated: {
    movie: { voteCountGte: 300, popularityGte: 8 },
    tv: { voteCountGte: 150, popularityGte: 8 },
  },
  fresh: {
    movie: { voteCountGte: 5, popularityGte: null, voteAverageGte: 5.0 },
    tv: { voteCountGte: 3, popularityGte: null, voteAverageGte: 5.0 },
  },
  niche: {
    movie: { voteCountGte: 50, popularityGte: null },
    tv: { voteCountGte: 25, popularityGte: null },
  },
}

/** Floor params for a lane, ready to spread into a discover params object. */
export function qualityFloorParams(lane: QualityLane, mediaType: MediaKind): Record<string, string> {
  const floor = CATALOG_QUALITY_FLOORS[lane][mediaType]
  const out: Record<string, string> = {
    "vote_count.gte": String(floor.voteCountGte),
  }
  if (floor.popularityGte !== null) {
    out["popularity.gte"] = String(floor.popularityGte)
  }
  if (floor.voteAverageGte !== undefined) {
    out["vote_average.gte"] = String(floor.voteAverageGte)
  }
  return out
}

/** Merge floors into `params` with max() semantics — never weakens an existing stricter floor. */
export function withQualityFloors(
  params: Record<string, string>,
  lane: QualityLane,
  mediaType: MediaKind
): Record<string, string> {
  const floor = CATALOG_QUALITY_FLOORS[lane][mediaType]
  const out: Record<string, string> = { ...params }

  const existingVoteCount = out["vote_count.gte"] !== undefined ? Number.parseFloat(out["vote_count.gte"]) : null
  if (existingVoteCount !== null && !Number.isNaN(existingVoteCount)) {
    out["vote_count.gte"] = String(Math.max(existingVoteCount, floor.voteCountGte))
  } else {
    out["vote_count.gte"] = String(floor.voteCountGte)
  }

  if (floor.popularityGte !== null) {
    const existingPop = out["popularity.gte"] !== undefined ? Number.parseFloat(out["popularity.gte"]) : null
    if (existingPop !== null && !Number.isNaN(existingPop)) {
      out["popularity.gte"] = String(Math.max(existingPop, floor.popularityGte))
    } else {
      out["popularity.gte"] = String(floor.popularityGte)
    }
  }

  if (floor.voteAverageGte !== undefined) {
    const existingAvg = out["vote_average.gte"] !== undefined ? Number.parseFloat(out["vote_average.gte"]) : null
    if (existingAvg !== null && !Number.isNaN(existingAvg)) {
      out["vote_average.gte"] = String(Math.max(existingAvg, floor.voteAverageGte))
    } else {
      out["vote_average.gte"] = String(floor.voteAverageGte)
    }
  }

  return out
}

/**
 * Defense-in-depth clamp for the /api/tmdb/discover proxy: raise-or-set
 * vote_count.gte / popularity.gte to the browse baseline. Client callers can
 * only ever be as strict as — never looser than — the browse bar.
 */
export function clampToBrowseMinimums(
  params: Record<string, string>,
  mediaType: MediaKind
): Record<string, string> {
  return withQualityFloors(params, "browse", mediaType)
}
