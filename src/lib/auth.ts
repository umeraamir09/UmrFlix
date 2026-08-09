import { cookies } from "next/headers"
import { COOKIE_NAME, type UserSession } from "./auth-crypto"
import {
  createSession,
  getSessionBySid,
  revokeSession,
} from "./session-store"

export type { UserSession }
export { COOKIE_NAME }

export async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    if (!cookie?.value) return null
    return await getSessionBySid(cookie.value)
  } catch {
    return null
  }
}

export async function setSessionCookie(session: UserSession): Promise<void> {
  const sid = await createSession(session)
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90, // 90 days
  })
}

export async function clearSessionCookie(): Promise<void> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    if (cookie?.value) {
      await revokeSession(cookie.value)
    }
    cookieStore.set(COOKIE_NAME, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    })
  } catch {
    /* ignore cookie clearance errors */
  }
}
