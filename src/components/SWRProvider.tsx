"use client"

import { SWRConfig } from "swr"
import { ReactNode } from "react"
import { sanitizeRedirectUrl } from "@/lib/url-sanitize"

const defaultFetcher = (url: string) =>
  fetch(url).then(async (res) => {
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.authenticated === false || data?.error === "Unauthorized") {
      const error = new Error(data?.error || `HTTP Error ${res.status}: ${res.statusText}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(error as any).status = res.status === 200 ? 401 : res.status
      throw error
    }
    return data
  })

export function SWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: defaultFetcher,
        dedupingInterval: 10_000, // Coalesce duplicate component fetches within 10s
        revalidateOnFocus: false, // Eliminate screen flickering and API storms on tab focus
        revalidateOnReconnect: true,
        errorRetryCount: 3,
        onError: (error) => {
          if (
            error?.status === 401 &&
            typeof window !== "undefined" &&
            window.location.pathname !== "/login"
          ) {
            const currentPath = sanitizeRedirectUrl(window.location.pathname + window.location.search)
            window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
          }
        },

        onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
          // Never retry on 404 or 401
          if (error?.status === 404 || error?.status === 401) return
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

