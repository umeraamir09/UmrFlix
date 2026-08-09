import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"
import type { UserSession } from "./auth-crypto"

type QueryRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"query", "public", Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"mutation", "public", Args, Ret>

type SessionRecord = {
  sid: string
  userId: string
  sessionDataJson: string
  expiresAt: number
} | null

const getSessionRef = "sessions:getSession" as unknown as QueryRef<{ sid: string }, SessionRecord>
const storeSessionRef = "sessions:storeSession" as unknown as MutationRef<{ sid: string; userId: string; sessionDataJson: string; ttlMs?: number }, void>
const touchSessionRef = "sessions:touchSession" as unknown as MutationRef<{ sid: string }, void>
const removeSessionRef = "sessions:removeSession" as unknown as MutationRef<{ sid: string }, void>
const removeAllUserSessionsRef = "sessions:removeAllUserSessions" as unknown as MutationRef<{ userId: string }, void>
const updateSessionTokenRef = "sessions:updateSessionToken" as unknown as MutationRef<{ sid: string; newAccessToken: string }, void>

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const TOUCH_THROTTLE_MS = 10 * 60 * 1000 // 10 minutes
const CONVEX_TIMEOUT_MS = 1500 // 1.5 seconds max for miss lookup

type CacheItem = {
  session: UserSession
  expiresAt: number
  lastTouched: number
}

// In-process LRU Map for O(1) fast-path session verification
class LRUSessionMap {
  private max: number
  private map: Map<string, CacheItem>

  constructor(max = 10000) {
    this.max = max
    this.map = new Map()
  }

  get(sid: string): CacheItem | undefined {
    const item = this.map.get(sid)
    if (item) {
      // Refresh key position for LRU eviction
      this.map.delete(sid)
      this.map.set(sid, item)
    }
    return item
  }

  set(sid: string, item: CacheItem): void {
    if (this.map.has(sid)) {
      this.map.delete(sid)
    } else if (this.map.size >= this.max) {
      const firstKey = this.map.keys().next().value
      if (firstKey) this.map.delete(firstKey)
    }
    this.map.set(sid, item)
  }

  delete(sid: string): void {
    this.map.delete(sid)
  }

  deleteUser(userId: string): void {
    for (const [sid, item] of this.map.entries()) {
      if (item.session.userId === userId) {
        this.map.delete(sid)
      }
    }
  }
}

const globalForSessions = globalThis as unknown as {
  sessionCache?: LRUSessionMap
}

const cache = globalForSessions.sessionCache ?? new LRUSessionMap()
if (process.env.NODE_ENV !== "production") globalForSessions.sessionCache = cache

function getConvexClient(): ConvexHttpClient | null {
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL
  if (!url) return null
  try {
    return new ConvexHttpClient(url, { skipConvexDeploymentUrlCheck: true })
  } catch {
    return null
  }
}

function generateSid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Buffer.from(bytes).toString("base64url")
}

export async function createSession(session: UserSession): Promise<string> {
  const sid = generateSid()
  const now = Date.now()
  const expiresAt = now + NINETY_DAYS_MS

  cache.set(sid, {
    session,
    expiresAt,
    lastTouched: now,
  })

  const convex = getConvexClient()
  if (convex) {
    // Write-through to Convex asynchronously (or non-blocking)
    convex
      .mutation(storeSessionRef, {
        sid,
        userId: session.userId,
        sessionDataJson: JSON.stringify(session),
        ttlMs: NINETY_DAYS_MS,
      })
      .catch((err) => console.error("[session-store] Convex storeSession error:", err))
  }

  return sid
}

export async function getSessionBySid(sid: string): Promise<UserSession | null> {
  if (!sid) return null
  const now = Date.now()

  // 1. Hot path: Check in-memory LRU cache
  const cached = cache.get(sid)
  if (cached) {
    if (cached.expiresAt <= now) {
      cache.delete(sid)
      return null
    }

    // Touch session if throttle window elapsed
    if (now - cached.lastTouched > TOUCH_THROTTLE_MS) {
      cached.lastTouched = now
      cached.expiresAt = now + NINETY_DAYS_MS
      const convex = getConvexClient()
      if (convex) {
        convex
          .mutation(touchSessionRef, { sid })
          .catch((err) => console.error("[session-store] Convex touchSession error:", err))
      }
    }

    return cached.session
  }

  // 2. Miss path: Query Convex with 1.5s timeout for restart survival
  const convex = getConvexClient()
  if (!convex) return null

  try {
    const fetchPromise = convex.query(getSessionRef, { sid })
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), CONVEX_TIMEOUT_MS)
    )

    const result = await Promise.race([fetchPromise, timeoutPromise])
    if (!result) return null

    const sessionData = JSON.parse(result.sessionDataJson) as UserSession

    // Populate hot LRU cache
    cache.set(sid, {
      session: sessionData,
      expiresAt: result.expiresAt,
      lastTouched: now,
    })

    return sessionData
  } catch (err) {
    console.error("[session-store] Convex miss lookup failed:", err)
    return null
  }
}

export async function revokeSession(sid: string): Promise<void> {
  if (!sid) return
  cache.delete(sid)

  const convex = getConvexClient()
  if (convex) {
    convex
      .mutation(removeSessionRef, { sid })
      .catch((err) => console.error("[session-store] Convex removeSession error:", err))
  }
}

export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  if (!userId) return
  cache.deleteUser(userId)

  const convex = getConvexClient()
  if (convex) {
    convex
      .mutation(removeAllUserSessionsRef, { userId })
      .catch((err) => console.error("[session-store] Convex removeAllUserSessions error:", err))
  }
}

export async function updateSessionToken(sid: string, newAccessToken: string): Promise<void> {
  if (!sid || !newAccessToken) return
  const now = Date.now()

  const cached = cache.get(sid)
  if (cached) {
    cached.session.accessToken = newAccessToken
    cached.lastTouched = now
    cached.expiresAt = now + NINETY_DAYS_MS
  }

  const convex = getConvexClient()
  if (convex) {
    convex
      .mutation(updateSessionTokenRef, { sid, newAccessToken })
      .catch((err) => console.error("[session-store] Convex updateSessionToken error:", err))
  }
}
