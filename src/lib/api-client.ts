export class ApiClientError extends Error {
  status: number
  retryable: boolean
  jellyfinAuthExpired: boolean
  sessionExpired: boolean

  constructor(
    message: string,
    status: number,
    options: {
      retryable?: boolean
      jellyfinAuthExpired?: boolean
      sessionExpired?: boolean
    } = {}
  ) {
    super(message)
    this.name = "ApiClientError"
    this.status = status
    this.retryable = options.retryable ?? (status >= 500 || status === 429 || status === 0)
    this.jellyfinAuthExpired = options.jellyfinAuthExpired ?? false
    this.sessionExpired = options.sessionExpired ?? (status === 401)
  }
}

export async function apiFetcher<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, init)
    const data = await res.json().catch(() => ({}))

    if (!res.ok) {
      const isJellyfinExpired = res.status === 403 && data?.jellyfinAuth === "expired"
      const isSessionExpired = res.status === 401 || data?.authenticated === false

      throw new ApiClientError(
        data?.error || `HTTP Error ${res.status}: ${res.statusText}`,
        res.status,
        {
          retryable: res.status >= 500 || res.status === 429,
          jellyfinAuthExpired: isJellyfinExpired,
          sessionExpired: isSessionExpired,
        }
      )
    }

    if (data?.authenticated === false) {
      throw new ApiClientError("Session expired", 401, {
        retryable: false,
        sessionExpired: true,
      })
    }

    return data as T
  } catch (err) {
    if (err instanceof ApiClientError) throw err

    // Network or fetch abort error
    throw new ApiClientError(
      err instanceof Error ? err.message : "Network request failed",
      0,
      { retryable: true }
    )
  }
}
