"use client"

import useSWR from "swr"
import type { AvailabilityResult } from "@/app/api/availability/route"

type ItemRef = { tmdbId: number; type: "movie" | "tv"; tvdbId?: number }

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useAvailability(item: ItemRef | null) {
  const params = item ? `tmdbId=${item.tmdbId}&type=${item.type}` : null
  const { data, error, isLoading, mutate } = useSWR<{ results: Record<string, AvailabilityResult> }>(
    params ? `/api/availability?${params}` : null,
    fetcher,
    {
      refreshInterval: 10_000,
      revalidateOnFocus: true,
    }
  )

  const key = item ? `${item.type}-${item.tmdbId}` : null
  return {
    availability: key && data?.results ? data.results[key] ?? null : null,
    isLoading,
    error,
    refresh: mutate,
  }
}

export function useBatchAvailability(items: ItemRef[]) {
  const { data, error, isLoading, mutate } = useSWR<{ results: Record<string, AvailabilityResult> }>(
    items.length > 0 ? ["/api/availability", items] : null,
    async ([url, body]: [string, ItemRef[]]) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: body }),
      })
      return res.json()
    },
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
    }
  )

  return {
    availabilityMap: data?.results ?? ({} as Record<string, AvailabilityResult>),
    isLoading,
    error,
    refresh: mutate,
  }
}
