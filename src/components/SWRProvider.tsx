"use client"

import { SWRConfig } from "swr"
import { ReactNode } from "react"

const defaultFetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) {
      const error = new Error(`HTTP Error ${res.status}: ${res.statusText}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(error as any).status = res.status
      throw error
    }
    return res.json()
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
