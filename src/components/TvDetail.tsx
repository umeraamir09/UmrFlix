"use client"

import { use, useState } from "react"
import useSWR from "swr"
import { getImageUrl, formatRating, formatDate } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { RequestButton } from "@/components/RequestButton"
import { RequestModal } from "@/components/RequestModal"
import { BookmarkButton } from "@/components/BookmarkButton"
import { SeasonBrowser } from "@/components/SeasonBrowser"
import { MovieRow } from "@/components/MovieRow"
import { CastCarousel } from "@/components/CastCarousel"
import { useAvailability } from "@/lib/use-availability"
import { Star, Calendar, Tv, Globe, ShieldAlert } from "lucide-react"
import type { TmdbTvDetail } from "@/lib/tmdb"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function formatNumber(num?: number): string {
  if (!num) return ""
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toString()
}

export function TvDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, error, isLoading } = useSWR<TmdbTvDetail>(
    id ? `/api/tmdb/tv/${id}?append_to_response=credits,videos,images,recommendations,similar,external_ids,content_ratings&include_image_language=en,null` : null,
    fetcher
  )

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
        <p className="text-lg font-bold text-white">Failed to load TV show details.</p>
        <p className="text-sm text-gray-500 mt-1">Please try again later or check your network connection.</p>
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

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      {/* ── Hero Backdrop & Title Section ── */}
      <div className="relative h-[65vh] min-h-[500px] max-h-[750px] w-full overflow-hidden bg-background">
        {show.backdrop_path ? (
          <img
            src={getImageUrl(show.backdrop_path, "w1280")}
            alt={show.name}
            className="size-full object-cover object-center"
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
                <span className="bg-accent/20 px-2 py-0.5 border border-accent/40">SERIES</span>
              </div>
              <div className="w-36 sm:w-44 md:w-52 shrink-0 overflow-hidden rounded-none border border-border shadow-2xl hidden sm:block">
                <img
                  src={getImageUrl(show.poster_path, "w500")}
                  alt={show.name}
                  className="w-full h-auto object-cover"
                />
              </div>
            </div>

            {/* Title / Logo / Metadata Details */}
            <div className="space-y-4 max-w-3xl">

              {/* Logo image or text title */}
              {logoUrl ? (
                <div className="relative h-20 sm:h-28 md:h-32 w-64 sm:w-80 md:w-[420px] drop-shadow-2xl my-2">
                  <img
                    src={logoUrl}
                    alt={show.name}
                    className="max-h-full max-w-full object-contain object-left drop-shadow-xl"
                  />
                </div>
              ) : (
                <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white leading-tight drop-shadow-lg">
                  {show.name}
                </h1>
              )}

              {/* Tagline */}
              {show.tagline && (
                <p className="text-sm italic text-gray-300 font-medium">{`"${show.tagline}"`}</p>
              )}

              {/* Metadata Badges */}
              <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-gray-300">
                {show.vote_average > 0 && (
                  <span className="flex items-center gap-1 bg-surface/90 border border-border px-2.5 py-1 text-white font-bold">
                    <Star className="size-4 fill-warning text-warning" />
                    {formatRating(show.vote_average)}
                    {show.vote_count > 0 && (
                      <span className="text-gray-400 font-normal text-[11px]">
                        ({formatNumber(show.vote_count)})
                      </span>
                    )}
                  </span>
                )}
                {show.first_air_date && (
                  <span className="flex items-center gap-1.5 bg-surface/90 border border-border px-2.5 py-1">
                    <Calendar className="size-3.5 text-accent" />
                    {formatDate(show.first_air_date)}
                  </span>
                )}
                {show.seasons && (
                  <span className="flex items-center gap-1.5 bg-surface/90 border border-border px-2.5 py-1">
                    <Tv className="size-3.5 text-accent" />
                    {show.seasons.length} Seasons
                  </span>
                )}
                <span className="bg-surface/90 border border-border px-2.5 py-1 uppercase text-[10px] tracking-wider font-extrabold text-accent">
                  {contentRating}
                </span>
                {show.status && (
                  <span className="bg-surface/90 border border-border px-2.5 py-1 uppercase text-[10px] tracking-wider font-extrabold text-gray-400">
                    {show.status}
                  </span>
                )}
              </div>

              {/* Genres */}
              <div className="flex flex-wrap gap-2 pt-1">
                {show.genres?.map((g) => (
                  <Badge key={g.id} variant="default" className="rounded-none bg-surface hover:bg-card border border-border text-xs px-2.5 py-0.5">
                    {g.name}
                  </Badge>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <RequestButton
                  type="tv"
                  tmdbId={show.id}
                  title={show.name}
                  year={show.first_air_date ? new Date(show.first_air_date).getFullYear() : undefined}
                  posterPath={show.poster_path}
                  backdropPath={show.backdrop_path}
                  tvdbId={tvdbId}
                  seasonsCount={show.seasons?.length || show.number_of_seasons}
                  availability={availability}
                  onStatusChange={refresh}
                  hasMissingSeasons={seasonsState.hasMissingSeasons}
                  missingSeasons={seasonsState.missingSeasons}
                  downloadedSeasons={seasonsState.downloadedSeasons}
                />

                <BookmarkButton
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
            {/* Show Synopsis */}
            <div className="space-y-3">
              <p className="text-base sm:text-lg leading-relaxed text-gray-300">
                {show.overview || "No overview available for this show."}
              </p>
            </div>

            {/* Scrollable Cast Carousel with Navigation Arrows */}
            <CastCarousel cast={cast} />
          </div>

          {/* Right Sidebar Metadata Details (Open Design) */}
          <div className="space-y-6">
            <div className="space-y-4">
              <dl className="space-y-4 text-xs">
                {creators.length > 0 && (
                  <div className="pt-2">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Created By</dt>
                    <dd className="text-sm font-semibold text-white mt-0.5">
                      {creators.map((c) => c.name).join(", ")}
                    </dd>
                  </div>
                )}

                <div className="pt-3">
                  <dt className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Globe className="size-3.5 text-accent" /> Spoken Languages
                  </dt>
                  <dd className="text-sm font-medium text-gray-200 mt-0.5">{spokenLanguages}</dd>
                </div>

                <div className="pt-3">
                  <dt className="font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="size-3.5 text-warning" /> Content Advisory
                  </dt>
                  <dd className="text-sm font-medium text-gray-200 mt-0.5">
                    {contentRating} • Violence, Suggested Dialogue
                  </dd>
                </div>

                {show.networks && show.networks.length > 0 && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Networks / Platforms</dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {show.networks.map((n) => n.name).join(", ")}
                    </dd>
                  </div>
                )}

                {show.number_of_episodes != null && (
                  <div className="pt-3">
                    <dt className="font-bold text-gray-400 uppercase tracking-wider">Total Episodes</dt>
                    <dd className="text-sm font-medium text-gray-200 mt-0.5">
                      {show.number_of_episodes} Episodes ({show.number_of_seasons || show.seasons?.length} Seasons)
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        </div>

        {/* ── Season & Episode Previews Section ── */}
        <div className="pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-white flex items-center gap-2">
              <Tv className="size-6 text-accent" /> EPISODES & SEASONS
            </h2>
          </div>

          <SeasonBrowser
            tmdbId={show.id}
            showName={show.name}
            tmdbSeasons={show.seasons}
            seriesId={availability?.jellyfinItemId}
            tvdbId={tvdbId}
            onSeasonsStateChange={setSeasonsState}
            onRequestSeason={(seasonNum) => {
              setRequestSeasonTarget(seasonNum)
              setShowExplicitRequestModal(true)
            }}
          />
        </div>

        {/* ── More Like This Section ── */}
        {relatedShows.length > 0 && (
          <div className="pt-8">
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
          onSuccess={() => {
            setShowExplicitRequestModal(false)
            setRequestSeasonTarget(undefined)
            refresh()
          }}
        />
      )}
    </div>
  )
}

