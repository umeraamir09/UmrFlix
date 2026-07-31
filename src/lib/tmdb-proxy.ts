import { env } from "./env"
import { CircuitBreaker } from "./circuit-breaker"

export interface TmdbProxyFetchOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  breaker?: CircuitBreaker
}

export async function tmdbProxyFetch(path: string, options?: TmdbProxyFetchOptions): Promise<Response> {
  const proxyUrl = env("TMDB_PROXY_URL")
  const secret = env("TMDB_PROXY_SECRET")
  const timeoutMs = options?.timeoutMs ?? 8_000
  const retries = options?.retries ?? 2
  const breaker = options?.breaker

  if (!proxyUrl) {
    throw new Error("TMDB_PROXY_URL is not set")
  }

  if (breaker && !breaker.canExecute()) {
    throw new Error("TMDB proxy is unavailable (circuit open)")
  }

  const url = new URL(path, proxyUrl)
  const headers = new Headers(options?.headers)
  headers.set("X-Proxy-Secret", secret)

  let attempt = 0
  let lastError: unknown

  while (attempt <= retries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url.toString(), {
        ...options,
        headers,
        signal: controller.signal,
      })
      if (res.ok) {
        breaker?.recordSuccess()
        return res
      }
      if (res.status >= 500) {
        breaker?.recordFailure()
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      }
      return res
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
        breaker?.recordFailure()
      }
      attempt++
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, 200 + Math.floor(Math.random() * 50)))
      }
    }
  }

  throw lastError
}
