"use client"

import { use, useState } from "react"
import Image from "next/image"
import useSWR from "swr"
import { Star, Film, Loader2 } from "lucide-react"
import { getImageUrl, formatRating, formatRuntime } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { IconPlay, IconGroup, IconPlus } from "@/components/ui/icons"
import { RequestModal } from "@/components/RequestModal"
import { BookmarkButton } from "@/components/BookmarkButton"
import { MovieRow } from "@/components/MovieRow"
import { CastCarousel } from "@/components/CastCarousel"
import { TrailerModal } from "@/components/TrailerModal"
import { StartPartyModal } from "@/components/party/StartPartyModal"
import { useAvailability } from "@/lib/use-availability"
import { useToast } from "@/components/Toast"
import { useRouter } from "next/navigation"
import type { TmdbMovieDetail } from "@/lib/tmdb"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatCurrency(amount?: number): string | null {
  if (!amount || amount <= 0) return null
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

export function MovieDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()

  const { data, error, isLoading } = useSWR<TmdbMovieDetail>(
    id
      ? `/api/tmdb/movie/${id}?append_to_response=credits,videos,images,recommendations,similar,external_ids&include_image_language=en,null`
      : null,
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

  // State for modals
  const [showRequestModal, setShowRequestModal] = useState(false)
  const [showTrailerModal, setShowTrailerModal] = useState(false)
  const [showPartyModal, setShowPartyModal] = useState(false)

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
      <div className="p-16 text-center text-penpot-text-medium bg-penpot-bg min-h-[60vh] flex flex-col items-center justify-center">
        <p className="text-xl font-bold text-white">Failed to load movie details.</p>
        <p className="text-sm text-penpot-text-subtle mt-2">Please try again later or check your network connection.</p>
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

  // Check if trailer is available
  const hasVideos = Boolean(movie.videos?.results && movie.videos.results.length > 0)

  // Status & Availability calculations
  const isInLibrary = availability?.status === "in_library" && Boolean(availability.jellyfinItemId)
  const isDownloading = availability?.status === "downloading"
  const isPending = availability?.status === "pending"
  const isRequested = availability?.status === "in_radarr" || availability?.status === "in_sonarr"

  const handlePlay = () => {
    if (availability?.jellyfinItemId) {
      router.push(`/watch?id=${availability.jellyfinItemId}&type=movie`)
    }
  }

  const handleRequestSuccess = () => {
    setShowRequestModal(false)
    toast(`${movie.title} request updated successfully!`, "success")
    refresh()
  }

  return (
    <div className="min-h-[100dvh] bg-penpot-bg text-white pb-20">
      {/* ── Hero Backdrop & Title Section (Penpot Hero/tvshow) ── */}
      <div className="relative h-[72dvh] min-h-[520px] max-h-[820px] w-full overflow-hidden bg-penpot-bg">
        {/* Backdrop Image */}
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
          <div className="size-full bg-penpot-surface" />
        )}

        {/* Penpot Dual Gradient Overlays */}
        {/* 1. Bottom-to-top linear gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-penpot-bg via-penpot-bg/75 to-transparent" />
        {/* 2. Left-to-right lateral gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-r from-penpot-bg via-penpot-bg/85 to-transparent w-full md:w-3/4" />
        {/* 3. Top subtle dark overlay to protect navbar */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 via-black/20 to-transparent" />

        {/* Hero Content Stack (Aligned Bottom-Left) */}
        <div className="absolute bottom-8 sm:bottom-12 left-0 right-0 z-10 mx-auto max-w-[1560px] px-4 sm:px-6 md:px-8">
          <div className="space-y-4 sm:space-y-5 max-w-4xl">

            {/* Logo Image or Stylized Text Title (Penpot #logo) */}
            {logoUrl ? (
              <div className="relative h-20 sm:h-28 md:h-36 w-64 sm:w-80 md:w-[440px] max-w-full drop-shadow-2xl">
                <Image
                  src={logoUrl}
                  alt={movie.title}
                  fill
                  sizes="(max-width: 640px) 256px, (max-width: 768px) 320px, 440px"
                  className="object-contain object-left drop-shadow-xl"
                  priority
                />
              </div>
            ) : (
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-2xl">
                {movie.title}
              </h1>
            )}

            {/* Specifications Row (Penpot specifications) */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-semibold text-penpot-neutral-100">
              {/* IMDb or TMDB Rating */}
              {hasOmdbRating ? (
                <span className="inline-flex items-center gap-1.5 bg-black/40 border border-white/20 px-2.5 py-1 text-white font-bold rounded-[3px] backdrop-blur-md">
                  <Image src="/imdb.webp" alt="IMDb" width={1280} height={1280} sizes="16px" className="h-4 w-auto object-contain" />
                  <span>{omdbData.imdbRating}</span>
                  {omdbData.imdbVotes && omdbData.imdbVotes !== "N/A" && (
                    <span className="text-penpot-text-medium font-normal text-[11px]">
                      ({omdbData.imdbVotes})
                    </span>
                  )}
                </span>
              ) : movie.vote_average > 0 ? (
                <span className="inline-flex items-center gap-1 bg-black/40 border border-white/20 px-2.5 py-1 text-white font-bold rounded-[3px] backdrop-blur-md">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" />
                  <span>{formatRating(movie.vote_average)}</span>
                </span>
              ) : null}

              {/* Release Year */}
              {movie.release_date && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span>{new Date(movie.release_date).getFullYear()}</span>
                </>
              )}

              {/* Runtime */}
              {movie.runtime > 0 && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span>{formatRuntime(movie.runtime)}</span>
                </>
              )}

              {/* Status Badge */}
              {movie.status && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span className="bg-white/10 border border-white/20 px-2 py-0.5 uppercase text-[10px] tracking-wider font-extrabold text-penpot-neutral-200 rounded-[2px]">
                    {movie.status}
                  </span>
                </>
              )}
            </div>

            {/* Genres List (Penpot #genders) */}
            {movie.genres && movie.genres.length > 0 && (
              <p className="text-xs sm:text-sm font-medium text-penpot-neutral-100">
                {movie.genres.map((g) => g.name).join(", ")}
              </p>
            )}

            {/* Action Bar (Penpot Actions) */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {/* Primary Action Button (Play / Request / Downloading / Pending) */}
              {isInLibrary ? (
                <Button
                  size="md"
                  variant="play"
                  onClick={handlePlay}
                  className="px-6 h-12"
                >
                  <IconPlay className="size-4 fill-penpot-neutral-600 mr-1" />
                  Play
                </Button>
              ) : isDownloading ? (
                <Button size="md" variant="muted" disabled className="px-6 h-12">
                  <Loader2 className="size-4 animate-spin text-penpot-neutral-200 mr-2" />
                  Downloading {availability?.progress ? `${Math.round(availability.progress)}%` : ""}
                </Button>
              ) : isPending ? (
                <Button size="md" variant="outlined" disabled className="px-6 h-12 opacity-90 border-amber-500/40 text-amber-300">
                  Pending Approval
                </Button>
              ) : isRequested ? (
                <Button size="md" variant="muted" disabled className="px-6 h-12">
                  <Loader2 className="size-4 animate-spin text-penpot-neutral-200 mr-2" />
                  Requested
                </Button>
              ) : (
                <Button
                  size="md"
                  variant="request"
                  onClick={() => setShowRequestModal(true)}
                  className="px-6 h-12 gap-2"
                >
                  <IconPlus className="size-4 text-penpot-neutral-600 stroke-[2.5]" />
                  Request
                </Button>
              )}

              {/* Trailer Action Button (Penpot BaseButton) */}
              {hasVideos && (
                <Button
                  size="md"
                  variant="outline"
                  onClick={() => setShowTrailerModal(true)}
                  className="px-6 h-12 gap-2"
                >
                  <Film className="size-4 text-white" />
                  Trailer
                </Button>
              )}

              {/* Circular "Add to My List" Button with Tooltip (Penpot ButtonMiListToltip) */}
              <Tooltip content="Add to My List">
                <BookmarkButton
                  variant="circle"
                  itemId={availability?.jellyfinItemId || String(movie.id)}
                  tmdbId={movie.id}
                  jellyfinId={availability?.jellyfinItemId}
                  mediaType="movie"
                  title={movie.title}
                  posterPath={movie.poster_path}
                  overview={movie.overview}
                  releaseYear={movie.release_date ? new Date(movie.release_date).getFullYear().toString() : undefined}
                />
              </Tooltip>

              {/* Circular "Watch Party" Button with Tooltip (Penpot ButtonGroupToltip) */}
              {isInLibrary && availability?.jellyfinItemId && (
                <Tooltip content="Watch Party">
                  <button
                    onClick={() => setShowPartyModal(true)}
                    aria-label="Start Watch Party"
                    className="size-11 sm:size-12 min-h-[44px] min-w-[44px] sm:min-h-[48px] sm:min-w-[48px] rounded-full bg-black/20 hover:bg-white/20 active:bg-white/30 text-white border border-white backdrop-blur-md flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shadow-lg shrink-0"
                  >
                    <IconGroup className="size-5 text-white" />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* Story Synopsis Overview (Penpot #description) */}
            {movie.overview && (
              <div className="pt-2">
                <p className="text-sm sm:text-base leading-relaxed text-penpot-text-medium max-w-3xl font-normal line-clamp-3 sm:line-clamp-4">
                  {movie.overview}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Details Body (Penpot Content) ── */}
      <div className="mx-auto max-w-[1560px] px-4 sm:px-6 md:px-8 mt-10 space-y-12">
        {/* Cast & Story Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left 2 Columns: Full Story Overview & Cast Carousel */}
          <div className="lg:col-span-2 space-y-8">
            {/* Cast Carousel Section */}
            {cast.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-lg sm:text-xl font-bold uppercase tracking-tight text-white">
                  Cast & Crew
                </h3>
                <CastCarousel cast={cast} />
              </div>
            )}
          </div>

          {/* Right Column: Metadata Specifications Sidebar */}
          <div className="space-y-6 bg-white/[0.04] border border-white/5 p-6 rounded-lg">
            <h3 className="text-base font-bold uppercase tracking-wider text-white border-b border-penpot-border/60 pb-3">
              Movie Information
            </h3>

            <dl className="space-y-4 text-xs sm:text-sm">
              {directors.length > 0 && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Director</dt>
                  <dd className="font-medium text-white mt-1">
                    {directors.map((d) => d.name).join(", ")}
                  </dd>
                </div>
              )}

              {writers.length > 0 && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Writers</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {writers.map((w) => w.name).join(", ")}
                  </dd>
                </div>
              )}

              <div>
                <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Spoken Languages</dt>
                <dd className="font-medium text-penpot-text-medium mt-1">{spokenLanguages}</dd>
              </div>

              {movie.production_companies && movie.production_companies.length > 0 && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Studios</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {movie.production_companies.map((p) => p.name).join(", ")}
                  </dd>
                </div>
              )}

              {formatCurrency(movie.budget) && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Budget</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {formatCurrency(movie.budget)}
                  </dd>
                </div>
              )}

              {formatCurrency(movie.revenue) && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Box Office Revenue</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {formatCurrency(movie.revenue)}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* ── More Like This Section (Penpot similar/related) ── */}
        {relatedMovies.length > 0 && (
          <div className="pt-6">
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

      {/* ── Modals ── */}
      {/* Request Modal */}
      {showRequestModal && (
        <RequestModal
          tmdbId={movie.id}
          title={movie.title}
          type="movie"
          year={movie.release_date ? new Date(movie.release_date).getFullYear() : undefined}
          posterPath={movie.poster_path}
          backdropPath={movie.backdrop_path}
          onClose={() => setShowRequestModal(false)}
          onSuccess={handleRequestSuccess}
        />
      )}

      {/* Trailer Modal */}
      <TrailerModal
        isOpen={showTrailerModal}
        onClose={() => setShowTrailerModal(false)}
        title={movie.title}
        videos={movie.videos?.results}
      />

      {/* Watch Party Modal */}
      {isInLibrary && availability?.jellyfinItemId && (
        <StartPartyModal
          isOpen={showPartyModal}
          onClose={() => setShowPartyModal(false)}
          itemId={availability.jellyfinItemId}
          seriesId={null}
        />
      )}
    </div>
  )
}
