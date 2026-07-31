import { CircuitBreaker } from "./circuit-breaker"

export interface ResilientFetchOptions extends RequestInit {
  timeoutMs?: number
  retries?: number
  breaker?: CircuitBreaker
}

export class ServiceUnavailableError extends Error {
  constructor(public serviceName: string) {
    super(`Service '${serviceName}' is currently unavailable (circuit open).`)
    this.name = "ServiceUnavailableError"
  }
}

export async function resilientFetch<T>(
  url: string,
  options?: ResilientFetchOptions
): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? 8_000
  const retries = options?.retries ?? 2
  const breaker = options?.breaker
  const isIdempotent = !options?.method || options.method.toUpperCase() === "GET" || options.method.toUpperCase() === "HEAD"

  if (breaker && !breaker.canExecute()) {
    throw new ServiceUnavailableError(breaker.name)
  }

  let attempt = 0
  let lastError: unknown

  while (attempt <= (isIdempotent ? retries : 0)) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (res.ok) {
        if (res.status === 204) {
          breaker?.recordSuccess()
          return {} as T
        }
        const text = await res.text()
        if (!text || text.trim() === "") {
          breaker?.recordSuccess()
          return {} as T
        }
        try {
          const parsed = JSON.parse(text) as T
          breaker?.recordSuccess()
          return parsed
        } catch {
          breaker?.recordSuccess()
          return text as unknown as T
        }
      }



      // If server responds with 5xx, treat as service failure
      if (res.status >= 500) {
        breaker?.recordFailure()
        throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      }

      // Client errors (4xx) do not trip the circuit breaker
      throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err

      // If aborted or network failure
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
        breaker?.recordFailure()
      }

      attempt++
      if (attempt <= (isIdempotent ? retries : 0)) {
        const backoffMs = Math.pow(3, attempt - 1) * 100 + Math.floor(Math.random() * 50)
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }
  }

  throw lastError
}
