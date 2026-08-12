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
// Always pin to globalThis so the LRU survives across requests in the same
// Node process (production or dev). Without this, every module evaluation
// creates a fresh empty map — sessions are never found in the hot path,
// falling through to Convex on every /api/auth/me call.
globalForSessions.sessionCache = cache

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
    // Await the write-through so the SID is durable in Convex before we
    // return. A fire-and-forget write races with the browser's immediate
    // /api/auth/me check on the next page load — if Convex hasn't committed
    // yet, the session lookup returns invalid and kicks the user back to /login.
    await convex
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

export function isValidSidFormat(sid: string): boolean {
  return typeof sid === "string" && /^[A-Za-z0-9_-]{43}$/.test(sid)
}

export type SessionLookupResult =
  | { status: "valid"; session: UserSession }
  | { status: "invalid" }
  | { status: "error" }

export async function getSessionWithStatus(sid: string): Promise<SessionLookupResult> {
  if (!isValidSidFormat(sid)) return { status: "invalid" }
  const now = Date.now()

  // 1. Hot path: Check in-memory LRU cache
  const cached = cache.get(sid)
  if (cached) {
    if (cached.expiresAt <= now) {
      cache.delete(sid)
      return { status: "invalid" }
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

    return { status: "valid", session: cached.session }
  }

  // 2. Miss path: Query Convex with 1.5s timeout for restart survival
  const convex = getConvexClient()
  if (!convex) return { status: "invalid" }

  try {
    const TIMEOUT_SENTINEL = Symbol("TIMEOUT")
    let timerId: NodeJS.Timeout | undefined
    const fetchPromise = convex.query(getSessionRef, { sid })
    const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
      timerId = setTimeout(() => resolve(TIMEOUT_SENTINEL), CONVEX_TIMEOUT_MS)
    })

    const result = await Promise.race([fetchPromise, timeoutPromise])
    if (timerId) clearTimeout(timerId)

    if (result === TIMEOUT_SENTINEL) {
      console.warn("[session-store] Convex miss lookup timed out for SID")
      return { status: "error" }
    }

    if (!result || result.expiresAt <= now) {
      return { status: "invalid" }
    }

    const sessionData = JSON.parse(result.sessionDataJson) as UserSession

    // Populate hot LRU cache
    cache.set(sid, {
      session: sessionData,
      expiresAt: result.expiresAt,
      lastTouched: now,
    })

    return { status: "valid", session: sessionData }
  } catch (err) {
    console.error("[session-store] Convex miss lookup failed:", err)
    return { status: "error" }
  }
}

export async function getSessionBySid(sid: string): Promise<UserSession | null> {
  const result = await getSessionWithStatus(sid)
  return result.status === "valid" ? result.session : null
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
