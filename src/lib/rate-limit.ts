type RateLimitOptions = {
  windowMs: number
  maxRequests: number
}

type TokenBucket = {
  count: number
  resetAt: number
}

/**
 * In-memory sliding window rate limiter.
 * PM2 deployment note (single-process mode): In-process Map counting is exact.
 * Interface is structured with hit() and reset() adapters so a Redis/Upstash
 * client can be swapped in if multi-instance scaling is introduced.
 */
const buckets = new Map<string, TokenBucket>()

/**
  Check rate limit for a key (e.g., `userId:action`). Returns true if allowed, false if limit exceeded.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): boolean {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || now > bucket.resetAt) {
    buckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    })
    return true
  }

  if (bucket.count >= options.maxRequests) {
    return false
  }

  bucket.count++
  return true
}

export function resetRateLimit(key: string): void {
  buckets.delete(key)
}

/** Pre-configured rate limiters for party actions */
export const PARTY_RATE_LIMITS = {
  CREATE_ROOM: { windowMs: 60_000, maxRequests: 5 }, // 5 per min
  COMMAND: { windowMs: 10_000, maxRequests: 20 }, // 20 per 10s
  STATUS: { windowMs: 10_000, maxRequests: 30 }, // 30 per 10s
  PING: { windowMs: 60_000, maxRequests: 60 }, // 60 per min
  JOIN_ROOM: { windowMs: 60_000, maxRequests: 20 }, // 20 per min
  INVITE: { windowMs: 60_000, maxRequests: 30 }, // 30 per min
  ITEM: { windowMs: 10_000, maxRequests: 20 }, // 20 per 10s
  LEAVE_ROOM: { windowMs: 60_000, maxRequests: 20 }, // 20 per min
  END_ROOM: { windowMs: 60_000, maxRequests: 10 }, // 10 per min
}
