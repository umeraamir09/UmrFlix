"use client"

import Image from "next/image"
import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"
import {
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  Play,
  Tv,
  Info,
  MoreVertical,
  ArrowUpDown,
  SlidersHorizontal,
} from "lucide-react"
import { CinemaPlayer } from "@/components/player/CinemaPlayer"
import type { NextEpisodeInfo } from "@/components/player/PlayerOverlays"
import { getImageUrl, formatDate } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export type EpisodeStatus = "in_library" | "downloading" | "missing" | "unaired"

export type SeasonInfo = {
  id: string | number
  name: string
  seasonNumber: number
  episodeCount: number
  imageUrl: string | null
}

export type EpisodeInfo = {
  id: string
  title: string
  seasonNumber: number
  episodeNumber: number
  seasonId?: string
  overview: string
  airDate: string | null
  runtimeMinutes: number | null
  status: EpisodeStatus
  downloadProgress?: number
  played: boolean
  playedPercentage: number
  resumeTicks: number
  thumbUrl: string
  jellyfinItemId?: string
}

type JellyfinEpisodesResponse = {
  seriesId: string
  seasons: SeasonInfo[]
  episodes: EpisodeInfo[]
  error?: string
}

type TmdbSeasonResponse = {
  id: number
  name: string
  overview: string
  season_number: number
  episodes: {
    id: number
    name: string
    overview: string
    episode_number: number
    season_number: number
    air_date: string | null
    runtime: number | null
    still_path: string | null
    vote_average: number
  }[]
}

function episodeLabel(ep: { seasonNumber: number; episodeNumber: number }): string {
  return `S${ep.seasonNumber}:E${ep.episodeNumber}`
}

function statusBadge(status: EpisodeStatus, downloadProgress?: number) {
  switch (status) {
    case "in_library":
      return (
        <span className="flex items-center gap-1 bg-success/90 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-md">
          <CheckCircle2 className="size-2.5" /> In Library
        </span>
      )
    case "downloading":
      return (
        <span className="flex items-center gap-1 bg-warning/90 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-black shadow-md">
          <Download className="size-2.5 animate-pulse" />
          {downloadProgress != null ? `${Math.round(downloadProgress)}%` : "Downloading"}
        </span>
      )
    case "unaired":
      return (
        <span className="bg-black/80 backdrop-blur-md px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-gray-300 shadow-md">
          Unaired
        </span>
      )
    default:
      return null
  }
}

interface SeasonBrowserProps {
  tmdbId?: number
  showName: string
  tmdbSeasons?: {
    id: number
    season_number: number
    episode_count: number
    name: string
    poster_path: string | null
  }[]
  seriesId?: string
  tvdbId?: number
}

export function SeasonBrowser({
  tmdbId,
  showName,
  tmdbSeasons = [],
  seriesId,
  tvdbId,
}: SeasonBrowserProps) {
  // Jellyfin Episodes SWR
  const { data: jellyfinData } = useSWR<JellyfinEpisodesResponse>(
    seriesId ? `/api/jellyfin/series/${seriesId}/episodes${tvdbId ? `?tvdbId=${tvdbId}` : ""}` : null,
    fetcher,
    { refreshInterval: 30_000 }
  )

  // Construct seasons list from TMDB or Jellyfin
  const seasons: SeasonInfo[] = useMemo(() => {
    if (tmdbSeasons && tmdbSeasons.length > 0) {
      return tmdbSeasons
        .filter((s) => s.season_number > 0)
        .map((s) => ({
          id: s.id,
          name: s.name || `Season ${s.season_number}`,
          seasonNumber: s.season_number,
          episodeCount: s.episode_count,
          imageUrl: s.poster_path ? getImageUrl(s.poster_path, "w185") : null,
        }))
    }
    if (jellyfinData?.seasons && jellyfinData.seasons.length > 0) {
      return jellyfinData.seasons
    }
    return [{ id: 1, name: "Season 1", seasonNumber: 1, episodeCount: 0, imageUrl: null }]
  }, [tmdbSeasons, jellyfinData])

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const currentSeason = selectedSeason ?? seasons[0]?.seasonNumber ?? 1

  const [isSeasonMenuOpen, setIsSeasonMenuOpen] = useState(false)
  const [isSortAscending, setIsSortAscending] = useState(true)

  // TMDB Season Detail SWR
  const { data: tmdbSeasonData, isLoading: isTmdbLoading } = useSWR<TmdbSeasonResponse>(
    tmdbId && currentSeason != null ? `/api/tmdb/tv/${tmdbId}/season/${currentSeason}` : null,
    fetcher
  )

  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null)

  // Combined Season Episodes List
  const seasonEpisodes = useMemo(() => {
    const jEpMap = new Map<number, EpisodeInfo>()
    if (jellyfinData?.episodes) {
      jellyfinData.episodes.forEach((e) => {
        if (e.seasonNumber === currentSeason) {
          jEpMap.set(e.episodeNumber, e)
        }
      })
    }

    let list: EpisodeInfo[] = []

    if (tmdbSeasonData?.episodes) {
      list = tmdbSeasonData.episodes.map((tmdbEp) => {
        const jEp = jEpMap.get(tmdbEp.episode_number)
        const isUnaired = tmdbEp.air_date ? new Date(tmdbEp.air_date) > new Date() : false
        
        const status: EpisodeStatus = jEp
          ? jEp.status
          : isUnaired
          ? "unaired"
          : "missing"

        return {
          id: jEp?.id || `tmdb-${tmdbEp.id}`,
          jellyfinItemId: jEp?.id,
          title: tmdbEp.name || jEp?.title || `Episode ${tmdbEp.episode_number}`,
          seasonNumber: currentSeason,
          episodeNumber: tmdbEp.episode_number,
          overview: tmdbEp.overview || jEp?.overview || "No overview available for this episode.",
          airDate: tmdbEp.air_date || jEp?.airDate || null,
          runtimeMinutes: tmdbEp.runtime || jEp?.runtimeMinutes || null,
          status,
          downloadProgress: jEp?.downloadProgress,
          played: jEp?.played ?? false,
          playedPercentage: jEp?.playedPercentage ?? 0,
          resumeTicks: jEp?.resumeTicks ?? 0,
          thumbUrl: tmdbEp.still_path
            ? getImageUrl(tmdbEp.still_path, "w500")
            : jEp?.thumbUrl || "https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?q=80&w=600&auto=format&fit=crop",
        }
      })
    } else if (jellyfinData?.episodes) {
      list = jellyfinData.episodes
        .filter((e) => e.seasonNumber === currentSeason)
    }

    return list.sort((a, b) =>
      isSortAscending ? a.episodeNumber - b.episodeNumber : b.episodeNumber - a.episodeNumber
    )
  }, [tmdbSeasonData, jellyfinData, currentSeason, isSortAscending])

  // Current active season info
  const activeSeasonInfo = seasons.find((s) => s.seasonNumber === currentSeason) || seasons[0]

  // Playable episodes for cinema player
  const playableEpisodes = useMemo(
    () => seasonEpisodes.filter((e) => e.status === "in_library" && e.jellyfinItemId),
    [seasonEpisodes]
  )

  const activeEpisode = useMemo(
    () => playableEpisodes.find((e) => e.jellyfinItemId === activeEpisodeId || e.id === activeEpisodeId) ?? null,
    [playableEpisodes, activeEpisodeId]
  )

  const nextPlayable = useMemo(() => {
    if (!activeEpisode) return null
    const idx = playableEpisodes.findIndex((e) => e.id === activeEpisode.id)
    return playableEpisodes[idx + 1] ?? null
  }, [playableEpisodes, activeEpisode])

  const toNextInfo = useCallback(
    (ep: EpisodeInfo): NextEpisodeInfo => ({
      id: ep.jellyfinItemId || ep.id,
      title: ep.title,
      label: episodeLabel(ep),
      imageUrl: ep.thumbUrl,
    }),
    []
  )

  return (
    <section className="mt-8 space-y-6">
      {/* ── Active cinema player ── */}
      {activeEpisode && activeEpisode.jellyfinItemId && (
        <div className="space-y-3 rounded-none border border-accent bg-black p-2 shadow-2xl">
          <CinemaPlayer
            itemId={activeEpisode.jellyfinItemId}
            title={`${showName} — ${episodeLabel(activeEpisode)}`}
            subtitle={activeEpisode.title}
            poster={activeEpisode.thumbUrl}
            autoPlay
            nextEpisode={nextPlayable ? toNextInfo(nextPlayable) : null}
            onNextEpisode={
              nextPlayable ? () => setActiveEpisodeId(nextPlayable.jellyfinItemId || nextPlayable.id) : undefined
            }
          />
        </div>
      )}

      {/* ── Top Header Control Bar (Matching Crunchyroll Style) ── */}
      <div className="relative flex items-center justify-between border-b border-border/80 pb-3">
        {/* Left Side: Season Dropdown Selector Button */}
        <div className="relative">
          <button
            onClick={() => setIsSeasonMenuOpen(!isSeasonMenuOpen)}
            className="flex items-center gap-2 text-base font-bold text-accent hover:text-accent-light transition-colors group focus:outline-none"
          >
            <ChevronDown className={`size-5 text-accent transition-transform duration-200 ${isSeasonMenuOpen ? "rotate-180" : ""}`} />
            <span className="font-extrabold uppercase tracking-tight text-accent">
              {activeSeasonInfo?.name || `Season ${currentSeason}`}
            </span>
          </button>

          {/* Crunchyroll Dark Dropdown Menu Overlay */}
          {isSeasonMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setIsSeasonMenuOpen(false)}
              />
              <div className="absolute left-0 top-full mt-2 z-40 w-72 bg-[#181a20] border border-border shadow-2xl divide-y divide-border/40 py-1 rounded-none animate-in fade-in slide-in-from-top-2 duration-150">
                {seasons.map((s) => {
                  const isSelected = s.seasonNumber === currentSeason
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSeason(s.seasonNumber)
                        setIsSeasonMenuOpen(false)
                      }}
                      className={`w-full flex items-center justify-between px-4 py-3 text-left transition-colors ${
                        isSelected
                          ? "bg-accent/15 text-accent font-extrabold"
                          : "text-gray-300 hover:bg-surface hover:text-white"
                      }`}
                    >
                      <span className="text-sm font-bold uppercase tracking-wider">{s.name}</span>
                      <span className="text-xs font-medium text-gray-500">
                        {s.episodeCount || 0} Episodes
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Right Side: Sort & Options Bar */}
        <div className="flex items-center gap-4 text-xs font-extrabold tracking-wider text-gray-400 uppercase">
          <button
            onClick={() => setIsSortAscending(!isSortAscending)}
            className="flex items-center gap-1.5 hover:text-white transition-colors"
          >
            <ArrowUpDown className="size-3.5 text-gray-500" />
            <span>{isSortAscending ? "OLDEST" : "NEWEST"}</span>
          </button>
        </div>
      </div>

      {/* ── Episodes Loading Skeleton ── */}
      {isTmdbLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {[...Array(10)].map((_, i) => (
            <div key={i} className="space-y-2 border border-border/30 bg-surface p-2 animate-pulse">
              <div className="aspect-video w-full bg-card" />
              <div className="h-3 w-1/2 bg-card" />
              <div className="h-3.5 w-3/4 bg-card" />
            </div>
          ))}
        </div>
      )}

      {/* ── Crunchyroll Style Episode Grid ── */}
      {!isTmdbLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-5">
          {seasonEpisodes.map((ep) => {
            const playable = ep.status === "in_library" && Boolean(ep.jellyfinItemId)
            const isActive = (ep.jellyfinItemId && ep.jellyfinItemId === activeEpisodeId) || ep.id === activeEpisodeId

            return (
              <div
                key={ep.id}
                className={`group relative flex flex-col justify-between overflow-hidden transition-all duration-200 ${
                  isActive
                    ? "border-accent ring-1 ring-accent"
                    : "border-border/50 hover:border-accent/80"
                }`}
              >
                {/* ── 1. Regular Card State ── */}
                <div>
                  {/* Widescreen Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-card">
                    <Image
                      src={ep.thumbUrl}
                      alt={ep.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 33vw, 20vw"
                      className="object-cover transition-transform duration-500"
                      unoptimized
                    />

                    {/* Top Left Status Badge */}
                    {ep.status !== "missing" && (
                      <div className="absolute left-2 top-2 z-10">
                        {statusBadge(ep.status, ep.downloadProgress)}
                      </div>
                    )}

                    {/* Crunchyroll Duration Badge (Bottom Right 23m) */}
                    {ep.runtimeMinutes != null && ep.runtimeMinutes > 0 && (
                      <div className="absolute right-1.5 bottom-1.5 z-10 bg-black/85 border border-white/10 px-1.5 py-0.5 text-[11px] font-mono font-bold text-white shadow-md">
                        {ep.runtimeMinutes}m
                      </div>
                    )}

                    {/* Watch Progress Bar */}
                    {ep.playedPercentage > 0 && !ep.played && (
                      <div className="absolute inset-x-0 bottom-0 z-10 h-1 bg-gray-900">
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${Math.min(100, ep.playedPercentage)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Below Thumbnail Info */}
                  <div className="p-3 space-y-1">
                    {/* Show Name Header (Tiny uppercase font) */}
                    <p className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400 line-clamp-1">
                      {showName}
                    </p>

                    {/* Episode Number & Title */}
                    <h4 className="text-xs sm:text-sm font-bold text-white leading-snug line-clamp-1 group-hover:text-accent transition-colors">
                      E{ep.episodeNumber} – {ep.title}
                    </h4>

                    {/* Footer Row: Dub | Sub & Options */}
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium pt-1">
                      <span>Dub | Sub</span>
                      <button className="hover:text-white transition-colors" aria-label="Options">
                        <MoreVertical className="size-3.5 text-gray-400" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* ── 2. Crunchyroll Hover/Active Overview Overlay Card (Look at E3 in reference image!) ── */}
                <div className="absolute inset-0 z-20 bg-[#16181f]/95 backdrop-blur-sm p-3.5 flex flex-col justify-between opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-2xl pointer-events-none group-hover:pointer-events-auto">
                  <div className="space-y-1.5">

                    {/* Episode Title */}
                    <h4 className="text-base font-bold text-white line-clamp-1">
                      E{ep.episodeNumber} – {ep.title}
                    </h4>

                    {/* Air Date */}
                    {ep.airDate && (
                      <p className="flex items-center gap-1 text-xs font-medium text-gray-400">
                        <Calendar className="size-3 text-gray-400" />
                        {formatDate(ep.airDate)}
                      </p>
                    )}

                    {/* Overview Paragraph */}
                    <p className="text-sm leading-relaxed text-gray-300 line-clamp-4 pt-1">
                      {ep.overview}
                    </p>
                  </div>

                  {/* Bottom Play Action CTA Button */}
                  <div className="pt-3 border-t border-border/50 mt-auto">
                    {playable ? (
                      <button
                        onClick={() => ep.jellyfinItemId && setActiveEpisodeId(ep.jellyfinItemId)}
                        className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-accent hover:text-accent-light transition-colors active:scale-95"
                      >
                        <Play className="size-4 fill-accent text-accent" />
                        PLAY E{ep.episodeNumber}
                      </button>
                    ) : (
                      <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-gray-400">
                        <Info className="size-3.5 text-gray-500" />
                        {ep.status === "unaired" ? "UNAIRED" : "NOT STREAMABLE YET"}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {seasonEpisodes.length === 0 && !isTmdbLoading && (
        <p className="text-sm text-gray-400 py-8 text-center border border-dashed border-border/60">
          No episode details available for this season.
        </p>
      )}
    </section>
  )
}
