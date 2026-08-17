"use client"

import { useMemo, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import useSWR, { useSWRConfig } from "swr"
import { ArrowUpDown, Plus, Layers, ChevronDown } from "lucide-react"
import { EpisodeCard } from "@/components/EpisodeCard"
import { Tooltip } from "@/components/ui/tooltip"
import { useToast } from "@/components/Toast"
import { getImageUrl } from "@/lib/utils"
import { cn } from "@/lib/utils"

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
  availabilityStatus?: string
  onRequestSeason?: (seasonNumber?: number) => void
  onSeasonsStateChange?: (state: {
    downloadedSeasons: number[]
    missingSeasons: number[]
    hasMissingSeasons: boolean
  }) => void
}

export function SeasonBrowser({
  tmdbId,
  showName,
  tmdbSeasons = [],
  seriesId,
  tvdbId,
  availabilityStatus,
  onRequestSeason,
  onSeasonsStateChange,
}: SeasonBrowserProps) {
  const router = useRouter()
  const { toast } = useToast()
  const { mutate } = useSWRConfig()

  // Jellyfin Episodes SWR
  const { data: jellyfinData, mutate: mutateEpisodes } = useSWR<JellyfinEpisodesResponse>(
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

  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [isSortAscending, setIsSortAscending] = useState(true)
  const [expandedSeason, setExpandedSeason] = useState<number | null>(null)

  const showAllEpisodes = expandedSeason === currentSeason

  // Calculate downloaded vs missing seasons across all TMDB seasons
  const { downloadedSeasons, missingSeasons, hasMissingSeasons } = useMemo(() => {
    const dl = new Set<number>()
    const miss = new Set<number>()

    const tmdbSeasonNums = (tmdbSeasons || [])
      .filter((s) => s.season_number > 0)
      .map((s) => s.season_number)

    if (jellyfinData?.episodes && jellyfinData.episodes.length > 0) {
      const episodesBySeason = new Map<number, EpisodeInfo[]>()
      jellyfinData.episodes.forEach((ep) => {
        if (ep.seasonNumber > 0) {
          const arr = episodesBySeason.get(ep.seasonNumber) || []
          arr.push(ep)
          episodesBySeason.set(ep.seasonNumber, arr)
        }
      })

      tmdbSeasonNums.forEach((sNum) => {
        const eps = episodesBySeason.get(sNum)
        if (eps && eps.length > 0) {
          const inLibCount = eps.filter((e) => e.status === "in_library").length
          if (inLibCount === eps.length) {
            dl.add(sNum)
          } else {
            miss.add(sNum)
          }
        } else {
          miss.add(sNum)
        }
      })
    } else if (tmdbSeasonNums.length > 0) {
      tmdbSeasonNums.forEach((sNum) => miss.add(sNum))
    }

    return {
      downloadedSeasons: Array.from(dl),
      missingSeasons: Array.from(miss),
      hasMissingSeasons: miss.size > 0,
    }
  }, [tmdbSeasons, jellyfinData])

  useEffect(() => {
    onSeasonsStateChange?.({ downloadedSeasons, missingSeasons, hasMissingSeasons })
  }, [downloadedSeasons, missingSeasons, hasMissingSeasons, onSeasonsStateChange])

  // TMDB Season Detail SWR
  const { data: tmdbSeasonData, isLoading: isTmdbLoading } = useSWR<TmdbSeasonResponse>(
    tmdbId && currentSeason != null ? `/api/tmdb/tv/${tmdbId}/season/${currentSeason}` : null,
    fetcher
  )

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
      list = jellyfinData.episodes.filter((e) => e.seasonNumber === currentSeason)
    }

    return list.sort((a, b) =>
      isSortAscending ? a.episodeNumber - b.episodeNumber : b.episodeNumber - a.episodeNumber
    )
  }, [tmdbSeasonData, jellyfinData, currentSeason, isSortAscending])

  // Show up to 18 when collapsed so the 17th & 18th create depth behind the bottom fade
  const displayedEpisodes = useMemo(() => {
    return showAllEpisodes ? seasonEpisodes : seasonEpisodes.slice(0, 18)
  }, [seasonEpisodes, showAllEpisodes])

  const isCurrentSeasonMissing = missingSeasons.includes(currentSeason)

  // User authorization
  const { data: meData } = useSWR("/api/auth/me", fetcher)
  const isAdmin = Boolean(meData?.user?.isAdmin)

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  const handlePlayEpisode = (ep: EpisodeInfo) => {
    if (ep.jellyfinItemId) {
      router.push(`/watch?id=${ep.jellyfinItemId}`)
    }
  }

  const handleTogglePlayed = async (ep: EpisodeInfo) => {
    if (!ep.jellyfinItemId) return
    setActionLoadingId(ep.id)
    try {
      const nextPlayed = !ep.played
      const res = await fetch(`/api/jellyfin/items/${ep.jellyfinItemId}/played`, {
        method: nextPlayed ? "POST" : "DELETE",
      })
      if (res.ok) {
        toast(`Episode marked as ${nextPlayed ? "watched" : "unwatched"}`, "success")
        mutateEpisodes()
      } else {
        toast("Failed to update episode played status", "error")
      }
    } catch {
      toast("Error updating played status", "error")
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleRequestEpisode = async (ep: EpisodeInfo) => {
    if (!tmdbId) return
    setActionLoadingId(ep.id)
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaType: "tv",
          tmdbId,
          title: showName,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          tvdbId,
        }),
      })
      if (res.ok) {
        toast(`Episode ${ep.episodeNumber} requested successfully`, "success")
        mutate(`/api/availability?tmdbId=${tmdbId}&type=tv`)
      } else {
        toast("Failed to request episode", "error")
      }
    } catch {
      toast("Error requesting episode", "error")
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDeleteEpisode = async (ep: EpisodeInfo) => {
    if (!ep.jellyfinItemId || !isAdmin) return
    if (!window.confirm(`Are you sure you want to delete "${ep.title}" from disk?`)) return
    setActionLoadingId(ep.id)
    try {
      const res = await fetch(`/api/jellyfin/items/${ep.jellyfinItemId}`, {
        method: "DELETE",
      })
      if (res.ok) {
        toast("Episode deleted successfully", "success")
        mutateEpisodes()
        mutate(`/api/availability?tmdbId=${tmdbId}&type=tv`)
      } else {
        toast("Failed to delete episode", "error")
      }
    } catch {
      toast("Error deleting episode", "error")
    } finally {
      setActionLoadingId(null)
    }
  }

  const isShowInSonarr =
    availabilityStatus === "in_library" ||
    availabilityStatus === "in_sonarr" ||
    availabilityStatus === "downloading"

  return (
    <section className="mt-8 space-y-6">
      {/* ── Penpot Top Header Control Bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-penpot-border/60">
        {/* Left Side: "Seasons" Label + Numbered Season Toggle Buttons (Penpot Frame 13) */}
        <div className="flex items-center gap-4">
          <h3 className="text-lg sm:text-xl font-bold uppercase tracking-tight text-white">
            Seasons
          </h3>

          {/* Numbered Toggle Buttons Row */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
            {seasons.map((s) => {
              const isSelected = s.seasonNumber === currentSeason
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSeason(s.seasonNumber)}
                  aria-label={`Season ${s.seasonNumber}`}
                  aria-pressed={isSelected}
                  className={cn(
                    "size-10 sm:size-11 rounded-[4px] font-black text-sm sm:text-base flex items-center justify-center transition-all duration-200 cursor-pointer shadow-md shrink-0",
                    isSelected
                      ? "bg-penpot-primary-400 text-white shadow-lg ring-1 ring-white/20"
                      : "bg-white/[0.08] hover:bg-white/[0.15] text-penpot-text-medium hover:text-white border border-white/10"
                  )}
                >
                  {s.seasonNumber}
                </button>
              )
            })}
          </div>
        </div>

        {/* Right Side: Sort Order & Request Season Options */}
        <div className="flex items-center gap-3 text-xs font-bold tracking-wider text-penpot-text-medium uppercase">
          {onRequestSeason && isCurrentSeasonMissing && (
            <button
              onClick={() => onRequestSeason(currentSeason)}
              className="flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 bg-penpot-primary-500/20 hover:bg-penpot-primary-500/30 border border-penpot-primary-300/40 text-penpot-primary-100 rounded-[4px] transition-colors cursor-pointer"
            >
              <Plus className="size-3.5" />
              <span>Request Season {currentSeason}</span>
            </button>
          )}

          <Tooltip content={isSortAscending ? "Sort by latest episode first" : "Sort by first episode first"}>
            <button
              onClick={() => setIsSortAscending((prev) => !prev)}
              className="flex min-h-[38px] items-center gap-1.5 px-3 py-1.5 hover:text-white bg-black/20 hover:bg-white/10 border border-white/20 rounded-[4px] transition-colors cursor-pointer"
            >
              <ArrowUpDown className="size-3.5 text-penpot-text-subtle" />
              <span>{isSortAscending ? "Oldest First" : "Newest First"}</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Missing Season Notice Banner */}
      {isCurrentSeasonMissing && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-penpot-primary-500/10 border border-penpot-primary-300/30 rounded-[4px] animate-in fade-in duration-200">
          <div className="flex items-center gap-3">
            <Layers className="size-5 text-penpot-primary-200 shrink-0" />
            <div>
              <p className="text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
                Season {currentSeason} is missing episodes in your library
              </p>
              <p className="text-xs text-penpot-text-medium">
                Request missing episodes or the entire season to monitor and download automatically.
              </p>
            </div>
          </div>
          {onRequestSeason && (
            <button
              onClick={() => onRequestSeason(currentSeason)}
              className="px-3.5 py-1.5 bg-penpot-primary-400 hover:bg-penpot-primary-300 text-white font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0 rounded-[4px] transition-colors shadow-md min-h-[38px] cursor-pointer"
            >
              <Plus className="size-4" />
              Request Season {currentSeason}
            </button>
          )}
        </div>
      )}

      {/* ── Loading Skeleton ── */}
      {isTmdbLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-32 rounded-lg bg-white/[0.05] border border-white/5 animate-pulse flex items-center p-3 gap-4"
            >
              <div className="w-48 h-full bg-white/10 rounded" />
              <div className="flex-1 space-y-2.5">
                <div className="h-4 w-3/4 bg-white/10 rounded" />
                <div className="h-3 w-full bg-white/5 rounded" />
                <div className="h-3 w-1/2 bg-white/5 rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Penpot 2-Column Episode Grid (Episodes //Episodes) ── */}
      {!isTmdbLoading && (
        <div className="relative space-y-6">
          {/* Episode Grid with Bottom Depth Fade for rows past 16 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {displayedEpisodes.map((ep, index) => {
              const isFading = !showAllEpisodes && index >= 16
              return (
                <div
                  key={ep.id}
                  className={cn(
                    "transition-opacity duration-300",
                    isFading && "opacity-40 select-none pointer-events-none"
                  )}
                >
                  <EpisodeCard
                    episode={ep}
                    showName={showName}
                    isSelected={selectedEpisodeId === ep.id}
                    onSelect={(e) => setSelectedEpisodeId(e.id)}
                    onPlay={handlePlayEpisode}
                    onTogglePlayed={handleTogglePlayed}
                    onRequestEpisode={handleRequestEpisode}
                    onDeleteEpisode={handleDeleteEpisode}
                    isAdmin={isAdmin}
                    isShowInSonarr={isShowInSonarr}
                    actionLoading={actionLoadingId === ep.id}
                  />
                </div>
              )
            })}
          </div>

          {/* Depth Gradient Overlay & "Show More" Button (When Collapsed) */}
          {!showAllEpisodes && seasonEpisodes.length > 16 && (
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-penpot-bg via-penpot-bg/85 to-transparent flex items-end justify-center pb-2 pointer-events-none">
              <button
                type="button"
                onClick={() => setExpandedSeason(currentSeason)}
                className="pointer-events-auto flex items-center gap-2 px-7 py-3 rounded-[4px] bg-black/60 hover:bg-black/80 active:bg-black text-white font-bold text-xs sm:text-sm uppercase tracking-wider border border-white/30 hover:border-white/60 backdrop-blur-md transition-all duration-200 cursor-pointer shadow-2xl min-h-[44px]"
              >
                <span>Show More ({seasonEpisodes.length - 16} more episodes)</span>
                <ChevronDown className="size-4 text-penpot-text-medium" />
              </button>
            </div>
          )}

          {/* "Show Less" Button (When Expanded) */}
          {showAllEpisodes && seasonEpisodes.length > 16 && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => setExpandedSeason(null)}
                className="flex items-center gap-2 px-6 py-3 rounded-[4px] bg-white/[0.08] hover:bg-white/[0.14] active:bg-white/20 text-white font-bold text-xs sm:text-sm uppercase tracking-wider border border-white/10 hover:border-penpot-primary-400/50 transition-all duration-200 cursor-pointer shadow-md min-h-[44px]"
              >
                <span>Show Less</span>
                <ChevronDown className="size-4 text-penpot-text-medium rotate-180" />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
