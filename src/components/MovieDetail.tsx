"use client"

import useSWR from "swr"
import { getImageUrl, formatRating, formatDate, formatRuntime } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { RequestButton } from "@/components/RequestButton"
import { CinemaPlayer } from "@/components/player/CinemaPlayer"
import { useAvailability } from "@/lib/use-availability"
import { Star, Clock, Calendar } from "lucide-react"
import { use } from "react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, error, isLoading } = useSWR(
    id ? `/api/tmdb/movie/${id}` : null,
    fetcher
  )

  const movieId = data?.id
  const { availability, refresh } = useAvailability(
    movieId ? { tmdbId: movieId, type: "movie" } : null
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
    return <div className="p-6 text-muted">Failed to load movie details.</div>
  }

  const movie = data

  return (
    <div>
      <div className="relative h-[50vh] min-h-[400px] w-full">
        {movie.backdrop_path && (
          <img
            src={getImageUrl(movie.backdrop_path, "original")}
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
              src={getImageUrl(movie.poster_path)}
              alt={movie.title}
              className="w-full rounded-lg shadow-xl"
            />
          </div>
          <div className="flex flex-col justify-end space-y-4">
            <div>
              <h1 className="text-3xl font-bold">{movie.title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
                <span className="flex items-center gap-1">
                  <Star className="size-4 fill-warning text-warning" />
                  {formatRating(movie.vote_average)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="size-4" />
                  {formatDate(movie.release_date)}
                </span>
                {movie.runtime > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-4" />
                    {formatRuntime(movie.runtime)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {movie.genres?.map((g: { id: number; name: string }) => (
                <Badge key={g.id} variant="default">{g.name}</Badge>
              ))}
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-muted">
              {movie.overview}
            </p>
            <div className="flex gap-3">
              <RequestButton
                type="movie"
                tmdbId={movie.id}
                title={movie.title}
                year={movie.release_date ? new Date(movie.release_date).getFullYear() : undefined}
                availability={availability}
                onStatusChange={refresh}
              />
            </div>

            {availability?.status === "in_library" && availability.jellyfinItemId && (
              <div className="mt-4 w-full max-w-4xl">
                <CinemaPlayer
                  itemId={availability.jellyfinItemId}
                  title={movie.title}
                  poster={getImageUrl(movie.backdrop_path, "original")}
                  autoPlay
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
