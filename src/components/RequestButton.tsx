"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { RequestModal } from "@/components/RequestModal"
import { useToast } from "@/components/Toast"
import { Plus, Play, Loader2 } from "lucide-react"
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
}: {
  type: "movie" | "tv"
  tmdbId: number
  title: string
  year?: number
  tvdbId?: number
  seasonsCount?: number
  availability: AvailabilityResult | null
  onStatusChange?: () => void
}) {
  const [showModal, setShowModal] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const handleSuccess = () => {
    setShowModal(false)
    toast(`${title} has been added to your library!`, "success")
    onStatusChange?.()
  }

  const handlePlay = () => {
    if (!availability?.jellyfinItemId) return
    // For series this is the Jellyfin *series* id — the watch page resolves
    // it to the next episode to watch; movies play directly.
    router.push(`/watch?id=${availability.jellyfinItemId}&type=${type}`)
  }

  if (availability?.status === "in_library" && availability.jellyfinItemId) {
    return (
      <Button onClick={handlePlay}>
        <Play className="mr-1 size-4" />
        Watch Now
      </Button>
    )
  }

  if (availability?.status === "downloading") {
    return (
      <Button variant="secondary" disabled>
        <Loader2 className="mr-1 size-4 animate-spin" />
        Downloading {availability.progress ? `${Math.round(availability.progress)}%` : ""}
      </Button>
    )
  }

  if (availability?.status === "in_radarr" || availability?.status === "in_sonarr") {
    return (
      <Button variant="secondary" disabled>
        <Loader2 className="mr-1 size-4 animate-spin" />
        Requested
      </Button>
    )
  }

  return (
    <>
      <Button
        variant="accent"
        onClick={() => setShowModal(true)}
      >
        <Plus className="mr-1 size-4" />
        Request
      </Button>

      {showModal && (
        <RequestModal
          tmdbId={tmdbId}
          title={title}
          type={type}
          year={year}
          tvdbId={tvdbId}
          seasonsCount={seasonsCount}
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}
