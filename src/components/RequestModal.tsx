"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { X, Loader2, HardDrive, Tag as TagIcon, Check, Layers, Film, Tv, Clock } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type ProfilesData = {
  qualityProfiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string; accessible: boolean; freeSpace?: number }[]
  tags: { id: number; label: string }[]
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return ""
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1024) {
    return `${(gb / 1024).toFixed(1)} TB free`
  }
  return `${gb.toFixed(1)} GB free`
}

export function RequestModal({
  tmdbId,
  title,
  type,
  year,
  onClose,
  onSuccess,
  tvdbId,
  seasonsCount = 10,
  initialSeasonMode,
  initialSelectedSeasons,
  downloadedSeasons,
  posterPath,
  backdropPath,
}: {
  tmdbId: number
  title: string
  type: "movie" | "tv"
  year?: number
  onClose: () => void
  onSuccess: () => void
  tvdbId?: number
  seasonsCount?: number
  initialSeasonMode?: "first" | "all" | "future" | "custom"
  initialSelectedSeasons?: number[]
  downloadedSeasons?: number[]
  posterPath?: string | null
  backdropPath?: string | null
}) {
  const endpoint = type === "movie" ? "/api/radarr/profiles" : "/api/sonarr/profiles"
  const { data, error, isLoading } = useSWR<ProfilesData>(endpoint, fetcher)

  const { data: availabilityData } = useSWR<{ results: Record<string, { status: string; requestedByUsername?: string }> }>(
    tmdbId ? `/api/availability?tmdbId=${tmdbId}&type=${type}` : null,
    fetcher
  )

  const currentAvail = availabilityData?.results?.[`${type}-${tmdbId}`]
  const isPending = currentAvail?.status === "pending"
  const existingRequester = currentAvail?.requestedByUsername

  // Filter out "Any" profile from selection
  const filteredQualityProfiles = data?.qualityProfiles?.filter((p) => p.name.trim().toLowerCase() !== "any") || []

  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null)
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null)
  const [minimumAvailability, setMinimumAvailability] = useState<string>("released")
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])

  // Default season monitoring selection set to initialSeasonMode or "first"
  const [seasonMode, setSeasonMode] = useState<"first" | "all" | "future" | "custom">(
    initialSeasonMode || (initialSelectedSeasons?.length ? "custom" : "first")
  )
  const [customSeasons, setCustomSeasons] = useState<Record<number, boolean>>({})

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (filteredQualityProfiles.length && qualityProfileId === null) {
      const preferred1080p = filteredQualityProfiles.find((p) => /1080/i.test(p.name))
      setQualityProfileId(preferred1080p ? preferred1080p.id : filteredQualityProfiles[0].id)
    }
    if (data?.rootFolders?.length && rootFolderPath === null) {
      setRootFolderPath(data.rootFolders[0].path)
    }
  }, [data, filteredQualityProfiles, qualityProfileId, rootFolderPath])

  // Initialize custom seasons state if needed
  useEffect(() => {
    const initial: Record<number, boolean> = {}
    const maxCount = Math.max(seasonsCount || 1, 1)
    for (let i = 1; i <= maxCount; i++) {
      if (initialSelectedSeasons && initialSelectedSeasons.length > 0) {
        initial[i] = initialSelectedSeasons.includes(i)
      } else {
        initial[i] = i === 1
      }
    }
    setCustomSeasons(initial)
  }, [seasonsCount, initialSelectedSeasons])

  const toggleTag = (tagId: number) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const toggleSeason = (seasonNum: number) => {
    setCustomSeasons((prev) => ({
      ...prev,
      [seasonNum]: !prev[seasonNum],
    }))
  }

  const handleSubmit = async () => {
    if (qualityProfileId === null || rootFolderPath === null) return
    setSubmitting(true)
    setSubmitError(null)

    // Build season payload for TV series
    let seasonsPayload: { seasonNumber: number; monitored: boolean }[] | undefined = undefined
    if (type === "tv") {
      const maxSeasons = Math.max(seasonsCount || 1, 1)
      if (seasonMode === "first") {
        seasonsPayload = Array.from({ length: maxSeasons }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: i === 0,
        }))
      } else if (seasonMode === "all") {
        seasonsPayload = Array.from({ length: maxSeasons }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: true,
        }))
      } else if (seasonMode === "future") {
        seasonsPayload = Array.from({ length: maxSeasons }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: false,
        }))
      } else {
        seasonsPayload = Array.from({ length: maxSeasons }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: Boolean(customSeasons[i + 1]),
        }))
      }
    }

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tmdbId,
          tvdbId: tvdbId ?? tmdbId,
          title,
          mediaType: type,
          year: year ?? new Date().getFullYear(),
          posterPath,
          backdropPath,
          qualityProfileId,
          rootFolderPath,
          minimumAvailability: type === "movie" ? minimumAvailability : undefined,
          tags: selectedTagIds.length > 0 ? selectedTagIds : undefined,
          seasons: seasonsPayload,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? "Failed to submit request")
      }

      onSuccess()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-[4px] bg-[#141414] border border-[#333333] p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#262626] pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-[#E50914] mb-1">
              {type === "movie" ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
              <span>{type === "movie" ? "Movie Request" : "Series Request"}</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight line-clamp-1">
              {title} {year ? `(${year})` : ""}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#808080] hover:text-white p-1 transition-colors rounded-[4px]"
          >
            <X className="size-5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12 space-y-3">
            <Loader2 className="size-8 animate-spin text-[#E50914]" />
            <p className="text-xs text-[#B3B3B3] font-medium">
              Fetching profiles & tags...
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-[#E50914]/10 border border-[#E50914]/40 text-xs text-[#EB3942] rounded-[4px]">
            Failed to connect to media management profiles. Please verify Radarr/Sonarr settings.
          </div>
        )}

        {data && (
          <div className="space-y-5">
            {/* Quality Profile & Root Folder Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[#B3B3B3]">
                  Quality Profile
                </label>
                <select
                  value={qualityProfileId ?? ""}
                  onChange={(e) => setQualityProfileId(Number(e.target.value))}
                  className="w-full rounded-[4px] border border-[#414141] bg-[#333333] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                >
                  {filteredQualityProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[#B3B3B3] flex items-center gap-1.5">
                  <HardDrive className="size-3.5 text-[#E50914]" /> Root Folder
                </label>
                <select
                  value={rootFolderPath ?? ""}
                  onChange={(e) => setRootFolderPath(e.target.value)}
                  className="w-full rounded-[4px] border border-[#414141] bg-[#333333] px-3 py-2 text-sm text-white focus:border-[#E50914] focus:outline-none"
                >
                  {data.rootFolders.map((f) => {
                    const freeStr = formatBytes(f.freeSpace)
                    return (
                      <option key={f.id} value={f.path}>
                        {f.path} {freeStr ? `(${freeStr})` : ""}
                      </option>
                    )
                  })}
                </select>
              </div>
            </div>

            {/* Direct Options (No Advanced Toggle) */}
            <div className="space-y-4 pt-2 border-t border-border/60">
              {/* Movie Availability */}
              {type === "movie" && (
                <div>
                  <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-gray-300">
                    Minimum Availability
                  </label>
                  <select
                    value={minimumAvailability}
                    onChange={(e) => setMinimumAvailability(e.target.value)}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
                  >
                    <option value="announced">Announced (Early Monitoring)</option>
                    <option value="inCinemas">In Cinemas</option>
                    <option value="released">Released / Digital (Recommended)</option>
                  </select>
                </div>
              )}

              {/* Season Selection (TV) */}
              {type === "tv" && (
                <div className="space-y-2">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                    <Layers className="size-3.5 text-accent" /> Season Selection
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    {(["first", "all", "future", "custom"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setSeasonMode(mode)}
                        className={`px-2.5 py-1.5 uppercase font-bold border transition-colors ${
                          seasonMode === mode
                            ? "bg-accent border-accent text-white"
                            : "bg-surface border-border text-gray-400 hover:text-white"
                        }`}
                      >
                        {mode === "first"
                          ? "First Season"
                          : mode === "all"
                          ? "All Seasons"
                          : mode === "future"
                          ? "Future Only"
                          : "Custom"}
                      </button>
                    ))}
                  </div>

                  {/* Custom Season Checkboxes */}
                  {seasonMode === "custom" && (
                    <div className="p-3 bg-surface/60 border border-border mt-2 space-y-2 max-h-36 overflow-y-auto">
                      <span className="text-[11px] font-semibold text-gray-400 block mb-1">
                        Select specific seasons to monitor:
                      </span>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                        {Array.from({ length: Math.max(seasonsCount || 1, 1) }, (_, i) => i + 1).map(
                          (sNum) => {
                            const isDownloaded = downloadedSeasons?.includes(sNum)
                            return (
                              <label
                                key={sNum}
                                className="flex flex-col gap-0.5 text-xs text-gray-300 cursor-pointer hover:text-white border border-border/40 p-1.5 bg-surface/40 hover:bg-surface/80"
                              >
                                <div className="flex items-center gap-1.5">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(customSeasons[sNum])}
                                    onChange={() => toggleSeason(sNum)}
                                    className="accent-accent size-3.5"
                                  />
                                  <span className="font-semibold">Season {sNum}</span>
                                </div>
                                {downloadedSeasons && (
                                  <span
                                    className={`text-[10px] font-bold ml-5 ${
                                      isDownloaded ? "text-emerald-400" : "text-amber-400"
                                    }`}
                                  >
                                    {isDownloaded ? "In Library" : "Missing"}
                                  </span>
                                )}
                              </label>
                            )
                          }
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tags Selector */}
              {data.tags && data.tags.length > 0 && (
                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
                    <TagIcon className="size-3.5 text-accent" /> Tags
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {data.tags.map((tag) => {
                      const active = selectedTagIds.includes(tag.id)
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 text-xs border font-medium transition-colors ${
                            active
                              ? "bg-accent/20 border-accent text-white"
                              : "bg-surface border-border text-gray-400 hover:border-gray-500"
                          }`}
                        >
                          {active && <Check className="size-3 text-accent" />}
                          {tag.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {isPending && (
              <div className="p-3.5 bg-amber-950/50 border border-amber-700/60 text-amber-200 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold uppercase text-amber-400">
                  <Clock className="size-4 animate-pulse" /> Request Already Pending
                </div>
                <p>
                  This item has already been requested by{" "}
                  <span className="font-bold text-amber-100">{existingRequester || "another user"}</span>, please wait for an admin to approve the request
                </p>
              </div>
            )}

            {submitError && (
              <p className="text-xs font-semibold text-red-400 bg-red-950/30 p-2.5 border border-red-900/40">
                {submitError}
              </p>
            )}

            <div className="p-3 bg-surface/50 border border-border text-xs text-gray-400 leading-relaxed">
              <span className="text-amber-400 font-bold">Note:</span> Non-admin requests will enter approval queue. Admin users auto-approve immediately.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button variant="accent" onClick={handleSubmit} disabled={submitting || isPending}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="size-4 animate-spin" /> Submitting...
                  </span>
                ) : (
                  "Submit Request"
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
