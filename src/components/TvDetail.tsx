"use client"

import { use } from "react"
import useSWR from "swr"
import { getImageUrl, formatRating, formatDate } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { RequestButton } from "@/components/RequestButton"
import { SeasonBrowser } from "@/components/SeasonBrowser"
import { useAvailability } from "@/lib/use-availability"
import { Star, Calendar } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function TvDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, error, isLoading } = useSWR(
    id ? `/api/tmdb/tv/${id}` : null,
    fetcher
  )

  const showId = data?.id
  const { availability, refresh } = useAvailability(
    showId ? { tmdbId: showId, type: "tv" } : null
  )

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="mt-4 h-8 w-2/3" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <Skeleton className="mt-4 h-24 w-full" />
      </div>
    )
  }

  if (error || !data) {
    return <div className="p-6 text-muted">Failed to load TV show details.</div>
  }

  const show = data
  const tvdbId = show.external_ids?.tvdb_id ?? undefined

  return (
    <div>
      <div className="relative h-[50vh] min-h-[400px] w-full">
        {show.backdrop_path && (
          <img
            src={getImageUrl(show.backdrop_path, "original")}
            alt=""
            className="size-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>
      <div className="relative -mt-48 px-6 pb-8">
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="w-48 flex-shrink-0">
            <img
              src={getImageUrl(show.poster_path)}
              alt={show.name}
              className="w-full rounded-lg shadow-xl"
            />
          </div>
          <div className="flex flex-col justify-end space-y-4">
            <div>
              <h1 className="text-3xl font-bold">{show.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
                <span className="flex items-center gap-1">
                  <Star className="size-4 fill-warning text-warning" />
                  {formatRating(show.vote_average)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-4" />
                  {formatDate(show.first_air_date)}
                </span>
                {show.seasons && (
                  <span>{show.seasons.length} Seasons</span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {show.genres?.map((g: { id: number; name: string }) => (
                <Badge key={g.id} variant="default">{g.name}</Badge>
              ))}
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              {show.overview}
            </p>
            <div className="flex gap-3">
              <RequestButton
                type="tv"
                tmdbId={show.id}
                title={show.name}
                year={show.first_air_date ? new Date(show.first_air_date).getFullYear() : undefined}
                tvdbId={tvdbId}
                availability={availability}
                onStatusChange={refresh}
              />
            </div>

            {availability?.status === "in_library" && availability.jellyfinItemId && (
              <div className="mt-4 w-full">
                <SeasonBrowser
                  seriesId={availability.jellyfinItemId}
                  tvdbId={tvdbId}
                  showName={show.name}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
