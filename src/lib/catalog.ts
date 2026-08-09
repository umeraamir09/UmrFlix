import type { TmdbMovie, TmdbTvShow } from "./tmdb"

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
 * Quality & relevance filter for catalog surfacing:
 * - Excludes low-rated titles (vote_average < 3.5 when vote_count >= 5)
 * - Excludes non-feature short clips (runtime < 15 mins when runtime is present)
 * - Excludes obscure/unvoted items (voteCount < 10 AND popularity < 1.0) ONLY
 *   when both fields are present and non-zero — items where these fields are
 *   absent (e.g. RowItem from genre catalog) always pass through because quality
 *   was already enforced upstream via TMDB discover params.
 */
export function isQualityContent(item: CatalogItem): boolean {
  // If item is already available in user's library, keep it regardless
  if ('availabilityStatus' in item && item.availabilityStatus) {
    const avail = (item as { availabilityStatus: { status: string } }).availabilityStatus
    if (avail && (avail.status === 'in_library' || avail.status === 'downloading')) {
      return true
    }
  }

  // Filter low ratings (vote_average < 3.5 when vote_count >= 5)
  if ('vote_average' in item && typeof item.vote_average === 'number' && item.vote_average > 0) {
    const voteCount = ('vote_count' in item && typeof item.vote_count === 'number') ? item.vote_count : 0
    if (voteCount >= 5 && item.vote_average < 3.5) {
      return false
    }
  }

  // Runtime check for short clips/promos (runtime < 15 mins)
  if ('runtime' in item && typeof item.runtime === 'number' && item.runtime > 0 && item.runtime < 15) {
    return false
  }

  // Only apply the popularity/vote floor when we actually have meaningful data.
  // vote_count and popularity are optional on RowItem — if they are absent or
  // zero we cannot distinguish "genuinely obscure" from "metadata not shipped",
  // so we pass the item through and rely on upstream TMDB discover filters.
  const hasVoteCount = 'vote_count' in item && typeof item.vote_count === 'number' && (item.vote_count as number) > 0
  const hasPopularity = 'popularity' in item && typeof item.popularity === 'number' && (item.popularity as number) > 0

  if (!hasVoteCount && !hasPopularity) {
    // No quality metadata present — pass through (upstream TMDB params already filtered)
    return true
  }

  const voteCount = hasVoteCount ? (item as { vote_count: number }).vote_count : 0
  const popularity = hasPopularity ? (item as { popularity: number }).popularity : 0

  // Check release date age for obscure / unvoted items
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

    // New release grace window: under 30 days old — allow with minimal popularity
    if (diffDays >= 0 && diffDays <= 30) {
      if (popularity < 1.5 && voteCount < 1) {
        return false
      }
      return true
    }
  }

  // Older releases: require popularity >= 1.0 OR vote_count >= 10
  if (voteCount < 10 && popularity < 1.0) {
    return false
  }

  return true
}

/**
 * Filter to only include items that are ready for display (excludes announced, cinema-only, and obscure/low-rated)
 */
export function filterDisplayableContent<T extends CatalogItem>(
  items: T[],
  options?: { includeCinemas?: boolean }
): T[] {
  const includeCinemas = options?.includeCinemas ?? false
  return items.filter((item) => {
    // Must have poster
    if (!item.poster_path) return false
    // Must have overview description
    if (!item.overview) return false

    if (includeCinemas) {
      if (!isReleased(item)) return false
    } else {
      if (!isReleasedAndAvailable(item)) return false
    }

    if (!isQualityContent(item)) return false

    return true
  })
}

