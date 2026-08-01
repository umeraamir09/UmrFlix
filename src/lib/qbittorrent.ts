import { env } from "./env"

function getQbitConfig() {
  const rawUrl = env("QBITTORRENT_URL")
  const username = env("QBITTORRENT_USERNAME")
  const password = env("QBITTORRENT_PASSWORD")
  return {
    url: rawUrl?.trim().replace(/\/+$/, "") ?? "",
    username: username ?? "",
    password: password ?? "",
  }
}

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
  const { url, username, password } = getQbitConfig()
  if (!url || !username) return null

  const now = Date.now()
  if (now - lastAuthAttemptTime < AUTH_COOLDOWN_MS && !cachedCookie) {
    return null
  }
  lastAuthAttemptTime = now

  try {
    const params = new URLSearchParams()
    params.append("username", username)
    params.append("password", password)

    const res = await fetch(`${url}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": `${url}/`,
      },
      body: params.toString(),
    })

    if (!res.ok) {
      console.error(`[qBittorrent] Login failed with status: ${res.status} ${res.statusText}`)
      return null
    }

    // Extract cookie from set-cookie header (supports both standard Node fetch & getSetCookie)
    let cookieStr: string | null = null

    if (typeof res.headers.getSetCookie === "function") {
      const cookies = res.headers.getSetCookie()
      for (const c of cookies) {
        const parsed = extractQBitCookie(c)
        if (parsed) {
          cookieStr = parsed
          break
        }
      }
    }

    if (!cookieStr) {
      // `get("set-cookie")` throws in undici when multiple set-cookie headers
      // are present; the getSetCookie() branch above already handles those.
      try {
        const headerVal = res.headers.get("set-cookie")
        if (headerVal) {
          cookieStr = extractQBitCookie(headerVal)
        }
      } catch {
        /* covered by getSetCookie path */
      }
    }

    if (cookieStr) {
      cachedCookie = cookieStr
      return cachedCookie
    }

    return null
  } catch (e) {
    console.error("[qBittorrent] Auth login request error:", e instanceof Error ? e.message : e)
    return null
  }
}

async function qbitFetch<T>(endpoint: string, options?: RequestInit): Promise<T | null> {
  const { url, username } = getQbitConfig()
  if (!url) return null
  try {
    if (!cachedCookie && username) {
      await getAuthCookie()
    }

    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string>),
    }

    if (cachedCookie) {
      headers["Cookie"] = cachedCookie
    }

    let res = await fetch(`${url}/api/v2${endpoint}`, {
      ...options,
      headers,
    })

    // If unauthorized (session expired), retry ONCE after re-authenticating
    if ((res.status === 403 || res.status === 401) && username) {
      cachedCookie = null
      lastAuthAttemptTime = 0
      const newCookie = await getAuthCookie()
      if (newCookie) {
        headers["Cookie"] = newCookie
        res = await fetch(`${url}/api/v2${endpoint}`, {
          ...options,
          headers,
        })
      }
    }

    if (!res.ok) return null

    const text = await res.text()
    if (!text || text.trim() === "" || text.trim() === "Ok.") {
      return { ok: true } as unknown as T
    }

    try {
      return JSON.parse(text) as T
    } catch {
      return text as unknown as T
    }
  } catch (e) {
    console.error(`[qBittorrent] Fetch ${endpoint} error:`, e instanceof Error ? e.message : e)
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
  return Array.isArray(result) ? result : []
}

export async function getTransferInfo(): Promise<QBitTransferInfo | null> {
  const result = await qbitFetch<QBitTransferInfo>("/transfer/info")
  if (!result || typeof result !== "object" || typeof (result as QBitTransferInfo).dl_info_speed !== "number") {
    return null
  }
  return result as QBitTransferInfo
}

export async function getDiskSpace(): Promise<number | null> {
  const mainData = await qbitFetch<{ server_state?: { free_space_on_disk?: number } }>("/sync/maindata")
  return mainData?.server_state?.free_space_on_disk ?? null
}

export async function pauseTorrents(hashes: string[]): Promise<boolean> {
  if (!hashes.length) return false
  const params = new URLSearchParams()
  params.append("hashes", hashes.join("|"))
  let result = await qbitFetch<unknown>("/torrents/pause", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (result === null) {
    // NOTE: /torrents/stop is a hard stop (pauses AND stops seeding), whereas
    // /torrents/pause keeps the torrent active but idle. Fall back only when
    // pause is unavailable on the server.
    result = await qbitFetch<unknown>("/torrents/stop", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  }
  return result !== null
}

export async function resumeTorrents(hashes: string[]): Promise<boolean> {
  if (!hashes.length) return false
  const params = new URLSearchParams()
  params.append("hashes", hashes.join("|"))
  let result = await qbitFetch<unknown>("/torrents/resume", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  })
  if (result === null) {
    result = await qbitFetch<unknown>("/torrents/start", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })
  }
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
