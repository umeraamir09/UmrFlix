"use client"

import { use, useState } from "react"
import Image from "next/image"
import useSWR from "swr"
import { Star, ShieldAlert, Film, Loader2 } from "lucide-react"
import { getImageUrl, formatRating } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Tooltip } from "@/components/ui/tooltip"
import { IconPlay, IconGroup, IconPlus } from "@/components/ui/icons"
import { RequestModal } from "@/components/RequestModal"
import { BookmarkButton } from "@/components/BookmarkButton"
import { SeasonBrowser } from "@/components/SeasonBrowser"
import { MovieRow } from "@/components/MovieRow"
import { CastCarousel } from "@/components/CastCarousel"
import { TrailerModal } from "@/components/TrailerModal"
import { StartPartyModal } from "@/components/party/StartPartyModal"
import { useAvailability } from "@/lib/use-availability"
import { useToast } from "@/components/Toast"
import { useRouter } from "next/navigation"
import type { TmdbTvDetail } from "@/lib/tmdb"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function TvDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast } = useToast()

  const { data, error, isLoading } = useSWR<TmdbTvDetail>(
    id
      ? `/api/tmdb/tv/${id}?append_to_response=credits,videos,images,recommendations,similar,external_ids,content_ratings&include_image_language=en,null`
      : null,
    fetcher
  )

  const imdbId = data?.external_ids?.imdb_id
  const { data: omdbData } = useSWR<{ imdbRating?: string; imdbVotes?: string; Response?: string }>(
    imdbId ? `/api/omdb?i=${imdbId}` : null,
    fetcher
  )

  const hasOmdbRating = omdbData?.Response !== "False" && omdbData?.imdbRating && omdbData.imdbRating !== "N/A"

  const showId = data?.id
  const { availability, refresh } = useAvailability(
    showId ? { tmdbId: showId, type: "tv" } : null
  )

  const [seasonsState, setSeasonsState] = useState<{
    downloadedSeasons: number[]
    missingSeasons: number[]
    hasMissingSeasons: boolean
  }>({ downloadedSeasons: [], missingSeasons: [], hasMissingSeasons: false })

  const [requestSeasonTarget, setRequestSeasonTarget] = useState<number | undefined>(undefined)
  const [showExplicitRequestModal, setShowExplicitRequestModal] = useState(false)
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
        <p className="text-xl font-bold text-white">Failed to load TV show details.</p>
        <p className="text-sm text-penpot-text-subtle mt-2">Please try again later or check your network connection.</p>
      </div>
    )
  }

  const show = data
  const tvdbId = show.external_ids?.tvdb_id ?? undefined

  // Extract logo URL if available
  const logoItem = show.images?.logos?.find((l) => l.iso_639_1 === "en") || show.images?.logos?.[0]
  const logoUrl = logoItem?.file_path ? getImageUrl(logoItem.file_path, "w500") : null

  // Creators & Cast
  const creators = show.created_by || []
  const cast = show.credits?.cast?.slice(0, 15) || []
  const contentRating = show.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating || "TV-14"

  // Spoken languages
  const spokenLanguages = show.spoken_languages?.map((l) => l.english_name || l.name).join(", ") || "Japanese, English"

  // Recommendations / Similar shows
  const relatedShows = show.recommendations?.results?.length
    ? show.recommendations.results
    : show.similar?.results || []

  // Check if trailer videos are available
  const hasVideos = Boolean(show.videos?.results && show.videos.results.length > 0)

  // Status & Availability calculations
  const isInLibrary = availability?.status === "in_library" && Boolean(availability.jellyfinItemId)
  const isDownloading = availability?.status === "downloading"
  const isPending = availability?.status === "pending"
  const isRequested = availability?.status === "in_radarr" || availability?.status === "in_sonarr"

  const handlePlay = () => {
    if (availability?.jellyfinItemId) {
      router.push(`/watch?id=${availability.jellyfinItemId}&type=tv`)
    }
  }

  const handleRequestSuccess = () => {
    setShowExplicitRequestModal(false)
    setRequestSeasonTarget(undefined)
    toast(`${show.name} request updated successfully!`, "success")
    refresh()
  }

  return (
    <div className="min-h-[100dvh] bg-penpot-bg text-white pb-20">
      {/* ── Hero Backdrop & Title Section (Penpot Hero/tvshow) ── */}
      <div className="relative h-[72dvh] min-h-[520px] max-h-[820px] w-full overflow-hidden bg-penpot-bg">
        {/* Backdrop Image */}
        {show.backdrop_path ? (
          <Image
            src={getImageUrl(show.backdrop_path, "w1280")}
            alt={show.name}
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
                  alt={show.name}
                  fill
                  sizes="(max-width: 640px) 256px, (max-width: 768px) 320px, 440px"
                  className="object-contain object-left drop-shadow-xl"
                  priority
                />
              </div>
            ) : (
              <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-2xl">
                {show.name}
              </h1>
            )}

            {/* Specifications Row (Penpot specifications) */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-semibold text-penpot-neutral-100">
              {/* Content Rating Badge */}
              <span className="bg-white/10 border border-white/20 px-2 py-0.5 uppercase text-[10px] sm:text-[11px] tracking-wider font-extrabold text-penpot-neutral-100 rounded-[2px]">
                {contentRating}
              </span>

              {/* Release Year */}
              {show.first_air_date && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span>{new Date(show.first_air_date).getFullYear()}</span>
                </>
              )}

              {/* Seasons Count */}
              {show.seasons && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span>{show.seasons.filter((s) => s.season_number > 0).length || show.number_of_seasons} Seasons</span>
                </>
              )}

              {/* IMDb or TMDB Rating */}
              {hasOmdbRating ? (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span className="inline-flex items-center gap-1.5 bg-black/40 border border-white/20 px-2.5 py-1 text-white font-bold rounded-[3px] backdrop-blur-md">
                    <Image src="/imdb.webp" alt="IMDb" width={1280} height={1280} sizes="16px" className="h-4 w-auto object-contain" />
                    <span>{omdbData.imdbRating}</span>
                    {omdbData.imdbVotes && omdbData.imdbVotes !== "N/A" && (
                      <span className="text-penpot-text-medium font-normal text-[11px]">
                        ({omdbData.imdbVotes})
                      </span>
                    )}
                  </span>
                </>
              ) : show.vote_average > 0 ? (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span className="inline-flex items-center gap-1 bg-black/40 border border-white/20 px-2.5 py-1 text-white font-bold rounded-[3px] backdrop-blur-md">
                    <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    <span>{formatRating(show.vote_average)}</span>
                  </span>
                </>
              ) : null}

              {/* Status Badge */}
              {show.status && (
                <>
                  <span className="text-penpot-text-subtle">•</span>
                  <span className="bg-white/10 border border-white/20 px-2 py-0.5 uppercase text-[10px] tracking-wider font-extrabold text-penpot-neutral-200 rounded-[2px]">
                    {show.status}
                  </span>
                </>
              )}
            </div>

            {/* Genres List (Penpot #genders) */}
            {show.genres && show.genres.length > 0 && (
              <p className="text-xs sm:text-sm font-medium text-penpot-neutral-100">
                {show.genres.map((g) => g.name).join(", ")}
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
                  onClick={() => setShowExplicitRequestModal(true)}
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
                  itemId={availability?.jellyfinItemId || String(show.id)}
                  tmdbId={show.id}
                  tvdbId={tvdbId}
                  jellyfinId={availability?.jellyfinItemId}
                  mediaType="tv"
                  title={show.name}
                  posterPath={show.poster_path}
                  overview={show.overview}
                  releaseYear={show.first_air_date ? new Date(show.first_air_date).getFullYear().toString() : undefined}
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

              {/* Circular "Request More Seasons" Button with Tooltip (Penpot rounded button) */}
              {(isInLibrary || isDownloading || isRequested) && (
                <Tooltip content="Request More Seasons">
                  <button
                    onClick={() => {
                      setRequestSeasonTarget(undefined)
                      setShowExplicitRequestModal(true)
                    }}
                    aria-label="Request More Seasons"
                    className="size-11 sm:size-12 min-h-[44px] min-w-[44px] sm:min-h-[48px] sm:min-w-[48px] rounded-full bg-black/20 hover:bg-white/20 active:bg-white/30 text-white border border-white backdrop-blur-md flex items-center justify-center transition-all duration-200 active:scale-95 cursor-pointer shadow-lg shrink-0"
                  >
                    <IconPlus className="size-5 text-white" />
                  </button>
                </Tooltip>
              )}
            </div>

            {/* Story Synopsis Overview (Penpot #description) */}
            {show.overview && (
              <div className="pt-2">
                <p className="text-sm sm:text-base leading-relaxed text-penpot-text-medium max-w-3xl font-normal line-clamp-3 sm:line-clamp-4">
                  {show.overview}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main Content Body ── */}
      <div className="mx-auto max-w-[1560px] px-4 sm:px-6 md:px-8 mt-10 space-y-12">
        {/* ── Seasons & Episodes Section (Penpot Episodes //Episodes) ── */}
        <SeasonBrowser
          tmdbId={show.id}
          showName={show.name}
          tmdbSeasons={show.seasons}
          seriesId={availability?.jellyfinItemId}
          tvdbId={tvdbId}
          availabilityStatus={availability?.status}
          onSeasonsStateChange={setSeasonsState}
          onRequestSeason={(seasonNum) => {
            setRequestSeasonTarget(seasonNum)
            setShowExplicitRequestModal(true)
          }}
        />

        {/* Cast & Story Details Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10 pt-4">
          {/* Left 2 Columns: Cast Carousel */}
          <div className="lg:col-span-2 space-y-8">
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
              Series Information
            </h3>

            <dl className="space-y-4 text-xs sm:text-sm">
              {creators.length > 0 && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Created By</dt>
                  <dd className="font-medium text-white mt-1">
                    {creators.map((c) => c.name).join(", ")}
                  </dd>
                </div>
              )}

              <div>
                <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Spoken Languages</dt>
                <dd className="font-medium text-penpot-text-medium mt-1">{spokenLanguages}</dd>
              </div>

              <div>
                <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px] flex items-center gap-1">
                  <ShieldAlert className="size-3 text-amber-400" /> Content Advisory
                </dt>
                <dd className="font-medium text-penpot-text-medium mt-1">
                  {contentRating} • General Audience & Suggested Dialogue
                </dd>
              </div>

              {show.networks && show.networks.length > 0 && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Networks / Platforms</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {show.networks.map((n) => n.name).join(", ")}
                  </dd>
                </div>
              )}

              {show.number_of_episodes != null && (
                <div>
                  <dt className="font-semibold text-penpot-text-subtle uppercase tracking-wider text-[11px]">Total Episodes</dt>
                  <dd className="font-medium text-penpot-text-medium mt-1">
                    {show.number_of_episodes} Episodes ({show.number_of_seasons || show.seasons?.length} Seasons)
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* ── More Like This Section (Penpot similar/related) ── */}
        {relatedShows.length > 0 && (
          <div className="pt-6">
            <MovieRow
              title="MORE LIKE THIS"
              subtitle="TV Series & Anime you might also enjoy based on this title"
              type="tv"
              customItems={relatedShows.map((s) => ({
                id: s.id,
                title: s.name,
                name: s.name,
                poster_path: s.poster_path,
                backdrop_path: s.backdrop_path,
                overview: s.overview,
                release_date: s.first_air_date,
                vote_average: s.vote_average,
                vote_count: s.vote_count,
                popularity: s.popularity,
                genre_ids: s.genre_ids,
              }))}
            />
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {/* Request Modal */}
      {showExplicitRequestModal && (
        <RequestModal
          tmdbId={show.id}
          title={show.name}
          type="tv"
          year={show.first_air_date ? new Date(show.first_air_date).getFullYear() : undefined}
          posterPath={show.poster_path}
          backdropPath={show.backdrop_path}
          tvdbId={tvdbId}
          seasonsCount={show.seasons?.length || show.number_of_seasons}
          initialSeasonMode={requestSeasonTarget || seasonsState.missingSeasons.length > 0 ? "custom" : "all"}
          initialSelectedSeasons={requestSeasonTarget ? [requestSeasonTarget] : seasonsState.missingSeasons}
          downloadedSeasons={seasonsState.downloadedSeasons}
          onClose={() => {
            setShowExplicitRequestModal(false)
            setRequestSeasonTarget(undefined)
          }}
          onSuccess={handleRequestSuccess}
        />
      )}

      {/* Trailer Modal */}
      <TrailerModal
        isOpen={showTrailerModal}
        onClose={() => setShowTrailerModal(false)}
        title={show.name}
        videos={show.videos?.results}
      />

      {/* Watch Party Modal */}
      {isInLibrary && availability?.jellyfinItemId && (
        <StartPartyModal
          isOpen={showPartyModal}
          onClose={() => setShowPartyModal(false)}
          itemId={null}
          seriesId={availability.jellyfinItemId}
        />
      )}
    </div>
  )
}
