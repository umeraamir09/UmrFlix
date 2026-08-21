"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import { MovieRow } from "@/components/MovieRow"
import type { MovieCardItem } from "@/components/MovieCard"
import { ContinueWatchingSection } from "@/components/ContinueWatchingSection"

type FeedRow = {
  key: string
  title: string
  subtitle?: string
  type: "movie" | "tv"
  items: MovieCardItem[]
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function PersonalizedFeed({
  mediaType,
  includeContinueWatching = false,
}: {
  mediaType?: "movie" | "tv"
  includeContinueWatching?: boolean
} = {}) {
  const [hour, setHour] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      setHour(new Date().getHours())
    })()
  }, [])

  const queryParams = new URLSearchParams()
  if (mediaType) queryParams.set("mediaType", mediaType)
  if (hour !== null) queryParams.set("hour", String(hour))

  const url = `/api/discovery/home?${queryParams.toString()}`
  const { data, error, isLoading } = useSWR<{ rows: FeedRow[] }>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  if (error) return null

  if (isLoading) {
    return (
      <>
        {[0, 1].map((i) => (
          <section key={i} className="relative my-8 space-y-3" aria-hidden>
            <div className="h-6 w-56 bg-penpot-surface/60 border border-penpot-border/40 animate-pulse rounded-[4px]" />
            <div className="grid grid-flow-col auto-cols-[270px] sm:auto-cols-[290px] md:auto-cols-[320px] lg:auto-cols-[350px] gap-5 overflow-hidden py-3 px-1">
              {Array.from({ length: 6 }).map((_, j) => (
                <div
                  key={j}
                  className="aspect-[240/136] w-full rounded-[8px] bg-penpot-surface/60 border border-penpot-border/40 animate-pulse"
                />
              ))}
            </div>
          </section>
        ))}
      </>
    )
  }

  const rows = data?.rows ?? []
  if (rows.length === 0) {
    return includeContinueWatching ? <ContinueWatchingSection /> : null
  }

  const firstRow = rows[0]
  const remainingRows = rows.slice(1)

  return (
    <>
      {firstRow && (
        <MovieRow
          key={firstRow.key}
          title={firstRow.title}
          subtitle={firstRow.subtitle}
          type={firstRow.type}
          customItems={firstRow.items}
          rowKey={firstRow.key}
        />
      )}
      {includeContinueWatching && <ContinueWatchingSection />}
      {remainingRows.map((row) => (
        <MovieRow
          key={row.key}
          title={row.title}
          subtitle={row.subtitle}
          type={row.type}
          customItems={row.items}
          rowKey={row.key}
        />
      ))}
    </>
  )
}
