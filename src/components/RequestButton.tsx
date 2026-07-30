"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RequestModal } from "@/components/RequestModal"
import { useToast } from "@/components/Toast"
import { Plus, Play, Loader2, Layers } from "lucide-react"
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
  availability: AvailabilityResult | null
  onStatusChange?: () => void
  hasMissingSeasons?: boolean
  missingSeasons?: number[]
  downloadedSeasons?: number[]
  initialSeason?: number
  posterPath?: string | null
  backdropPath?: string | null
}) {
  const [showModal, setShowModal] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

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
        <Button size="lg" onClick={handlePlay}>
          <Play className="mr-1 size-4" />
          Watch Now
        </Button>

        {type === "tv" && hasMissingSeasons && (
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setShowModal(true)}
            className="bg-surface hover:bg-card border border-border text-foreground font-semibold"
          >
            <Layers className="mr-1.5 size-4 text-accent" />
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
        <Button size="lg" variant="secondary" disabled>
          <Loader2 className="mr-1 size-4 animate-spin" />
          Downloading {availability.progress ? `${Math.round(availability.progress)}%` : ""}
        </Button>

        {type === "tv" && (
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setShowModal(true)}
            className="bg-surface hover:bg-card border border-border text-foreground font-semibold"
          >
            <Plus className="mr-1.5 size-4 text-accent" />
            Request More
          </Button>
        )}

        {renderModal()}
      </div>
    )
  }

  // Case 3: In Radarr / In Sonarr
  if (availability?.status === "in_radarr" || availability?.status === "in_sonarr") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" variant="secondary" disabled>
          <Loader2 className="mr-1 size-4 animate-spin" />
          Requested
        </Button>

        {type === "tv" && (
          <Button
            size="lg"
            variant="secondary"
            onClick={() => setShowModal(true)}
            className="bg-surface hover:bg-card border border-border text-foreground font-semibold"
          >
            <Plus className="mr-1.5 size-4 text-accent" />
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
      <Button size="lg" variant="accent" onClick={() => setShowModal(true)}>
        <Plus className="mr-1 size-4" />
        Request
      </Button>

      {renderModal()}
    </>
  )
}

