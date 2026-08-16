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

/** Expired buckets are deleted so the map doesn't grow with every user ever
 *  seen. Called by a background timer and opportunistically when the map
 *  grows large; also exported for direct use in tests. */
export function sweepExpiredBuckets(): number {
  const now = Date.now()
  let removed = 0
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) {
      buckets.delete(key)
      removed++
    }
  }
  lastSweepAt = now
  return removed
}

const SWEEP_INTERVAL_MS = 60_000
const SWEEP_THRESHOLD = 5_000
const SWEEP_COOLDOWN_MS = 10_000

let lastSweepAt = 0

if (typeof window === "undefined") {
  const sweepTimer = setInterval(sweepExpiredBuckets, SWEEP_INTERVAL_MS)
  // Don't keep a Node process alive just for the sweep (tests, scripts)
  sweepTimer.unref?.()
}

/**
  Check rate limit for a key (e.g., `userId:action`). Returns true if allowed, false if limit exceeded.
 */
export function checkRateLimit(key: string, options: RateLimitOptions): boolean {
  const now = Date.now()

  if (buckets.size > SWEEP_THRESHOLD && now - lastSweepAt > SWEEP_COOLDOWN_MS) {
    sweepExpiredBuckets()
  }

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

/** Pre-configured rate limiters for playback and media actions */
export const PLAYBACK_RATE_LIMITS = {
  PLAYBACK_INFO: { windowMs: 10_000, maxRequests: 20 }, // 20 per 10s
  PLAYED: { windowMs: 10_000, maxRequests: 20 }, // 20 per 10s
  PROGRESS: { windowMs: 10_000, maxRequests: 30 }, // 30 per 10s
}

