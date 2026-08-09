"use client"

import { SWRConfig } from "swr"
import { ReactNode } from "react"
import { apiFetcher, ApiClientError } from "@/lib/api-client"
import { sanitizeRedirectUrl } from "@/lib/url-sanitize"

let isRedirectingToLogin = false

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: apiFetcher,
        dedupingInterval: 10_000, // Coalesce duplicate component fetches within 10s
        revalidateOnFocus: false, // Eliminate screen flickering and API storms on tab focus
        revalidateOnReconnect: true,
        keepPreviousData: true,
        errorRetryCount: 3,

        onError: (error, key) => {
          const isMeRoute = typeof key === "string" && key.includes("/api/auth/me")
          const isSessionDead =
            error instanceof ApiClientError
              ? error.sessionExpired
              : error?.status === 401

          // Only redirect to /login if session is genuinely dead and key is /api/auth/me or sessionExpired
          if (
            isSessionDead &&
            isMeRoute &&
            !isRedirectingToLogin &&
            typeof window !== "undefined" &&
            window.location.pathname !== "/login"
          ) {
            isRedirectingToLogin = true
            const currentPath = sanitizeRedirectUrl(
              window.location.pathname + window.location.search
            )
            window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
          }
        },

        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          // Never retry non-retryable errors (401, 403, 404)
          if (error?.retryable === false || error?.status === 401 || error?.status === 403 || error?.status === 404) {
            return
          }
          if (retryCount >= 3) return

          // Exponential backoff retry with jitter
          const timeout = Math.min(1000 * Math.pow(2, retryCount), 8000) + Math.floor(Math.random() * 200)
          setTimeout(() => revalidate({ retryCount }), timeout)
        },
      }}
    >
      {children}
    </SWRConfig>
  )
}
