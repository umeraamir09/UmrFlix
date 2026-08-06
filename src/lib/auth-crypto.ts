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

let cachedKeyPromise: Promise<CryptoKey> | null = null

function getSecretSeed(): string {
  const secret = process.env.SESSION_SECRET
  if (secret && secret.trim().length > 0) {
    return secret.trim()
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Fatal Auth Error] SESSION_SECRET environment variable is missing in production. " +
        "Set SESSION_SECRET in your environment or .env.local to secure session encryption."
    )
  }

  if (typeof window === "undefined") {
    console.warn(
      "[auth] Warning: SESSION_SECRET is missing. Using development fallback key. " +
        "Define SESSION_SECRET in .env.local for production."
    )
  }

  return process.env.JELLYFIN_URL || "umrflix-secret-key-default-32bytes!"
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKeyPromise) return cachedKeyPromise

  cachedKeyPromise = (async () => {
    const seed = getSecretSeed()
    const encoder = new TextEncoder()
    const keyData = encoder.encode(seed)
    const hash = await crypto.subtle.digest("SHA-256", keyData)
    return crypto.subtle.importKey(
      "raw",
      hash,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    )
  })()

  return cachedKeyPromise
}

export async function encryptSessionToken(session: UserSession): Promise<string> {
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

  return Buffer.from(combined).toString("base64url")
}

export async function decryptSessionToken(token: string): Promise<UserSession | null> {
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
