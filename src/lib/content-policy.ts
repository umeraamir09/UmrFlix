/**
 * Content suitability policy (audit R0-4 / §1.1, §1.6, §1.7).
 *
 * Product decision: quality/explicit **demotion** (down-rank first, hide only
 * spam-grade items) rather than hard global blocking — explicit titles remain
 * findable via search but vanish from browsed and personalized rows.
 *
 * Layers:
 *   1. TMDB `adult` flag — demoted to a near-zero multiplier everywhere the
 *      flag is present on list payloads (trending/discover/recommendations).
 *   2. Keyword denylist — demoted TMDB keyword names/ids matched against
 *      cached item keywords (resolved via profile.ts detailToItemProfile).
 *   3. Title denylist — cheap regex over display titles.
 *   4. Certification ladder — NC-17 (movies) / TV-MA (TV) demotion when the
 *      per-item US rating is known; per-profile maturity ceilings (R2-4)
 *      translate into discover certification params.
 *   5. TV format policy — general TV rows bias to scripted content
 *      (`with_type=2|4`); dailies/soaps/talk/news only surface in their own
 *      opt-in rows when the user's taste vector actually favors dim 19.
 *
 * Pure module: no IO, safe for client and server imports.
 */

export type PolicyMediaKind = "movie" | "tv"

// ── 1. TMDB adult flag ──

/** Near-zero multiplier: adult-flagged items sink below every quality floor. */
export const ADULT_DEMOTION = 0.05

// ── 2. Keyword denylist ──

/**
 * Demoted TMDB keyword names (normalized lowercase). Split into tiers so a
 * stray "erotic thriller" keyword does not nuke a mainstream title as hard as
 * an actual sexploitation film.
 */
const STRONG_DEMOTED_KEYWORDS = new Set([
  "pornographic",
  "pornography",
  "hardcore sex",
  "hardcore pornography",
  "softcore",
  "sexploitation",
  "women in prison", // notorious soft-exploitation subgenre on TMDB
])

const MILD_DEMOTED_KEYWORDS = new Set([
  "erotic",
  "erotic drama",
  "erotic thriller",
  "erotic fantasy",
  "erotic horror",
  "erotica",
  "soft sex scene",
  "explicit sex",
  "sex scene",
])

/**
 * Demoted TMDB keyword IDs (verification-safe subset; name matching is the
 * primary path because ids drift far more than names).
 */
export const DEMOTED_KEYWORD_IDS: ReadonlySet<number> = new Set([
  207317, // sexploitation
  155477, // erotic thriller
  187594, // softcore
])

export const STRONG_KEYWORD_DEMOTION = 0.05
export const MILD_KEYWORD_DEMOTION = 0.55

// ── 3. Title denylist ──

const TITLE_DENYLIST_RE =
  /\b(porn|porno|xxx|sexploitation|softcore|hardcore|erotic|erotica)\b/i

// ── 4. Certification ladder ──

/** Ordered US movie certifications, most to least mature. */
export const MOVIE_MATURITY_LADDER = ["NC-17", "R", "PG-13", "PG", "G"] as const
/** Ordered US TV ratings, most to least mature. */
export const TV_MATURITY_LADDER = ["TV-MA", "TV-14", "TV-PG", "TV-G", "TV-Y7", "TV-Y"] as const

export const DEMOTED_CERTIFICATIONS = new Set(["NC-17", "TV-MA"])
export const CERTIFICATION_DEMOTION = 0.5

export type MaturityCeiling =
  | "all-ages" // G / PG / TV-G / TV-Y(7) + TV-PG
  | "teen" // PG-13 / TV-14
  | "mature" // R (movies only; TV capped at TV-14)
  | "unrestricted"

/** Discover params enforcing a movie maturity ceiling (certification.lte). */
export function movieMaturityParams(ceiling: MaturityCeiling): Record<string, string> {
  if (ceiling === "unrestricted") return {}
  const max =
    ceiling === "all-ages" ? "PG" : ceiling === "teen" ? "PG-13" : /* mature */ "R"
  return { certification_country: "US", "certification.lte": max }
}

/**
 * TV maturity ceiling. TMDB discover has no `content_ratings.lte` filter, so
 * TV ceilings demote at scoring time via known per-item ratings instead of
 * filtering at fetch time; this helper exists so the policy stays centralized.
 */
export function tvMaturityCeilingAllows(ceiling: MaturityCeiling, usTvRating?: string | null): boolean {
  if (ceiling === "unrestricted" || !usTvRating) return true
  const rank = (r: string) => TV_MATURITY_LADDER.indexOf(r as (typeof TV_MATURITY_LADDER)[number])
  const itemRank = rank(usTvRating)
  if (itemRank === -1) return true
  if (ceiling === "mature") return usTvRating !== "TV-MA"
  if (ceiling === "teen") return itemRank >= rank("TV-14")
  return itemRank >= rank("TV-PG")
}

// ── 5. TV format policy ──

/**
 * General TV rows request scripted/miniseries content only — this excludes
 * daily soaps, talk shows, news and reality by construction (audit §1.6).
 * TMDB `with_type`: 2 = Miniseries, 4 = Scripted.
 */
export function scriptedTvParams(): Record<string, string> {
  return { with_type: "2|4" }
}

/**
 * The opt-in daily/unscripted row: Reality | Soap | Talk | News genre ids
 * (pipe = OR). Surfaced only when the user's vector favors dim 19.
 */
export const DAILY_TV_GENRES = "10764|10766|10767|10763"

/** TMDB ids of the unscripted TV genres (Reality, Soap, Talk, News). */
export const UNSCRIPTED_TV_GENRE_IDS = [10764, 10766, 10767, 10763]

// ── Demotion multiplier ──

export type PolicyInput = {
  /** TMDB `adult` flag from list/detail payloads. */
  adult?: boolean | null
  title?: string | null
  /** Cached TMDB keyword names for the item (detail-resolved). */
  keywordNames?: readonly string[] | null
  /** US certification ("R", "NC-17") or TV content rating ("TV-MA"). */
  certification?: string | null
}

/**
 * Unified suitability multiplier in (0, 1]: 1 = unaffected, lower = demoted.
 * Multipliers multiply — an adult-flagged item with an explicit keyword sinks
 * to near zero while a single mild signal only costs ~45%.
 */
export function suitabilityMultiplier(input: PolicyInput): number {
  let mult = 1

  if (input.adult === true) mult *= ADULT_DEMOTION

  const keywords = (input.keywordNames ?? []).map((k) => k.trim().toLowerCase())
  for (const kw of keywords) {
    if (STRONG_DEMOTED_KEYWORDS.has(kw)) {
      mult *= STRONG_KEYWORD_DEMOTION
    } else if (MILD_DEMOTED_KEYWORDS.has(kw)) {
      mult *= MILD_KEYWORD_DEMOTION
    }
  }

  if (input.title && TITLE_DENYLIST_RE.test(input.title)) mult *= MILD_KEYWORD_DEMOTION

  if (input.certification && DEMOTED_CERTIFICATIONS.has(input.certification.toUpperCase())) {
    mult *= CERTIFICATION_DEMOTION
  }

  return mult
}

/** True when the item should be *hidden* (spam-grade), not just demoted. */
export function isSpamGradeExplicit(input: PolicyInput): boolean {
  return suitabilityMultiplier(input) <= ADULT_DEMOTION * STRONG_KEYWORD_DEMOTION + 1e-9
}

// ── Certification extraction (detail payloads) ──

type MovieReleaseDates = {
  results?: { iso_3166_1: string; release_dates?: { certification: string; type: number }[] }[]
}
type TvContentRatings = { results?: { iso_3166_1: string; rating: string }[] }

/** Primary US theatrical certification from `/movie/{id}/release_dates`. */
export function usMovieCertification(payload: MovieReleaseDates | null | undefined): string | null {
  const us = payload?.results?.find((r) => r.iso_3166_1 === "US")
  if (!us) return null
  const entries = (us.release_dates ?? []).filter((d) => d.certification)
  // Type 3 = original theatrical release; fall back to any certified entry.
  const theatrical = entries.find((d) => d.type === 3) ?? entries[0]
  return theatrical?.certification ?? null
}

/** US TV rating from `/tv/{id}/content_ratings`. */
export function usTvRating(payload: TvContentRatings | null | undefined): string | null {
  const us = payload?.results?.find((r) => r.iso_3166_1 === "US")
  return us?.rating ?? null
}

// ── Trending curation (§1.7) ──

export type CurateInput = {
  id: number
  popularity?: number | null
  voteAverage?: number | null
  voteCount?: number | null
  adult?: boolean | null
  title?: string | null
  name?: string | null
  posterPath?: string | null
  backdropPath?: string | null
}

/**
 * Shared post-filter for raw `/trending/*` results: drops poster-less and
 * adult items, demotes explicit-suspect titles, and stable-sorts the rest by
 * (demoted) Bayesian quality × attention. Applied at every trending consumer
 * (hero, static rows, legacy recs, cold rows) because `/trending` accepts no
 * quality filters server-side.
 */
export function curateTrending<T extends CurateInput>(items: readonly T[]): T[] {
  return items
    .filter((item) => item.posterPath !== null && item.posterPath !== undefined)
    .filter((item) => item.adult !== true)
    .map((item) => {
      const displayTitle = item.title ?? item.name ?? ""
      // No keywords on trending payloads — title + adult checks only.
      const mult = suitabilityMultiplier({ adult: item.adult, title: displayTitle })
      const quality = item.voteAverage ?? 0
      const attention = Math.log(1 + Math.max(0, item.popularity ?? 0))
      return { item, score: mult * quality * attention }
    })
    .filter(({ item }) => (item.voteCount ?? 0) >= 5 || (item.popularity ?? 0) >= 3)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
}
