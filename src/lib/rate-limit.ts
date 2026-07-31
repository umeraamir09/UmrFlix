type RateLimitOptions = {
  windowMs: number
  maxRequests: number
}

type TokenBucket = {
  count: number
  resetAt: number
}

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

/** Pre-configured rate limiters for party actions */
export const PARTY_RATE_LIMITS = {
  CREATE_ROOM: { windowMs: 60_000, maxRequests: 5 }, // 5 per min
  COMMAND: { windowMs: 10_000, maxRequests: 20 }, // 20 per 10s
  STATUS: { windowMs: 10_000, maxRequests: 30 }, // 30 per 10s
  PING: { windowMs: 60_000, maxRequests: 60 }, // 60 per min
}
