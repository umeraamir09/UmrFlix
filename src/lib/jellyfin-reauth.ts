import { env } from "./env"
import type { UserSession } from "./auth-crypto"
import { updateSessionToken } from "./session-store"

const reauthCooldowns = new Map<string, number>()
const reauthInFlight = new Map<string, Promise<boolean>>()

const COOLDOWN_MS = 60_000 // 1 minute per server

/**
 * Attempts flag-gated, identity-pinned automated re-authentication with Jellyfin
 * when a 401 is received on an active session.
 */
export async function attemptJellyfinReauth(
  session: UserSession,
  sid: string
): Promise<boolean> {
  if (process.env.JELLYFIN_ENV_REAUTH !== "1") {
    return false
  }

  const username = env("JELLYFIN_USERNAME")
  const password = env("JELLYFIN_PASSWORD")
  if (!username || !password) {
    return false
  }

  const serverUrl = session.serverUrl || env("JELLYFIN_URL") || "http://localhost:8096"
  const now = Date.now()

  // Cooldown check
  const lastAttempt = reauthCooldowns.get(serverUrl) ?? 0
  if (now - lastAttempt < COOLDOWN_MS) {
    return false
  }

  // SingleFlight check
  const inFlight = reauthInFlight.get(serverUrl)
  if (inFlight) {
    return await inFlight
  }

  const promise = (async (): Promise<boolean> => {
    reauthCooldowns.set(serverUrl, Date.now())
    try {
      const res = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Emby-Authorization":
            'MediaBrowser Client="UmrFlix", Device="UmrFlixServerReauth", DeviceId="umrflix-server-reauth", Version="1.0.0"',
        },
        body: JSON.stringify({
          Username: username,
          Pw: password,
        }),
      })

      if (!res.ok) return false

      const data = await res.json()
      const newUserId = data?.User?.Id
      const newAccessToken = data?.AccessToken

      if (!newUserId || !newAccessToken) return false

      // Identity pin check: Must match the session user ID exactly
      if (newUserId !== session.userId) {
        console.warn(`[JellyfinReauth] Identity mismatch! Re-auth user ${newUserId} !== session user ${session.userId}`)
        return false
      }

      // Success: Rotate token in session store
      await updateSessionToken(sid, newAccessToken)
      console.log(`[JellyfinReauth] Successfully re-authenticated user ${session.username}`)
      return true
    } catch (err) {
      console.error("[JellyfinReauth] Exception during re-auth attempt:", err)
      return false
    } finally {
      reauthInFlight.delete(serverUrl)
    }
  })()

  reauthInFlight.set(serverUrl, promise)
  return await promise
}
