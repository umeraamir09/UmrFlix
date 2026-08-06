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

  // Default fallbacks for profiles & root folders
  const defaultProfileId = filteredQualityProfiles.length
    ? (filteredQualityProfiles.find((p) => /1080/i.test(p.name)) || filteredQualityProfiles[0]).id
    : null
  const activeQualityProfileId = qualityProfileId ?? defaultProfileId

  const defaultRootPath = data?.rootFolders?.length ? data.rootFolders[0].path : null
  const activeRootFolderPath = rootFolderPath ?? defaultRootPath

  // Default season monitoring selection set to initialSeasonMode or "first"
  const [seasonMode, setSeasonMode] = useState<"first" | "all" | "future" | "custom">(
    initialSeasonMode || (initialSelectedSeasons?.length ? "custom" : "first")
  )
  const [customSeasons, setCustomSeasons] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {}
    const maxCount = Math.max(seasonsCount || 1, 1)
    for (let i = 1; i <= maxCount; i++) {
      if (initialSelectedSeasons && initialSelectedSeasons.length > 0) {
        initial[i] = initialSelectedSeasons.includes(i)
      } else {
        initial[i] = i === 1
      }
    }
    return initial
  })

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

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
    if (activeQualityProfileId === null || activeRootFolderPath === null) return
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
          qualityProfileId: activeQualityProfileId,
          rootFolderPath: activeRootFolderPath,
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-2 sm:p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-[4px] bg-grey-900 border border-grey-600 shadow-2xl flex flex-col max-h-[90dvh] overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-grey-750 p-4 sm:p-6 pb-4 shrink-0 bg-grey-900 z-10">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-accent mb-1">
              {type === "movie" ? <Film className="size-3.5" /> : <Tv className="size-3.5" />}
              <span>{type === "movie" ? "Movie Request" : "Series Request"}</span>
            </div>
            <h2 id="request-modal-title" className="text-xl font-bold text-white tracking-tight line-clamp-1">
              {title} {year ? `(${year})` : ""}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-grey-200 hover:text-white p-1 transition-colors rounded-[4px]"
            aria-label="Close request modal"
          >
            <X className="size-5" />
          </button>
        </div>

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12 space-y-3 p-6">
            <Loader2 className="size-8 animate-spin text-accent" />
            <p className="text-xs text-grey-100 font-medium">
              Fetching profiles & tags...
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-accent/10 border border-accent/40 text-xs text-secondary-red-100 rounded-[4px] m-4">
            Failed to connect to media management profiles. Please verify Radarr/Sonarr settings.
          </div>
        )}

        {data && (
          <>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
              {/* Quality Profile & Root Folder Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-grey-100">
                    Quality Profile
                  </label>
                  <select
                    value={activeQualityProfileId ?? ""}
                    onChange={(e) => setQualityProfileId(Number(e.target.value))}
                    className="w-full rounded-[4px] border border-grey-400 bg-grey-600 px-3 py-2 text-[16px] sm:text-sm text-white focus:border-accent focus:outline-none"
                  >
                    {filteredQualityProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-grey-100 flex items-center gap-1.5">
                    <HardDrive className="size-3.5 text-accent" /> Root Folder
                  </label>
                  <select
                    value={activeRootFolderPath ?? ""}
                    onChange={(e) => setRootFolderPath(e.target.value)}
                    className="w-full rounded-[4px] border border-grey-400 bg-grey-600 px-3 py-2 text-[16px] sm:text-sm text-white focus:border-accent focus:outline-none"
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

              {/* Movie Availability */}
              {type === "movie" && (
                <div>
                  <label className="mb-1.5 block text-xs font-extrabold uppercase tracking-wider text-gray-300">
                    Minimum Availability
                  </label>
                  <select
                    value={minimumAvailability}
                    onChange={(e) => setMinimumAvailability(e.target.value)}
                    className="w-full rounded-none border border-border bg-background px-3 py-2 text-[16px] sm:text-sm text-foreground focus:border-accent focus:outline-none"
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

                  {seasonMode === "custom" && (
                    <div className="mt-3 space-y-2 border border-border bg-surface/50 p-3 max-h-48 overflow-y-auto">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {Array.from({ length: Math.max(seasonsCount || 1, 1) }, (_, i) => i + 1).map(
                          (seasonNum) => {
                            const isDownloaded = downloadedSeasons?.includes(seasonNum)
                            const isSelected = Boolean(customSeasons[seasonNum])
                            return (
                              <label
                                key={seasonNum}
                                className={`flex items-center gap-2 px-2.5 py-1.5 border text-xs cursor-pointer transition-colors ${
                                  isSelected
                                    ? "bg-accent/20 border-accent text-white font-bold"
                                    : "bg-surface border-border text-gray-400 hover:text-white"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleSeason(seasonNum)}
                                  className="accent-accent size-3.5"
                                />
                                <span>Season {seasonNum}</span>
                                {isDownloaded && (
                                  <span className="text-[10px] text-emerald-400 ml-auto font-semibold">
                                    Downloaded
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
                              ? "bg-accent border-accent text-white font-bold"
                              : "bg-surface border-border text-gray-400 hover:text-white"
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
            </div>

            {/* Sticky Action Footer */}
            <div className="sticky bottom-0 bg-grey-900 border-t border-grey-750 p-4 shrink-0 z-10 flex items-center justify-end gap-3">
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
          </>
        )}
      </div>
    </div>
  )
}
