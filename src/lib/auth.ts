import { cookies } from "next/headers"
import { env } from "./env"

export type UserSession = {
  userId: string
  username: string
  accessToken: string
  isAdmin: boolean
  enableDownloading: boolean
  maxParentalRating: string | null
  serverUrl: string
  avatarUrl?: string
  dailyRequestsCount?: number
  lastRequestResetDate?: string
}

export const COOKIE_NAME = "umrflix_session"
const SECRET_SEED = process.env.SESSION_SECRET || env("JELLYFIN_URL") || "umrflix-secret-key-default-32bytes!"

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(SECRET_SEED)
  const hash = await crypto.subtle.digest("SHA-256", keyData)
  return crypto.subtle.importKey(
    "raw",
    hash,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  )
}

export async function encryptSession(session: UserSession): Promise<string> {
  const key = await getEncryptionKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoder = new TextEncoder()
  const encodedData = encoder.encode(JSON.stringify(session))

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodedData
  )

  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(ciphertext), iv.length)

  // Convert to base64url
  return Buffer.from(combined).toString("base64url")
}

export async function decryptSession(token: string): Promise<UserSession | null> {
  try {
    const key = await getEncryptionKey()
    const combined = Buffer.from(token, "base64url")
    if (combined.length < 13) return null

    const iv = combined.subarray(0, 12)
    const ciphertext = combined.subarray(12)

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    )

    const decoder = new TextDecoder()
    const jsonStr = decoder.decode(decrypted)
    return JSON.parse(jsonStr) as UserSession
  } catch {
    return null
  }
}

export async function getSession(): Promise<UserSession | null> {
  try {
    const cookieStore = await cookies()
    const cookie = cookieStore.get(COOKIE_NAME)
    if (!cookie?.value) return null
    return await decryptSession(cookie.value)
  } catch {
    return null
  }
}

export async function setSessionCookie(session: UserSession): Promise<void> {
  const token = await encryptSession(session)
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
