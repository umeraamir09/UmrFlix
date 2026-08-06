import { cookies } from "next/headers"
import {
  COOKIE_NAME,
  encryptSessionToken,
  decryptSessionToken,
  type UserSession,
} from "./auth-crypto"

export type { UserSession }
export { COOKIE_NAME, encryptSessionToken, decryptSessionToken }

// Aliases for compatibility
export const encryptSession = encryptSessionToken
export const decryptSession = decryptSessionToken

export async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    if (!cookie?.value) return null
    return await decryptSessionToken(cookie.value)
  } catch {
    return null
  }
}

export async function setSessionCookie(session: UserSession): Promise<void> {
  const token = await encryptSessionToken(session)
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  })
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  })
}
