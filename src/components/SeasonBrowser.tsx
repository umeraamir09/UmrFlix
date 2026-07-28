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
} from "lucide-react"
import { CinemaPlayer } from "@/components/player/CinemaPlayer"
import type { NextEpisodeInfo } from "@/components/player/PlayerOverlays"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export type EpisodeStatus = "in_library" | "downloading" | "missing" | "unaired"

export type SeasonInfo = {
  id: string
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
  runtimeTicks: number
  status: EpisodeStatus
  downloadProgress?: number
  played: boolean
  playedPercentage: number
  resumeTicks: number
  thumbUrl: string
}

type EpisodesResponse = {
  seriesId: string
  seasons: SeasonInfo[]
  episodes: EpisodeInfo[]
  error?: string
}

function episodeLabel(ep: EpisodeInfo): string {
  return `S${ep.seasonNumber}:E${ep.episodeNumber}`
}

function statusBadge(ep: EpisodeInfo) {
  switch (ep.status) {
    case "in_library":
      return (
        <span className="flex items-center gap-1 rounded bg-success/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-success">
          <CheckCircle2 className="size-3" /> In Library
        </span>
      )
    case "downloading":
      return (
        <span className="flex items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning">
          <Download className="size-3 animate-pulse" />
          {ep.downloadProgress != null ? `${Math.round(ep.downloadProgress)}%` : "Downloading"}
        </span>
      )
    case "unaired":
      return (
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Unaired
        </span>
      )
    default:
      return (
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
          Missing
        </span>
      )
  }
}

export function SeasonBrowser({
  seriesId,
  tvdbId,
  showName,
}: {
  seriesId: string
  tvdbId?: number
  showName: string
}) {
  const { data, error, isLoading } = useSWR<EpisodesResponse>(
    seriesId ? `/api/jellyfin/series/${seriesId}/episodes${tvdbId ? `?tvdbId=${tvdbId}` : ""}` : null,
    fetcher,
    { refreshInterval: 30_000 },
  )

  const [selectedSeason, setSelectedSeason] = useState<number | null>(null)
  const [activeEpisodeId, setActiveEpisodeId] = useState<string | null>(null)

  const seasons = useMemo(() => data?.seasons ?? [], [data])
  const episodes = useMemo(() => data?.episodes ?? [], [data])

  // Default to the first real season once data lands
  const currentSeason = selectedSeason ?? seasons[0]?.seasonNumber ?? null
  const seasonEpisodes = useMemo(
    () =>
      episodes
        .filter((e) => e.seasonNumber === currentSeason)
        .sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes, currentSeason],
  )

  // Global flat order (across seasons) for next-episode resolution
  const allOrdered = useMemo(
    () =>
      [...episodes].sort(
        (a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber,
      ),
    [episodes],
  )
  const activeEpisode = allOrdered.find((e) => e.id === activeEpisodeId) ?? null
  const nextPlayable = useMemo(() => {
    if (!activeEpisode) return null
    const idx = allOrdered.findIndex((e) => e.id === activeEpisode.id)
    return allOrdered.slice(idx + 1).find((e) => e.status === "in_library") ?? null
  }, [allOrdered, activeEpisode])

  const toNextInfo = useCallback(
    (ep: EpisodeInfo): NextEpisodeInfo => ({
      id: ep.id,
      title: ep.title,
      label: episodeLabel(ep),
      imageUrl: ep.thumbUrl,
    }),
    [],
  )

  if (isLoading) {
    return (
      <div className="mt-6 space-y-4">
        <div className="h-10 w-full max-w-md animate-pulse rounded bg-[#1a1c23]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="aspect-video animate-pulse rounded-md bg-[#1a1c23]" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data) {
    return <p className="mt-6 text-sm text-muted">Failed to load episodes.</p>
  }

  return (
    <section className="mt-8 space-y-6">
      {/* ── Active cinema player ── */}
      {activeEpisode && (
        <div className="space-y-3">
          <CinemaPlayer
            itemId={activeEpisode.id}
            title={`${showName} — ${episodeLabel(activeEpisode)}`}
            subtitle={activeEpisode.title}
            poster={activeEpisode.thumbUrl}
            autoPlay
            nextEpisode={nextPlayable ? toNextInfo(nextPlayable) : null}
            onNextEpisode={
              nextPlayable ? () => setActiveEpisodeId(nextPlayable.id) : undefined
            }
          />
        </div>
      )}

      {/* ── Season selector ── */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar" role="tablist">
        {seasons.map((season) => {
          const isActive = season.seasonNumber === currentSeason
          return (
            <button
              key={season.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSelectedSeason(season.seasonNumber)}
              className={`flex shrink-0 items-center gap-2.5 rounded-md border px-3 py-2 transition-all ${
                isActive
                  ? "border-accent bg-accent/10 text-white"
                  : "border-[#282c37] bg-[#141519] text-gray-400 hover:border-gray-500 hover:text-white"
              }`}
            >
              {season.imageUrl ? (
                <span className="relative block h-10 w-7 overflow-hidden rounded">
                  <Image
                    src={season.imageUrl}
                    alt={season.name}
                    fill
                    sizes="28px"
                    className="object-cover"
                    unoptimized
                  />
                </span>
              ) : (
                <Tv className="size-4" />
              )}
              <span className="text-left">
                <span className={`block text-xs font-extrabold uppercase tracking-wider ${isActive ? "text-accent" : ""}`}>
                  {season.name}
                </span>
                <span className="block text-[10px] font-medium text-gray-500">
                  {season.episodeCount} episode{season.episodeCount === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Episode grid ── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {seasonEpisodes.map((ep) => {
          const playable = ep.status === "in_library"
          const isActive = ep.id === activeEpisodeId
          return (
            <div
              key={ep.id}
              className={`group overflow-hidden rounded-md border bg-[#141519] transition-all ${
                isActive
                  ? "border-accent"
                  : playable
                    ? "border-[#282c37]/70 hover:border-accent/60"
                    : "border-[#282c37]/40 opacity-75"
              }`}
            >
              {/* thumbnail */}
              <button
                disabled={!playable}
                onClick={() => setActiveEpisodeId(ep.id)}
                className="relative block aspect-video w-full overflow-hidden bg-[#1a1c23] disabled:cursor-not-allowed"
              >
                <Image
                  src={ep.thumbUrl}
                  alt={ep.title}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                  unoptimized
                />
                {/* status badge */}
                <div className="absolute left-2 top-2">{statusBadge(ep)}</div>
                {/* play overlay */}
                {playable && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    <span className="flex size-11 items-center justify-center rounded-full bg-accent text-white shadow-lg">
                      <Play className="ml-0.5 size-5 fill-white" />
                    </span>
                  </div>
                )}
                {/* resume progress bar */}
                {ep.playedPercentage > 0 && !ep.played && (
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-gray-800">
                    <div
                      className="h-full bg-accent"
                      style={{ width: `${Math.min(100, ep.playedPercentage)}%` }}
                    />
                  </div>
                )}
              </button>

              {/* metadata */}
              <div className="space-y-1.5 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-accent">
                    {episodeLabel(ep)}
                  </span>
                  <span className="flex items-center gap-2 text-[10px] font-medium text-gray-500">
                    {ep.runtimeMinutes != null && (
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {ep.runtimeMinutes}m
                      </span>
                    )}
                    {ep.airDate && (
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {new Date(ep.airDate).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    )}
                    {ep.played && <CheckCircle2 className="size-3.5 text-success" />}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="line-clamp-1 text-sm font-bold text-white">{ep.title}</h4>
                  {playable && (
                    <button
                      onClick={() => setActiveEpisodeId(ep.id)}
                      className="flex shrink-0 items-center gap-1 rounded bg-accent px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
                    >
                      <Play className="size-3 fill-white" />
                      {ep.resumeTicks > 0 && !ep.played ? "Resume" : "Play"}
                    </button>
                  )}
                </div>
                {ep.overview && (
                  <p className="line-clamp-2 text-xs leading-relaxed text-gray-400">
                    {ep.overview}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {seasonEpisodes.length === 0 && (
        <p className="text-sm text-muted">No episodes found for this season.</p>
      )}

      {/* mobile season quick-jump */}
      {seasons.length > 1 && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 sm:hidden">
          <ChevronDown className="size-3.5" /> Swipe to switch seasons
        </div>
      )}
    </section>
  )
}
