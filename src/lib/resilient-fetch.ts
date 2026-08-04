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

async function getWithBackoff(attempt: number, retryAfterMs?: number): Promise<void> {
  const backoffMs = retryAfterMs ?? (Math.pow(2, attempt - 1) * 200 + Math.floor(Math.random() * 100))
  await new Promise((r) => setTimeout(r, backoffMs))
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
  let failedOnNetwork = false
  let failedOnServer = false

  while (attempt <= (isIdempotent ? retries : 0)) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response | null = null
    try {
      res = await fetch(url, {
        ...options,
        signal: controller.signal,
      })
    } catch (err) {
      clearTimeout(timeoutId)
      lastError = err
      if (err instanceof Error && (err.name === "AbortError" || err.message.includes("fetch failed"))) {
        failedOnNetwork = true
      }
      attempt++
      if (attempt <= (isIdempotent ? retries : 0)) {
        await getWithBackoff(attempt)
        continue
      }
      break
    }

    clearTimeout(timeoutId)

    if (!res) break

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

    // Handle 429 Rate Limit (and 503 temporary overload) with auto-retry
    if (res.status === 429 || res.status === 503) {
      lastError = new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      failedOnServer = true
      attempt++
      if (attempt <= (isIdempotent ? retries : 0)) {
        const waitMs = parseRetryAfterMs(res, Math.pow(2, attempt - 1) * 300 + Math.floor(Math.random() * 150))
        await getWithBackoff(attempt, waitMs)
        continue
      }
      break
    }

    // If the server responds 5xx, treat as service failure — but retry and
    // count it once only at the end so one request can't abruptly trip the breaker.
    if (res.status >= 500) {
      lastError = new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      failedOnServer = true
      attempt++
      if (attempt <= (isIdempotent ? retries : 0)) {
        await getWithBackoff(attempt)
        continue
      }
      break
    }

    // Client errors (4xx other than 429) do not trip the circuit breaker
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
  }

  if ((failedOnNetwork || failedOnServer) && lastError != null) {
    breaker?.recordFailure()
  }

  throw lastError
}