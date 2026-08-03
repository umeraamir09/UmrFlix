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

async function getWithBackoff(attempt: number): Promise<void> {
  const backoffMs = Math.pow(3, attempt - 1) * 100 + Math.floor(Math.random() * 50)
  await new Promise((r) => setTimeout(r, backoffMs))
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
      // If aborted or network failure, this is a real service failure — but
      // count it only once per logical request (when retries are exhausted),
      // so a single slow request can't trip a low-threshold breaker.
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

    // Client errors (4xx) do not trip the circuit breaker
    throw new Error(`HTTP Error ${res.status}: ${res.statusText}`)
  }

  if ((failedOnNetwork || failedOnServer) && lastError != null) {
    breaker?.recordFailure()
  }

  throw lastError
}