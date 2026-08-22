"use client"

import useSWR from "swr"

type ItemRef = { id: number; type: "movie" | "tv" }

export function useBatchHorizontalPosters(items: ItemRef[]) {
  const validItems = items.filter((item) => item && item.id > 0 && (item.type === "movie" || item.type === "tv"))

  const { data, error, isLoading, mutate } = useSWR<{ results: Record<string, string | null> }>(
    validItems.length > 0
      ? ["/api/tmdb/posters", validItems.map((i) => `${i.type}-${i.id}`).sort().join(",")]
      : null,
    async () => {
      const res = await fetch("/api/tmdb/posters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: validItems }),
      })
      if (!res.ok) return { results: {} }
      return res.json()
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 300_000, // 5 minutes
      keepPreviousData: true,
    }
  )

  return {
    posterMap: data?.results ?? ({} as Record<string, string | null>),
    isLoading,
    error,
    refresh: mutate,
  }
}
