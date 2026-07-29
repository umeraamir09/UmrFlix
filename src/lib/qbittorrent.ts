import { env } from "./env"

const rawUrl = env("QBITTORRENT_URL") || process.env.QBITTORRENT_URL || ""
const QBIT_URL = rawUrl.trim().replace(/\/+$/, "")
const QBIT_USER = env("QBITTORRENT_USERNAME") || process.env.QBITTORRENT_USERNAME || ""
const QBIT_PASS = env("QBITTORRENT_PASSWORD") || process.env.QBITTORRENT_PASSWORD || ""

let cachedCookie: string | null = null
let lastAuthAttemptTime = 0
const AUTH_COOLDOWN_MS = 15_000 // 15s cooldown if auth fails to avoid spamming

function extractQBitCookie(cookieHeader: string): string | null {
  // Matches QBT_SID, QBT_SID_8081, or SID cookies
  const match = cookieHeader.match(/(QBT_SID[_\w]*=[^;]+|SID=[^;]+)/i)
  if (match) {
    return match[1]
  }
  // Fallback: take first cookie key=value pair
  const firstPart = cookieHeader.split(";")[0]?.trim()
  if (firstPart && firstPart.includes("=")) {
    return firstPart
  }
  return null
}

async function getAuthCookie(): Promise<string | null> {
  if (!QBIT_URL || !QBIT_USER) return null

  const now = Date.now()
  if (now - lastAuthAttemptTime < AUTH_COOLDOWN_MS && !cachedCookie) {
    return null
  }
  lastAuthAttemptTime = now

  try {
    const params = new URLSearchParams()
    params.append("username", QBIT_USER)
    params.append("password", QBIT_PASS)

    const res = await fetch(`${QBIT_URL}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": `${QBIT_URL}/`,
      },
      body: params.toString(),
    })

    if (!res.ok) {
      if (process.env.NODE_ENV === "development") {
        console.warn(`[qBittorrent] Login failed with status: ${res.status} ${res.statusText}`)
      }
      return null
    }

    // Extract cookie from set-cookie header (supports both standard Node fetch & getSetCookie)
    let cookieStr: string | null = null

    const headerVal = res.headers.get("set-cookie")
    if (headerVal) {
      cookieStr = extractQBitCookie(headerVal)
    }

    if (!cookieStr && typeof res.headers.getSetCookie === "function") {
      const cookies = res.headers.getSetCookie()
      for (const c of cookies) {
        const parsed = extractQBitCookie(c)
        if (parsed) {
          cookieStr = parsed
          break
        }
      }
    }

    if (cookieStr) {
      cachedCookie = cookieStr
      return cachedCookie
    }

    return null
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[qBittorrent] Auth login request error:", e instanceof Error ? e.message : e)
    }
    return null
  }
}

async function qbitFetch<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  if (!QBIT_URL) return null
  try {
    if (!cachedCookie && QBIT_USER) {
      await getAuthCookie()
    }

    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string>),
    }

    if (cachedCookie) {
      headers["Cookie"] = cachedCookie
    }

    let res = await fetch(`${QBIT_URL}/api/v2${endpoint}`, {
      ...options,
      headers,
    })

    // If unauthorized (session expired), retry ONCE after re-authenticating
    if ((res.status === 403 || res.status === 401) && QBIT_USER) {
      cachedCookie = null
      const newCookie = await getAuthCookie()
      if (newCookie) {
        headers["Cookie"] = newCookie
        res = await fetch(`${QBIT_URL}/api/v2${endpoint}`, {
          ...options,
          headers,
        })
      }
    }

    if (!res.ok) return null
    return (await res.json()) as T
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[qBittorrent] Fetch ${endpoint} error:`, e instanceof Error ? e.message : e)
    }
    return null
  }
}

export type QBittorrentItem = {
  hash: string
  name: string
  size: number
  progress: number
  dlspeed: number
  upspeed: number
  eta: number
  state: string
  num_seeds: number
  num_leechs: number
  added_on: number
}

export type QBitTransferInfo = {
  dl_info_speed: number
  up_info_speed: number
  dl_info_data: number
  up_info_data: number
  connection_status: string
}

export async function getTorrents(): Promise<QBittorrentItem[]> {
  const result = await qbitFetch<QBittorrentItem[]>("/torrents/info")
  return result ?? []
}

export async function getTransferInfo(): Promise<QBitTransferInfo | null> {
  return qbitFetch<QBitTransferInfo>("/transfer/info")
}

export async function getDiskSpace(): Promise<number | null> {
  const mainData = await qbitFetch<{ server_state?: { free_space_on_disk?: number } }>("/sync/maindata")
  return mainData?.server_state?.free_space_on_disk ?? null
}

export async function pauseTorrents(hashes: string[]): Promise<boolean> {
  if (!hashes.length) return false
  const params = new URLSearchParams()
  params.append("hashes", hashes.join("|"))
  const result = await qbitFetch<unknown>("/torrents/pause", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  return result !== null
}

export async function resumeTorrents(hashes: string[]): Promise<boolean> {
  if (!hashes.length) return false
  const params = new URLSearchParams()
  params.append("hashes", hashes.join("|"))
  const result = await qbitFetch<unknown>("/torrents/resume", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  return result !== null
}

export async function deleteTorrents(hashes: string[], deleteFiles = false): Promise<boolean> {
  if (!hashes.length) return false
  const params = new URLSearchParams()
  params.append("hashes", hashes.join("|"))
  params.append("deleteFiles", deleteFiles ? "true" : "false")
  const result = await qbitFetch<unknown>("/torrents/delete", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  return result !== null
}
