import { env } from "./env"
import { CircuitBreaker, tmdbBreaker, SingleFlight } from "./circuit-breaker"

export interface TmdbProxyFetchOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  breaker?: CircuitBreaker
  skipCache?: boolean
}

type CachedResponseEntry = {
  body: ArrayBuffer
  status: number
  statusText: string
  contentType: string
  timestamp: number
}

const TMDB_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
const tmdbResponseCache = new Map<string, CachedResponseEntry>()
const MAX_TMDB_CACHE_ENTRIES = 1000

function pruneTmdbCache() {
  const now = Date.now()
  if (tmdbResponseCache.size > MAX_TMDB_CACHE_ENTRIES) {
    for (const [key, entry] of tmdbResponseCache.entries()) {
      if (now - entry.timestamp > TMDB_CACHE_TTL) {
        tmdbResponseCache.delete(key)
      }
    }
  }
}

function parseRetryAfterMs(res: Response, defaultMs: number): number {
  const retryHeader = res.headers.get("retry-after")
  if (retryHeader) {
    const seconds = parseInt(retryHeader, 10)
    if (!isNaN(seconds)) {
      return seconds * 1000 + Math.floor(Math.random() * 150)
    }
    const dateMs = Date.parse(retryHeader)
    if (!isNaN(dateMs)) {
      const diff = dateMs - Date.now()
      if (diff > 0) return diff + Math.floor(Math.random() * 150)
    }
  }
  return defaultMs
}

function createResponseFromEntry(entry: CachedResponseEntry, cacheHeader: "HIT" | "MISS"): Response {
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: {
      "Content-Type": entry.contentType,
      "X-Cache": cacheHeader,
    },
  })
}

export async function tmdbProxyFetch(path: string, options?: TmdbProxyFetchOptions): Promise<Response> {
  const isGet = !options?.method || options.method.toUpperCase() === "GET"
  const skipCache = options?.skipCache ?? false
  const proxyUrl = env("TMDB_PROXY_URL")
  const secret = env("TMDB_PROXY_SECRET")
  const timeoutMs = options?.timeoutMs ?? 6_000
  const retries = Math.max(0, options?.retries ?? 2)
  const breaker = options?.breaker ?? tmdbBreaker

  if (!proxyUrl) {
    throw new Error("TMDB_PROXY_URL is not set")
  }
  if (!secret) {
    throw new Error("TMDB_PROXY_SECRET is not set")
  }

  const baseUrl = new URL(proxyUrl)
  const url = new URL(path, baseUrl)
  if (url.origin !== baseUrl.origin) {
    throw new Error("Refusing to proxy to a different origin")
  }
  const pathPart = path.split("?", 1)[0]
  const rawSegments = pathPart.split("/")
  if (rawSegments.some((seg) => seg === "." || seg === ".." || seg.includes("\\") || seg.includes("%"))) {
    throw new Error("Refusing to proxy a path with traversal segments")
  }
  if (!url.pathname.startsWith("/3/")) {
    throw new Error("Refusing to proxy outside the /3/ namespace")
  }

  const cacheKey = url.toString()

  // 1. Check in-memory cache for GET requests
  if (isGet && !skipCache) {
    const cached = tmdbResponseCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < TMDB_CACHE_TTL) {
      return createResponseFromEntry(cached, "HIT")
    }
  }

  // 2. Coalesce concurrent identical calls with SingleFlight
  const result = await SingleFlight.execute(`tmdb:${cacheKey}`, async (): Promise<{ entry: CachedResponseEntry; hit: boolean }> => {
    // Re-check cache inside singleflight
    if (isGet && !skipCache) {
      const cached = tmdbResponseCache.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < TMDB_CACHE_TTL) {
        return { entry: cached, hit: true }
      }
    }

    const headers = new Headers(options?.headers)
    headers.set("X-Proxy-Secret", secret)

    let attempt = 0
    let lastError: unknown

    while (attempt <= retries) {
      if (!breaker.canExecute()) {
        throw new Error("TMDB proxy is unavailable (circuit open)")
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url.toString(), {
          ...options,
          headers,
          signal: controller.signal,
          redirect: "manual",
        })

        clearTimeout(timeoutId)

        if (res.ok) {
          breaker.recordSuccess()
          const body = await res.arrayBuffer()
          const contentType = res.headers.get("content-type") || "application/json"
          const entry: CachedResponseEntry = {
            body,
            status: res.status,
            statusText: res.statusText,
            contentType,
            timestamp: Date.now(),
          }
          if (isGet && !skipCache) {
            pruneTmdbCache()
            tmdbResponseCache.set(cacheKey, entry)
          }
          return { entry, hit: false }
        }

        // Auto-retry on 429 (Rate Limit) and 503 (Overload)
        if (res.status === 429 || res.status === 503 || res.status >= 500) {
          lastError = new Error(`HTTP Error ${res.status}: ${res.statusText}`)
          attempt++
          if (attempt <= retries) {
            const waitMs = res.status === 429
              ? parseRetryAfterMs(res, Math.pow(2, attempt - 1) * 300 + Math.floor(Math.random() * 150))
              : Math.pow(2, attempt - 1) * 200 + Math.floor(Math.random() * 100)
            await new Promise((r) => setTimeout(r, waitMs))
            continue
          }
          const body = await res.arrayBuffer()
          const contentType = res.headers.get("content-type") || "application/json"
          return {
            entry: {
              body,
              status: res.status,
              statusText: res.statusText,
              contentType,
              timestamp: Date.now(),
            },
            hit: false,
          }
        }

        const body = await res.arrayBuffer()
        const contentType = res.headers.get("content-type") || "application/json"
        return {
          entry: {
            body,
            status: res.status,
            statusText: res.statusText,
            contentType,
            timestamp: Date.now(),
          },
          hit: false,
        }
      } catch (err) {
        clearTimeout(timeoutId)
        lastError = err
        attempt++
        if (attempt <= retries) {
          await new Promise((r) => setTimeout(r, 250 * attempt))
          continue
        }
      }
    }

    if (lastError != null) {
      breaker.recordFailure()
    }

    throw lastError
  })

  return createResponseFromEntry(result.entry, result.hit ? "HIT" : "MISS")
}
