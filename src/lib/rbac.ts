import { UserSession } from "./auth"

export const DEFAULT_KIDS_PARENTAL_RATING = "PG-13"
export const DAILY_REQUEST_LIMIT = 5

export function isAdminUser(session: UserSession | null): boolean {
  if (!session) return false
  return session.isAdmin === true
}

export function canMakeRequest(session: UserSession | null): { allowed: boolean; reason?: string } {
  if (!session) {
    return { allowed: false, reason: "Authentication required to submit requests." }
  }

  // Admin users have unlimited requests
  if (session.isAdmin) {
    return { allowed: true }
  }

  if (session.enableDownloading === false) {
    return { allowed: false, reason: "Your Jellyfin account does not have download permissions." }
  }

  const today = new Date().toISOString().split("T")[0]
  const lastReset = session.lastRequestResetDate ?? today
  const currentCount = lastReset === today ? (session.dailyRequestsCount ?? 0) : 0

  if (currentCount >= DAILY_REQUEST_LIMIT) {
    return {
      allowed: false,
      reason: `Daily request limit reached (${DAILY_REQUEST_LIMIT} requests per day). Please try again tomorrow.`,
    }
  }

  return { allowed: true }
}

export function incrementRequestCount(session: UserSession): UserSession {
  const today = new Date().toISOString().split("T")[0]
  const lastReset = session.lastRequestResetDate ?? today
  const currentCount = lastReset === today ? (session.dailyRequestsCount ?? 0) : 0

  return {
    ...session,
    lastRequestResetDate: today,
    dailyRequestsCount: currentCount + 1,
  }
}

/**
 * Checks if a content rating exceeds parental restriction.
 * Common ratings: G, PG, PG-13, R, NC-17, TV-Y, TV-G, TV-PG, TV-14, TV-MA.
 */
const RATING_HIERARCHY: Record<string, number> = {
  G: 1,
  "TV-G": 1,
  "TV-Y": 1,
  PG: 2,
  "TV-Y7": 2,
  "TV-PG": 2,
  "PG-13": 3,
  "TV-14": 3,
  R: 4,
  "TV-MA": 4,
  "NC-17": 5,
}

export function isContentAllowedForUser(contentRating: string | undefined | null, userMaxRating: string | null): boolean {
  if (!userMaxRating) return true // No restriction
  if (!contentRating) return true // Unrated / Unknown defaults to allow unless strict

  const maxLevel = RATING_HIERARCHY[userMaxRating.toUpperCase()] ?? 3
  const contentLevel = RATING_HIERARCHY[contentRating.toUpperCase()] ?? 3

  return contentLevel <= maxLevel
}
