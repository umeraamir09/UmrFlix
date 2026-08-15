"use client"

import { use } from "react"
import Image from "next/image"
import useSWR from "swr"
import { getImageUrl, formatRating, formatDate, formatRuntime } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { RequestButton } from "@/components/RequestButton"
import { BookmarkButton } from "@/components/BookmarkButton"
import { MovieRow } from "@/components/MovieRow"
import { CastCarousel } from "@/components/CastCarousel"
import { useAvailability } from "@/lib/use-availability"
import { Star, Clock, Calendar, Globe, DollarSign } from "lucide-react"
import type { TmdbMovieDetail } from "@/lib/tmdb"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatNumber(num?: number): string {
  if (!num) return ""
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

function formatCurrency(amount?: number): string | null {
  if (!amount || amount <= 0) return null
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount)
}

export function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, error, isLoading } = useSWR<TmdbMovieDetail>(
    id ? `/api/tmdb/movie/${id}?append_to_response=credits,videos,images,recommendations,similar,external_ids&include_image_language=en,null` : null,
    fetcher
  )

  const imdbId = data?.external_ids?.imdb_id || data?.imdb_id
  const { data: omdbData } = useSWR<{ imdbRating?: string; imdbVotes?: string; Response?: string }>(
    imdbId ? `/api/omdb?i=${imdbId}` : null,
    fetcher
  )

  const hasOmdbRating = omdbData?.Response !== "False" && omdbData?.imdbRating && omdbData.imdbRating !== "N/A"

  const movieId = data?.id
  const { availability, refresh } = useAvailability(
    movieId ? { tmdbId: movieId, type: "movie" } : null
  )

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[1600px] p-6 space-y-6">
        <Skeleton className="aspect-[21/9] w-full rounded-none" />
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-24 w-2/3" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="p-12 text-center text-muted">
        <p className="text-lg font-bold text-white">Failed to load movie details.</p>
        <p className="text-sm text-gray-500 mt-1">Please try again later or check your network connection.</p>
      </div>
    )
  }

  const movie = data

  // Extract logo URL if available
  const logoItem = movie.images?.logos?.find((l) => l.iso_639_1 === "en") || movie.images?.logos?.[0]
  const logoUrl = logoItem?.file_path ? getImageUrl(logoItem.file_path, "w500") : null

  // Directors & Writers
  const directors = movie.credits?.crew?.filter((c) => c.job === "Director") || []
  const writers = movie.credits?.crew?.filter((c) => c.job === "Writer" || c.job === "Screenplay") || []
  const cast = movie.credits?.cast?.slice(0, 15) || []

  // Spoken languages
  const spokenLanguages = movie.spoken_languages?.map((l) => l.english_name || l.name).join(", ") || "English"

  // Recommendations / Similar movies
  const relatedMovies = movie.recommendations?.results?.length
    ? movie.recommendations.results
    : movie.similar?.results || []

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pb-16">
      {/* ── Hero Backdrop & Title Section ── */}
      <div className="relative h-[65dvh] min-h-[450px] sm:min-h-[500px] max-h-[750px] w-full overflow-hidden bg-background">
        {movie.backdrop_path ? (
          <Image
            src={getImageUrl(movie.backdrop_path, "w1280")}
            alt={movie.title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
        ) : (
          <div className="size-full bg-surface" />
        )}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent w-full md:w-3/4" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-transparent h-24" />

        {/* Hero Banner Content */}
        <div className="absolute bottom-8 left-0 right-0 z-10 mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8">
          <div className="flex flex-col md:flex-row gap-6 items-start md:items-end">
            {/* Poster */}
            <div className="flex flex-col items-start gap-2 md:gap-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-accent">
                <span className="bg-accent/20 px-2 py-0.5 border border-accent/40">MOVIE</span>
              </div>
              <div className="relative aspect-[2/3] w-28 sm:w-44 md:w-52 shrink-0 overflow-hidden rounded-none border border-border shadow-2xl block">
                <Image
                  src={getImageUrl(movie.poster_path, "w500")}
                  alt={movie.title}
                  fill
                  sizes="(max-width: 640px) 112px, (max-width: 768px) 176px, 208px"
                  className="object-cover"
                />
              </div>
            </div>

            {/* Title / Logo / Metadata Details */}
            <div className="space-y-4 max-w-3xl">

              {/* Logo image or text title */}
              {logoUrl ? (
                <div className="relative h-20 sm:h-28 md:h-32 w-64 sm:w-80 md:w-[420px] drop-shadow-2xl my-2">
                  <Image
                    src={logoUrl}
                    alt={movie.title}
                    fill
                    sizes="(max-width: 640px) 256px, (max-width: 768px) 320px, 420px"
                    className="object-contain object-left drop-shadow-xl"
                  />
                </div>
              ) : (
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-lg">
                  {movie.title}
                </h1>
              )}

              {/* Tagline */}
              {movie.tagline && (
                <p className="text-sm italic text-gray-300 font-medium">{`"${movie.tagline}"`}</p>
              )}

              {/* Metadata Badges */}
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-300">
                {hasOmdbRating ? (
                  <span className="flex items-center gap-1.5 bg-surface/90 border border-border px-2.5 py-1 text-white font-bold">
                    <Image src="/imdb.webp" alt="IMDb" width={1280} height={1280} sizes="16px" className="h-4 w-auto object-contain" />
                    <span>{omdbData.imdbRating}</span>
                    {omdbData.imdbVotes && omdbData.imdbVotes !== "N/A" && (
                      <span className="text-gray-400 font-normal text-[11px]">
                        ({omdbData.imdbVotes})
                      </span>
                    )}
                  </span>
                ) : movie.vote_average > 0 ? (
                  <span className="flex items-center gap-1 bg-surface/90 border border-border px-2.5 py-1 text-white font-bold">
                    <Star className="size-4 fill-warning text-warning" />
                    {formatRating(movie.vote_average)}
                    {movie.vote_count > 0 && (
                      <span className="text-gray-400 font-normal text-[11px]">
                        ({formatNumber(movie.vote_count)})
                      </span>
                    )}
                  </span>
                ) : null}
                {movie.release_date && (
                  <span className="flex items-center gap-1.5 bg-surface/90 border border-border px-2.5 py-1">
                    <Calendar className="size-3.5 text-accent" />
                    {formatDate(movie.release_date)}
                  </span>
                )}
                {movie.runtime > 0 && (
                  <span className="flex items-center gap-1.5 bg-surface/90 border border-border px-2.5 py-1">
                    <Clock className="size-3.5 text-accent" />
                    {formatRuntime(movie.runtime)}
                  </span>
                )}
                {movie.status && (
                  <span className="bg-surface/90 border border-border px-2.5 py-1 uppercase text-[10px] tracking-wider font-extrabold text-gray-400">
                    {movie.status}
                  </span>
                )}
              </div>

              {/* Genres */}
              <div className="flex flex-wrap gap-2 pt-1">
                {movie.genres?.map((g) => (
                  <Badge key={g.id} variant="default" className="rounded-none bg-surface hover:bg-card border border-border text-xs px-2.5 py-0.5">
                    {g.name}
                  </Badge>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 w-full sm:w-auto">
                <RequestButton
                  type="movie"
                  tmdbId={movie.id}
                  title={movie.title}
                  year={movie.release_date ? new Date(movie.release_date).getFullYear() : undefined}
                  posterPath={movie.poster_path}
                  backdropPath={movie.backdrop_path}
                  availability={availability}
                  onStatusChange={refresh}
                />

                <BookmarkButton
                  itemId={availability?.jellyfinItemId || String(movie.id)}
                  tmdbId={movie.id}
                  jellyfinId={availability?.jellyfinItemId}
                  mediaType="movie"
                  title={movie.title}
                  posterPath={movie.poster_path}
                  overview={movie.overview}
                  releaseYear={movie.release_date ? new Date(movie.release_date).getFullYear().toString() : undefined}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Detail Section ── */}
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 mt-8 space-y-12">
        {/* Overview & Metadata Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Main Story Overview (Left 2 Columns) */}
          <div className="lg:col-span-2 space-y-8">
            {/* Story Synopsis */}
            <div className="space-y-3">
              {/* <h2 className="text-lg font-black uppercase tracking-wider text-white border-b border-border pb-3 flex items-center gap-2">
                <Film className="size-5 text-accent" /> STORY SYNOPSIS
              </h2> */}
              <p className="text-base sm:text-lg leading-relaxed text-gray-300">
                {movie.overview || "No overview available for this movie."}
              </p>
            </div>

            {/* Scrollable Cast Carousel with Navigation Arrows */}
            <CastCarousel cast={cast} />
          </div>

          {/* Right Sidebar Metadata Details (Open Design) */}
          <div className="space-y-6">
            <div className="space-y-4">
              {/* <h2 className="text-lg font-black uppercase tracking-wider text-white border-b border-border pb-3 flex items-center gap-2">
                <Award className="size-5 text-accent" /> MOVIE DETAILS
              </h2> */}

              <dl className="space-y-4 text-xs">
                {directors.length > 0 && (
                  <div className="pt-2">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Director</dt>
                    <dd className="text-sm font-semibold text-white mt-0.5">
                      {directors.map((d) => d.name).join(", ")}
                    </dd>
                  </div>
                )}

                {writers.length > 0 && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Writers</dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {writers.map((w) => w.name).join(", ")}
                    </dd>
                  </div>
                )}

                <div className="pt-3">
                  <dt className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="size-3.5 text-accent" /> Spoken Languages
                  </dt>
                  <dd className="text-sm font-medium text-gray-200 mt-0.5">{spokenLanguages}</dd>
                </div>

                {movie.production_companies && movie.production_companies.length > 0 && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Studios</dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {movie.production_companies.map((p) => p.name).join(", ")}
                    </dd>
                  </div>
                )}

                {formatCurrency(movie.budget) && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <DollarSign className="size-3.5 text-success" /> Budget
                    </dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {formatCurrency(movie.budget)}
                    </dd>
                  </div>
                )}

                {formatCurrency(movie.revenue) && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                      <DollarSign className="size-3.5 text-success" /> Box Office Revenue
                    </dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {formatCurrency(movie.revenue)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>

        {/* ── More Like This Section ── */}
        {relatedMovies.length > 0 && (
          <div className="pt-8">
            <MovieRow
              title="MORE LIKE THIS"
              subtitle="Movies you might also enjoy based on this title"
              type="movie"
              customItems={relatedMovies.map((m) => ({
                id: m.id,
                title: m.title,
                poster_path: m.poster_path,
                backdrop_path: m.backdrop_path,
                overview: m.overview,
                release_date: m.release_date,
                vote_average: m.vote_average,
                vote_count: m.vote_count,
                popularity: m.popularity,
                genre_ids: m.genre_ids,
              }))}
            />
          </div>
        )}
      </div>
    </div>
  )
}
