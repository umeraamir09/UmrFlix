"use client"

import Image from "next/image"
import {
  Film,
  Tv,
  Clock,
  CheckCircle2,
  XCircle,
  HardDrive,
  Sliders,
  Calendar,
  Tag as TagIcon,
  Layers,
  User,
  AlertCircle,
  Loader2,
} from "lucide-react"

import type { RequestItem } from "@/lib/requests-store"

export type ProfileMapData = {
  qualityProfiles: { id: number; name: string }[]
  tags: { id: number; label: string }[]
}

interface AdminRequestCardProps {
  request: RequestItem
  radarrProfiles?: ProfileMapData | null
  sonarrProfiles?: ProfileMapData | null
  onApprove?: (id: string) => void
  onDeny?: (id: string) => void
  actionLoading?: boolean
}

export function AdminRequestCard({
  request: req,
  radarrProfiles,
  sonarrProfiles,
  onApprove,
  onDeny,
  actionLoading = false,
}: AdminRequestCardProps) {
  // Resolve Quality Profile Name
  const profileList = req.mediaType === "movie" ? radarrProfiles?.qualityProfiles : sonarrProfiles?.qualityProfiles
  const qualityProfileName = profileList?.find((p) => p.id === req.qualityProfileId)?.name || `Profile #${req.qualityProfileId}`

  // Resolve Tags
  const tagList = req.mediaType === "movie" ? radarrProfiles?.tags : sonarrProfiles?.tags
  const tagLabels = (req.tags || [])
    .map((tId) => tagList?.find((t) => t.id === tId)?.label || `Tag #${tId}`)
    .filter(Boolean)

  // Season monitoring breakdown
  const isTv = req.mediaType === "tv"
  const seasons = req.seasons || []
  const monitoredSeasons = seasons.filter((s) => s.monitored).map((s) => s.seasonNumber)

  let seasonBadgeType: "all" | "custom" | "none" | "legacy" = "legacy"
  if (seasons.length > 0) {
    if (monitoredSeasons.length === seasons.length) {
      seasonBadgeType = "all"
    } else if (monitoredSeasons.length === 0) {
      seasonBadgeType = "none"
    } else {
      seasonBadgeType = "custom"
    }
  }

  // Availability label mapping
  const formatAvailability = (availability?: string) => {
    if (!availability) return null
    switch (availability) {
      case "announced":
        return "Announced (Early)"
      case "inCinemas":
        return "In Cinemas"
      case "released":
        return "Released / Digital"
      default:
        return availability
    }
  }

  // Series type mapping
  const formatSeriesType = (st?: string) => {
    if (!st) return null
    return st.charAt(0).toUpperCase() + st.slice(1)
  }

  const posterUrl = req.posterPath
    ? req.posterPath.startsWith("/")
      ? `https://image.tmdb.org/t/p/w185${req.posterPath}`
      : req.posterPath
    : null

  return (
    <div className="p-5 border border-border/80 bg-card hover:border-gray-500/80 transition-all rounded-none space-y-4 shadow-lg">
      {/* Top Header: Poster, Title, Type & Status */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          {/* Poster or Icon Box */}
          {posterUrl ? (
            <div className="relative w-14 h-20 bg-surface border border-border shrink-0 overflow-hidden shadow">
              <Image
                src={posterUrl}
                alt={req.title}
                fill
                sizes="56px"
                className="object-cover"
                unoptimized
              />
            </div>
          ) : (
            <div className="w-14 h-20 bg-surface border border-border shrink-0 flex items-center justify-center text-amber-400">
              {req.mediaType === "movie" ? <Film className="size-6" /> : <Tv className="size-6" />}
            </div>
          )}

          {/* Title & Request Meta */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-extrabold text-white text-base tracking-tight">
                {req.title} {req.year ? `(${req.year})` : ""}
              </h3>
              <span
                className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-wider border rounded-none ${
                  req.mediaType === "movie"
                    ? "bg-indigo-500/20 text-indigo-300 border-indigo-500/40"
                    : "bg-purple-500/20 text-purple-300 border-purple-500/40"
                }`}
              >
                {req.mediaType === "movie" ? "Movie" : "TV Series"}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              <span className="flex items-center gap-1 text-gray-300">
                <User className="size-3.5 text-gray-400" />
                Requested by <strong className="text-white font-semibold">{req.requestedBy.username}</strong>
              </span>
              <span>&bull;</span>
              <span className="flex items-center gap-1 text-gray-400">
                <Clock className="size-3.5" />
                {new Date(req.requestedAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </div>
          </div>
        </div>

        {/* Status Badge */}
        <div className="shrink-0 self-start">
          {req.status === "pending" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-black uppercase tracking-wider">
              <Clock className="size-3.5 animate-pulse" /> Pending Approval
            </span>
          )}
          {req.status === "approved" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-black uppercase tracking-wider">
              <CheckCircle2 className="size-3.5 text-emerald-400" /> Approved
            </span>
          )}
          {req.status === "denied" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-500/20 text-red-300 border border-red-500/40 text-xs font-black uppercase tracking-wider">
              <XCircle className="size-3.5 text-red-400" /> Denied
            </span>
          )}
        </div>
      </div>

      {/* Technical Request Details Grid */}
      <div className="p-3.5 bg-surface/60 border border-border/80 text-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {/* Quality Profile */}
          <div className="space-y-1">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <Sliders className="size-3.5 text-blue-400" /> Quality Profile
            </span>
            <span className="inline-block px-2.5 py-1 text-xs font-extrabold bg-blue-500/15 text-blue-300 border border-blue-500/30">
              {qualityProfileName}
            </span>
          </div>

          {/* Root Folder Path */}
          <div className="space-y-1 sm:col-span-2 md:col-span-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
              <HardDrive className="size-3.5 text-emerald-400" /> Destination Folder
            </span>
            <code className="block px-2.5 py-1 text-xs font-mono bg-background border border-border/80 text-gray-200 truncate" title={req.rootFolderPath}>
              {req.rootFolderPath}
            </code>
          </div>

          {/* Min Availability (Movies) */}
          {req.mediaType === "movie" && req.minimumAvailability && (
            <div className="space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Calendar className="size-3.5 text-purple-400" /> Min. Availability
              </span>
              <span className="inline-block px-2.5 py-1 text-xs font-bold bg-purple-500/15 text-purple-300 border border-purple-500/30">
                {formatAvailability(req.minimumAvailability)}
              </span>
            </div>
          )}

          {/* Series Type (TV) */}
          {isTv && req.seriesType && (
            <div className="space-y-1">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <Tv className="size-3.5 text-pink-400" /> Series Type
              </span>
              <span className="inline-block px-2.5 py-1 text-xs font-bold bg-pink-500/15 text-pink-300 border border-pink-500/30">
                {formatSeriesType(req.seriesType)}
              </span>
            </div>
          )}

          {/* Tags */}
          {tagLabels.length > 0 && (
            <div className="space-y-1 sm:col-span-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                <TagIcon className="size-3.5 text-yellow-400" /> Tags
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tagLabels.map((tag, idx) => (
                  <span key={idx} className="px-2 py-0.5 text-[11px] font-bold bg-yellow-500/15 text-yellow-300 border border-yellow-500/30">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Specific Seasons Requested (For TV Series) */}
        {isTv && (
          <div className="pt-2 border-t border-border/50 space-y-1.5">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Layers className="size-3.5 text-amber-400" /> Seasons Requested
            </span>

            {seasonBadgeType === "all" && (
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/40">
                  All Seasons (1 – {seasons.length})
                </span>
                <span className="text-[11px] text-gray-400">All available seasons requested</span>
              </div>
            )}

            {seasonBadgeType === "custom" && (
              <div className="space-y-1">
                <div className="text-[11px] font-bold text-gray-300">
                  {monitoredSeasons.length} of {seasons.length} seasons requested:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {monitoredSeasons.map((sNum) => (
                    <span
                      key={sNum}
                      className="px-2.5 py-1 text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/40"
                    >
                      Season {sNum}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {seasonBadgeType === "none" && (
              <span className="px-2.5 py-1 text-xs font-bold bg-surface text-gray-400 border border-border">
                Future Seasons Only (No current seasons monitored)
              </span>
            )}

            {seasonBadgeType === "legacy" && (
              <span className="px-2.5 py-1 text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                All Seasons (Default)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Decision Details Note (if Approved or Denied) */}
      {req.status === "approved" && (
        <div className="p-3 bg-emerald-950/20 border border-emerald-800/40 text-xs text-emerald-300 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold">
            <CheckCircle2 className="size-4 text-emerald-400" />
            Approved by <strong className="text-white font-bold">{req.approvedBy || "Admin"}</strong>
          </span>
          {req.approvedAt && (
            <span className="text-gray-400 text-[11px]">
              {new Date(req.approvedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
            </span>
          )}
        </div>
      )}

      {req.status === "denied" && (
        <div className="p-3 bg-red-950/30 border border-red-800/40 text-xs text-red-300 space-y-1">
          <div className="flex items-center justify-between font-bold uppercase tracking-wider text-red-400">
            <span className="flex items-center gap-1.5">
              <AlertCircle className="size-4 text-red-400" />
              Denied by {req.deniedBy || "Admin"}
            </span>
            {req.deniedAt && (
              <span className="text-gray-400 text-[11px] font-normal lowercase">
                {new Date(req.deniedAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
              </span>
            )}
          </div>
          {req.denialReason && <p className="pl-5 text-gray-200 text-xs">{req.denialReason}</p>}
        </div>
      )}

      {/* Action Controls for Pending Queue */}
      {req.status === "pending" && (onApprove || onDeny) && (
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#262626]">
          {onDeny && (
            <button
              onClick={() => onDeny(req.id)}
              disabled={actionLoading}
              className="px-5 py-2.5 bg-[#E50914] hover:bg-[#C11119] text-white font-semibold text-xs rounded-[4px] transition-all shadow cursor-pointer disabled:opacity-50"
            >
              Deny
            </button>
          )}

          {onApprove && (
            <button
              onClick={() => onApprove(req.id)}
              disabled={actionLoading}
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-[4px] transition-all shadow cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {actionLoading ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" /> Approve & Dispatch
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
