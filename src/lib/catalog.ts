import type { TmdbMovie, TmdbTvShow } from "./tmdb"
import { bayesianRating, meetsEngagementFloor } from "./scoring"
import { isSpamGradeExplicit, suitabilityMultiplier } from "./content-policy"

/**
 * Catalog Filter Utilities
 * Filters out unreleased, announced-only, and cinema-only content across all pages
 */

export type CatalogItem =
  | TmdbMovie
  | TmdbTvShow
  | {
      id?: number
      title?: string
      name?: string
      release_date?: string
      first_air_date?: string
      status?: string
      poster_path?: string | null
      overview?: string
    }

export type ContentStatus =
  | 'Released'
  | 'Announced'
  | 'In Production'
  | 'Post Production'
  | 'Rumored'
  | 'Planned'
  | 'Canceled'
  | 'In Theaters'
  | 'Theatrical'
  | 'Unknown'

const THEATRICAL_WINDOW_DAYS = 30

/**
 * Check if a content status indicates the item is unreleased or announced-only
 */
export function isUnreleasedStatus(status?: string): boolean {
  if (!status) return false
  const s = status.trim().toLowerCase()
  const unreleasedStatuses: Record<string, boolean> = {
    'announced': true,
    'in production': true,
    'post production': true,
    'rumored': true,
    'planned': true,
    'canceled': true,
  }
  return !!unreleasedStatuses[s]
}

/**
 * Check if a movie is currently in the theatrical window ("Only in Cinemas")
 */
export function isOnlyInCinemas(item: CatalogItem): boolean {
  // If item is already available in user's library, it is not cinema-only
  if ('availabilityStatus' in item && item.availabilityStatus) {
    const avail = (
      item as { availabilityStatus: { status: string; progress?: number; jellyfinItemId?: string } }
    ).availabilityStatus
    if (avail.status === 'in_library' || avail.status === 'downloading') {
      return false
    }
  }

  // Explicit status check
  if ('status' in item && typeof item.status === 'string') {
    const s = item.status.trim().toLowerCase()
    if (s === 'in theaters' || s === 'theatrical' || s === 'in cinema' || s === 'cinemas') {
      return true
    }
  }

  // Release date check for movies within the 30-day theatrical window
  const dateStr =
    'release_date' in item && item.release_date
      ? item.release_date
      : 'first_air_date' in item && item.first_air_date
        ? item.first_air_date
        : undefined

  if (dateStr) {
    const releaseDate = new Date(dateStr)
    const today = new Date()
    const diffMs = today.getTime() - releaseDate.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)

    // Future date -> unreleased / announced. This is redundant with isReleased()
    // in the default filter path, but it still matters when includeFutureReleases
    // is set: the item is then treated as cinema-only rather than passable.
    if (releaseDate > today) {
      return true
    }

    // Is it a movie within the 30-day theatrical window? Use a truthy release_date
    // check instead of key presence: recommendation/profile rows always carry a
    // release_date key (value undefined for TV), so 'release_date' in item alone
    // would misclassify TV shows with a recent first_air_date as cinema-only.
    const isMovieItem =
      ('release_date' in item && !!item.release_date) || ('title' in item && !('name' in item))
    if (isMovieItem && diffDays >= 0 && diffDays <= THEATRICAL_WINDOW_DAYS) {
      return true
    }
  }

  return false
}

/**
 * Check if a movie/TV show has a valid release date
 */
export function hasValidReleaseDate(item: CatalogItem): boolean {
  if ('release_date' in item && item.release_date) {
    return item.release_date !== ''
  }
  if ('first_air_date' in item && item.first_air_date) {
    return item.first_air_date !== ''
  }
  return false
}

/**
 * Check if a movie/TV show date has already passed
 */
export function isReleased(item: CatalogItem): boolean {
  if (!hasValidReleaseDate(item)) {
    return false
  }

  const today = new Date()
  if ('release_date' in item && item.release_date) {
    const releaseDate = new Date(item.release_date)
    if (releaseDate > today) return false
  }

  if ('first_air_date' in item && item.first_air_date) {
    const airDate = new Date(item.first_air_date)
    if (airDate > today) return false
  }

  return true
}

/**
 * Check if a movie/TV show is released and available (past cinema-only window & not announced)
 */
export function isReleasedAndAvailable(item: CatalogItem): boolean {
  if (!isReleased(item)) return false
  const status = getContentStatus(item)
  if (isUnreleasedStatus(status)) return false
  if (isOnlyInCinemas(item)) return false
  return true
}

/**
 * Get the content status for display purposes
 */
export function getContentStatus(item: CatalogItem): string {
  if ('status' in item && typeof item.status === 'string') {
    return item.status
  }
  if (hasValidReleaseDate(item) && isReleased(item)) {
    return 'Released'
  }
  return 'Unknown'
}

/**
 * Check if item is fully available (released + not cinema-only + has poster + has overview)
 */
export function isFullyAvailable(item: CatalogItem): boolean {
  return isReleasedAndAvailable(item) && !!item.poster_path && !!item.overview
}

/**
 * Filter out unreleased, announced-only, and cinema-only items
 */
export function filterReleasedContent<T extends CatalogItem>(
  items: T[],
  options?: {
    includeFutureReleases?: boolean
    includeCinemas?: boolean
    includeUnknownStatus?: boolean
  }
): T[] {
  const opts = {
    includeFutureReleases: options?.includeFutureReleases ?? false,
    includeCinemas: options?.includeCinemas ?? false,
    includeUnknownStatus: options?.includeUnknownStatus ?? false,
  }

  return items.filter((item) => {
    // Filter out announced/in-production items
    if (!opts.includeUnknownStatus) {
      const status = getContentStatus(item)
      if (isUnreleasedStatus(status)) {
        return false
      }
    }

    // Filter out items without valid release dates
    if (!hasValidReleaseDate(item)) {
      return false
    }

    // Filter out future releases if not explicitly included
    if (!opts.includeFutureReleases) {
      if (!isReleased(item)) {
        return false
      }
    }

    // Filter out cinema-only releases if not explicitly included
    if (!opts.includeCinemas) {
      if (isOnlyInCinemas(item)) {
        return false
      }
    }

    return true
  })
}

/**
 * Quality & relevance filter for catalog surfacing (R0-3/§1.4 rewrite).
 *
 * One unified Bayesian quality gate shared with the ranking layer:
 * - Excludes spam-grade explicit items (hide-only-spam policy, §1.1)
 * - Excludes genuinely bad titles via the Bayesian weighted rating
 *   (a 2.0★/4-vote flop now regresses to the corpus mean and fails the bar;
 *   the old `vote_count >= 5` guard let it through)
 * - Excludes non-feature short clips (runtime < 15 mins when present)
 * - Excludes items below the engagement floor when vote metadata shipped
 *
 * Items without vote/popularity metadata (e.g. RowItem from genre catalog)
 * pass through — quality was enforced upstream via TMDB discover floors.
 */
export function isQualityContent(item: CatalogItem): boolean {
  // If item is already available in user's library, keep it regardless
  if ('availabilityStatus' in item && item.availabilityStatus) {
    const avail = (item as { availabilityStatus: { status: string } }).availabilityStatus
    if (avail && (avail.status === 'in_library' || avail.status === 'downloading')) {
      return true
    }
  }

  // Content policy (§1.1): hide only spam-grade explicit items; demotion of
  // milder cases happens in the ranking layer via suitabilityMultiplier.
  if (isSpamGradeExplicit({ adult: readFlag(item, 'adult'), title: readString(item, 'title') ?? readString(item, 'name') })) {
    return false
  }

  const voteAverage = readNumber(item, 'vote_average')
  const voteCount = readNumber(item, 'vote_count')
  const popularity = readNumber(item, 'popularity')
  const mediaType: 'movie' | 'tv' = readString(item, 'name') !== undefined ? 'tv' : 'movie'

  // Runtime check for short clips/promos (runtime < 15 mins)
  const runtime = readNumber(item, 'runtime')
  if (runtime !== null && runtime > 0 && runtime < 15) {
    return false
  }

  // Only apply the quality bar when we actually have meaningful data.
  if (voteAverage === null && voteCount === null && popularity === null) {
    // No quality metadata present — pass through (upstream TMDB params already filtered)
    return true
  }

  // Bayesian weighted rating (R0-3): with enough votes, a truly bad title
  // scores well below the corpus mean and is excluded. Thin-voted items
  // regress toward the mean, so only *rated* junk is dropped here — obscure
  // junk is kept out by discover floors instead.
  if (voteCount !== null && voteCount >= 20 && voteAverage !== null) {
    const wr = bayesianRating(voteCount, voteAverage, mediaType)
    if (wr < 5.2) return false
  }

  // Legacy guard retained for thin-voted dailies: a hard sub-3.5 rating with
  // at least 5 votes is junk regardless of the shrinkage target.
  if (voteCount !== null && voteCount >= 5 && voteAverage !== null && voteAverage < 3.5) {
    return false
  }

  if (!meetsEngagementFloor(voteCount, popularity, mediaType)) {
    return false
  }

  // New-release grace window (≤30 days): allow with minimal traction…
  const dateStr =
    'release_date' in item && item.release_date
      ? item.release_date
      : 'first_air_date' in item && item.first_air_date
        ? item.first_air_date
        : undefined
  if (dateStr) {
    const releaseDate = new Date(dateStr)
    const diffDays = (Date.now() - releaseDate.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays >= 0 && diffDays <= 30) {
      if ((popularity ?? 0) < 1.0 && (voteCount ?? 0) < 1) {
        return false
      }
      return true
    }
  }

  return true
}

function readNumber(item: CatalogItem, field: string): number | null {
  if (field in item) {
    const v = (item as unknown as Record<string, unknown>)[field]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function readString(item: CatalogItem, field: string): string | undefined {
  const v = (item as unknown as Record<string, unknown>)[field]
  return typeof v === 'string' ? v : undefined
}

function readFlag(item: CatalogItem, field: string): boolean | null {
  const v = (item as unknown as Record<string, unknown>)[field]
  return typeof v === 'boolean' ? v : null
}

/**
 * Content-suitability multiplier for ranking layers that score items after
 * filtering (audit §1.1 demotion policy).
 */
export function contentSuitability(item: CatalogItem): number {
  return suitabilityMultiplier({
    adult: readFlag(item, 'adult'),
    title: readString(item, 'title') ?? readString(item, 'name'),
  })
}

/**
 * Filter to only include items that are ready for display (excludes announced, cinema-only, and obscure/low-rated)
 *
 * §1.9: `allowMissingOverview` admits international titles whose list payload
 * lacks an English blurb (K-Drama/anime/Bollywood rails). Such items are
 * demoted — never deleted — by the ranking layer instead.
 */
export function filterDisplayableContent<T extends CatalogItem>(
  items: T[],
  options?: { includeCinemas?: boolean; allowMissingOverview?: boolean; includeFutureReleases?: boolean }
): T[] {
  const includeCinemas = options?.includeCinemas ?? false
  const allowMissingOverview = options?.allowMissingOverview ?? false
  const includeFutureReleases = options?.includeFutureReleases ?? false
  return items.filter((item) => {
    // Must have poster
    if (!item.poster_path) return false
    // Must have overview description (unless the surface explicitly accepts
    // international titles without an English blurb yet)
    if (!item.overview && !allowMissingOverview) return false

    if (includeFutureReleases) {
      // §7.8 Coming Soon rails: only a valid date is required — the release
      // window itself is the point of the row.
      if (!hasValidReleaseDate(item)) return false
    } else if (includeCinemas) {
      if (!isReleased(item)) return false
    } else {
      if (!isReleasedAndAvailable(item)) return false
    }

    if (!isQualityContent(item)) return false

    return true
  })
}

