import type { TmdbMovie, TmdbTvShow } from "./tmdb"

/**
 * Catalog Filter Utilities
 * Filters out unreleased, announced-only, and unavailable content
 */

export type CatalogItem = TmdbMovie | TmdbTvShow

export type ContentStatus = 'Released' | 'Announced' | 'In Production' | 'Post Production' | 'Rumored' | 'Planned' | 'Canceled' | 'Unknown'

/**
 * Check if a content status indicates the item is not yet available
 */
export function isUnreleasedStatus(status?: string): boolean {
  if (!status) return true // Unknown status, filter out
  const statuses: Record<string, boolean> = {
    'Announced': true,
    'In Production': true,
    'Post Production': true,
    'Rumored': true,
    'Planned': true,
    'Canceled': true,
  }
  return !!statuses[status]
}

/**
 * Check if a movie/TV show has a valid release date
 */
export function hasValidReleaseDate(item: CatalogItem): boolean {
  if ('release_date' in item) {
    return !!item.release_date && item.release_date !== ''
  }
  if ('first_air_date' in item) {
    return !!item.first_air_date && item.first_air_date !== ''
  }
  return false
}

/**
 * Check if a movie/TV show is actually released or available
 */
export function isReleased(item: CatalogItem): boolean {
  // Must have a release date
  if (!hasValidReleaseDate(item)) {
    return false
  }
  
  // Check for content that's marked as released but future-dated
  const today = new Date()
  if ('release_date' in item && item.release_date) {
    const releaseDate = new Date(item.release_date)
    if (releaseDate > today) {
      return false
    }
  }
  
  if ('first_air_date' in item && item.first_air_date) {
    const airDate = new Date(item.first_air_date)
    if (airDate > today) {
      return false
    }
  }
  
  return true
}

/**
 * Filter out unreleased, announced-only, and unavailable items
 * 
 * This function removes:
 * - Items with unreleased statuses (Announced, In Production, etc.)
 * - Items without valid release dates
 * - Items with future release dates (not yet available)
 */
export function filterReleasedContent<T extends CatalogItem>(items: T[], options?: {
  includeFutureReleases?: boolean
  includeUnknownStatus?: boolean
}): T[] {
  const opts = {
    includeFutureReleases: options?.includeFutureReleases ?? false,
    includeUnknownStatus: options?.includeUnknownStatus ?? false,
  }
  
  return items.filter(item => {
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
    
    return true
  })
}

/**
 * Get the content status for display purposes
 */
export function getContentStatus(item: CatalogItem): string {
  // Type guard for status property
  if ('status' in item && typeof item.status === 'string') {
    return item.status
  }
  // Default to Released if no status but has a valid release date
  if (hasValidReleaseDate(item) && isReleased(item)) {
    return 'Released'
  }
  return 'Unknown'
}

/**
 * Check if item is fully available (released + has poster + has overview)
 */
export function isFullyAvailable(item: CatalogItem): boolean {
  return isReleased(item) && !!item.poster_path && !!item.overview
}

/**
 * Filter to only include items that are ready for display
 */
export function filterDisplayableContent<T extends CatalogItem>(items: T[]): T[] {
  return items.filter(item => {
    // Must be released
    if (!isReleased(item)) return false
    // Must have poster
    if (!item.poster_path) return false
    // Must have some description
    if (!item.overview) return false
    return true
  })
}
