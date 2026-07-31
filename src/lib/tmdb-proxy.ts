import { env } from "./env"
import { CircuitBreaker, tmdbBreaker } from "./circuit-breaker"

export interface TmdbProxyFetchOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  breaker?: CircuitBreaker
}

export async function tmdbProxyFetch(path: string, options?: TmdbProxyFetchOptions): Promise<Response> {
  const proxyUrl = env("TMDB_PROXY_URL")
  const secret = env("TMDB_PROXY_SECRET")
  const timeoutMs = options?.timeoutMs ?? 6_000
  const retries = Math.max(0, options?.retries ?? 1)
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
      if (res.ok) {
        breaker.recordSuccess()
        return res
      }
      if (res.status >= 300) {
        breaker.recordFailure()
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      }
      return res
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
        breaker.recordFailure()
      }
      attempt++
      if (attempt <= retries) {
        await new Promise((r) => setTimeout(r, 250 * attempt))
      }
    }
  }

  throw lastError
}
