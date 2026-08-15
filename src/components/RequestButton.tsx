"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RequestModal } from "@/components/RequestModal"
import { useToast } from "@/components/Toast"
import { Plus, Play, Loader2, Layers, Users, Clock } from "lucide-react"
import { StartPartyModal } from "@/components/party/StartPartyModal"
import type { AvailabilityResult } from "@/app/api/availability/route"

export function RequestButton({
  type,
  tmdbId,
  title,
  year,
  tvdbId,
  seasonsCount,
  availability,
  onStatusChange,
  hasMissingSeasons,
  missingSeasons = [],
  downloadedSeasons = [],
  initialSeason,
  posterPath,
  backdropPath,
}: {
  type: "movie" | "tv"
  tmdbId: number
  title: string
  year?: number
  tvdbId?: number
  seasonsCount?: number
  availability?: AvailabilityResult | null
  onStatusChange?: () => void
  hasMissingSeasons?: boolean
  missingSeasons?: number[]
  downloadedSeasons?: number[]
  initialSeason?: number
  posterPath?: string | null
  backdropPath?: string | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const [showModal, setShowModal] = useState(false)
  const [showPartyModal, setShowPartyModal] = useState(false)

  const handleSuccess = () => {
    setShowModal(false)
    toast(`${title} request updated successfully!`, "success")
    onStatusChange?.()
  }

  const handlePlay = () => {
    if (!availability?.jellyfinItemId) return
    // For series this is the Jellyfin *series* id — the watch page resolves
    // it to the next episode to watch; movies play directly.
    router.push(`/watch?id=${availability.jellyfinItemId}&type=${type}`)
  }

  const renderModal = () => {
    if (!showModal) return null
    return (
      <RequestModal
        tmdbId={tmdbId}
        title={title}
        type={type}
        year={year}
        tvdbId={tvdbId}
        posterPath={posterPath}
        backdropPath={backdropPath}
        seasonsCount={seasonsCount}
        initialSeasonMode={
          initialSeason || (missingSeasons && missingSeasons.length > 0)
            ? "custom"
            : "first"
        }
        initialSelectedSeasons={
          initialSeason ? [initialSeason] : missingSeasons.length > 0 ? missingSeasons : undefined
        }
        downloadedSeasons={downloadedSeasons}
        onClose={() => setShowModal(false)}
        onSuccess={handleSuccess}
      />
    )
  }

  // Case 1: TV Series or Movie is in library
  if (availability?.status === "in_library" && availability.jellyfinItemId) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant="play" onClick={handlePlay}>
          <Play className="mr-1 size-4 fill-black text-black" />
          Play
        </Button>

        <Button
          size="lg"
          variant="moreInfo"
          onClick={() => setShowPartyModal(true)}
        >
          <Users className="mr-1.5 size-4 text-white" />
          Watch Party
        </Button>

        <StartPartyModal
          isOpen={showPartyModal}
          onClose={() => setShowPartyModal(false)}
          itemId={type === "movie" ? availability.jellyfinItemId : null}
          seriesId={type === "tv" ? availability.jellyfinItemId : null}
        />

        {type === "tv" && hasMissingSeasons && (
          <Button
            size="lg"
            variant="moreInfo"
            onClick={() => setShowModal(true)}
          >
            <Layers className="mr-1.5 size-4 text-white" />
            Request More Seasons
          </Button>
        )}

        {renderModal()}
      </div>
    )
  }

  // Case 2: Downloading
  if (availability?.status === "downloading") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant="muted" disabled>
          <Loader2 className="mr-1 size-4 animate-spin text-grey-100" />
          Downloading {availability.progress ? `${Math.round(availability.progress)}%` : ""}
        </Button>

        {type === "tv" && (
          <Button
            size="lg"
            variant="moreInfo"
            onClick={() => setShowModal(true)}
          >
            <Plus className="mr-1.5 size-4 text-white" />
            Request More
          </Button>
        )}

        {renderModal()}
      </div>
    )
  }

  // Case 2.5: Pending Approval
  if (availability?.status === "pending") {
    const requester = availability.requestedByUsername || "another user"
    return (
      <>
        <Button size="lg" variant="outlined" disabled className="opacity-80 border-amber-500/40 text-amber-300">
          <Clock className="mr-1.5 size-4 text-amber-400 animate-pulse" />
          Pending Approval
        </Button>

        {renderModal()}

        <div className="w-full text-xs font-semibold text-amber-300/90 bg-amber-950/40 border border-amber-800/50 p-2.5 rounded-[4px] flex items-center gap-2 mt-1">
          <Clock className="size-4 text-amber-400 shrink-0" />
          <span>
            This item has already been requested by <strong className="font-bold text-amber-200">{requester}</strong>, please wait for an admin to approve the request
          </span>
        </div>
      </>
    )
  }

  // Case 3: In Radarr / In Sonarr
  if (availability?.status === "in_radarr" || availability?.status === "in_sonarr") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant="muted" disabled>
          <Loader2 className="mr-1 size-4 animate-spin text-grey-100" />
          Requested
        </Button>

        {type === "tv" && (
          <Button
            size="lg"
            variant="moreInfo"
            onClick={() => setShowModal(true)}
          >
            <Plus className="mr-1.5 size-4 text-white" />
            Request More
          </Button>
        )}

        {renderModal()}
      </div>
    )
  }

  // Case 4: Default - Not Requested yet
  return (
    <>
      <Button size="lg" variant="primary" onClick={() => setShowModal(true)}>
        <Plus className="mr-1 size-4 text-white" />
        Request
      </Button>

      {renderModal()}
    </>
  )
}

