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
} from "lucide-react"
import { CinemaPlayer } from "@/components/player/CinemaPlayer"
import type { NextEpisodeInfo } from "@/components/player/PlayerOverlays"
import { getImageUrl } from "@/lib/utils"

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
        <span className="flex items-center gap-1 bg-success/90 backdrop-blur-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white shadow-md">
          <CheckCircle2 className="size-3" /> In Library
        </span>
      )
    case "downloading":
      return (
        <span className="flex items-center gap-1 bg-warning/90 backdrop-blur-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black shadow-md">
          <Download className="size-3 animate-pulse" />
          {downloadProgress != null ? `${Math.round(downloadProgress)}%` : "Downloading"}
        </span>
      )
    case "unaired":
      return (
        <span className="bg-black/70 backdrop-blur-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-gray-300 shadow-md">
          Unaired
        </span>
      )
    default:
      return (
        <span className="bg-black/60 backdrop-blur-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-gray-400 shadow-md">
          Missing
        </span>
      )
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
        .filter((s) => s.season_number > 0) // Exclude Specials/Season 0 from main list if needed, or include all
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

  // TMDB Season Detail SWR
  const { data: tmdbSeasonData, isLoading: isTmdbLoading } = useSWR<TmdbSeasonResponse>(
    tmdbId && currentSeason != null ? `/api/tmdb/tv/${tmdbId}/season/${currentSeason}` : null,
    fetcher
  )

  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null)
  const [expandedOverviewId, setExpandedOverviewId] = useState<string | null>(null)

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

    if (tmdbSeasonData?.episodes) {
      return tmdbSeasonData.episodes.map((tmdbEp) => {
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
    }

    // Fallback if TMDB season is loading and Jellyfin data exists
    if (jellyfinData?.episodes) {
      return jellyfinData.episodes
        .filter((e) => e.seasonNumber === currentSeason)
        .sort((a, b) => a.episodeNumber - b.episodeNumber)
    }

    return []
  }, [tmdbSeasonData, jellyfinData, currentSeason])

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
    <section className="mt-10 space-y-6">
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

      {/* ── Season Header & Controls Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          {/* Season Dropdown Selector (Matching Reference Image 2) */}
          <div className="relative">
            <select
              value={currentSeason}
              onChange={(e) => setSelectedSeason(Number(e.target.value))}
              className="appearance-none bg-surface text-white border border-border px-4 py-2.5 pr-10 font-black text-sm uppercase tracking-wider cursor-pointer focus:outline-none focus:border-accent hover:border-gray-500 transition-colors"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.seasonNumber} className="bg-surface text-white py-2">
                  {s.name} ({s.episodeCount || seasonEpisodes.length} Episodes)
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-gray-400 pointer-events-none" />
          </div>

          <span className="text-xs text-gray-400 font-medium">
            {seasonEpisodes.length} Episodes
          </span>
        </div>

        {/* Season Quick Tab Pills */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1" role="tablist">
          {seasons.map((season) => {
            const isActive = season.seasonNumber === currentSeason
            return (
              <button
                key={season.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedSeason(season.seasonNumber)}
                className={`flex shrink-0 items-center gap-2 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-all ${
                  isActive
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-gray-400 hover:border-gray-500 hover:text-white"
                }`}
              >
                <span>S{season.seasonNumber}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Episodes Loading Skeleton ── */}
      {isTmdbLoading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="space-y-3 border border-border/40 bg-surface p-3 animate-pulse">
              <div className="aspect-video w-full bg-card" />
              <div className="h-4 w-3/4 bg-card" />
              <div className="h-3 w-1/2 bg-card" />
            </div>
          ))}
        </div>
      )}

      {/* ── Episode Grid ── */}
      {!isTmdbLoading && (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {seasonEpisodes.map((ep) => {
            const playable = ep.status === "in_library" && Boolean(ep.jellyfinItemId)
            const isActive = (ep.jellyfinItemId && ep.jellyfinItemId === activeEpisodeId) || ep.id === activeEpisodeId
            const isOverviewExpanded = expandedOverviewId === ep.id

            return (
              <div
                key={ep.id}
                className={`group flex flex-col justify-between overflow-hidden border bg-surface transition-all duration-200 ${
                  isActive
                    ? "border-accent ring-1 ring-accent"
                    : playable
                    ? "border-border/80 hover:border-accent/70 hover:shadow-xl"
                    : "border-border/40 hover:border-border/80"
                }`}
              >
                <div>
                  {/* Episode Thumbnail Container */}
                  <div className="relative aspect-video w-full overflow-hidden bg-card">
                    <Image
                      src={ep.thumbUrl}
                      alt={ep.title}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-cover transition-transform duration-500 group-hover:scale-105"
                      unoptimized
                    />

                    {/* Top Left Status Badge */}
                    <div className="absolute left-2.5 top-2.5 z-10">
                      {statusBadge(ep.status, ep.downloadProgress)}
                    </div>

                    {/* Bottom Right Duration Badge */}
                    {ep.runtimeMinutes != null && ep.runtimeMinutes > 0 && (
                      <div className="absolute right-2.5 bottom-2.5 z-10 flex items-center gap-1 bg-black/80 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white shadow-md">
                        <Clock className="size-3 text-accent" />
                        <span>{ep.runtimeMinutes}m</span>
                      </div>
                    )}

                    {/* Hover Play Button Overlay */}
                    {playable && (
                      <button
                        onClick={() => ep.jellyfinItemId && setActiveEpisodeId(ep.jellyfinItemId)}
                        className="absolute inset-0 z-20 flex items-center justify-center bg-black/50 opacity-0 transition-opacity duration-200 group-hover:opacity-100 cursor-pointer"
                        aria-label={`Play E${ep.episodeNumber}`}
                      >
                        <span className="flex size-14 items-center justify-center bg-accent text-white shadow-2xl hover:scale-110 transition-transform active:scale-95">
                          <Play className="ml-1 size-7 fill-white" />
                        </span>
                      </button>
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

                  {/* Episode Metadata Details */}
                  <div className="p-4 space-y-2">
                    {/* Episode Number & Air Date */}
                    <div className="flex items-center justify-between gap-2 text-xs font-black tracking-widest text-accent uppercase">
                      <span>E{ep.episodeNumber} • EPISODE {ep.episodeNumber}</span>
                      {ep.airDate && (
                        <span className="flex items-center gap-1 text-[10px] font-medium text-gray-400 tracking-normal normal-case">
                          <Calendar className="size-3 text-gray-500" />
                          {new Date(ep.airDate).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      )}
                    </div>

                    {/* Title */}
                    <h4 className="text-sm font-bold text-white leading-snug line-clamp-1 group-hover:text-accent transition-colors">
                      {ep.title}
                    </h4>

                    {/* Overview snippet */}
                    <p className={`text-xs leading-relaxed text-gray-400 ${isOverviewExpanded ? "" : "line-clamp-3"}`}>
                      {ep.overview}
                    </p>
                    {ep.overview.length > 120 && (
                      <button
                        onClick={() => setExpandedOverviewId(isOverviewExpanded ? null : ep.id)}
                        className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-white transition-colors"
                      >
                        {isOverviewExpanded ? "Show Less" : "Show Overview"}
                      </button>
                    )}
                  </div>
                </div>

                {/* Bottom Action Footer */}
                <div className="p-4 pt-0">
                  {playable ? (
                    <button
                      onClick={() => ep.jellyfinItemId && setActiveEpisodeId(ep.jellyfinItemId)}
                      className="w-full flex items-center justify-center gap-2 bg-accent px-4 py-2.5 text-xs font-black uppercase tracking-wider text-white shadow-lg hover:bg-accent-hover active:scale-98 transition-all"
                    >
                      <Play className="size-4 fill-white" />
                      PLAY E{ep.episodeNumber}
                    </button>
                  ) : (
                    <div className="w-full flex items-center justify-between border border-border/60 bg-black/40 px-3 py-2 text-[11px] font-medium text-gray-400">
                      <span className="flex items-center gap-1.5">
                        <Info className="size-3.5 text-gray-500" />
                        {ep.status === "unaired" ? "Coming Soon" : "Not Streamable Yet"}
                      </span>
                      <span className="uppercase text-[9px] font-extrabold text-gray-500">
                        {ep.status}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {seasonEpisodes.length === 0 && !isTmdbLoading && (
        <p className="text-sm text-gray-400 py-6 text-center border border-dashed border-border">
          No episode details available for this season.
        </p>
      )}
    </section>
  )
}
