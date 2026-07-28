"use client"

import { useState } from "react"
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
  availability,
  onStatusChange,
}: {
  type: "movie" | "tv"
  tmdbId: number
  title: string
  year?: number
  tvdbId?: number
  availability: AvailabilityResult | null
  onStatusChange?: () => void
}) {
  const [showModal, setShowModal] = useState(false)
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [loadingPlay, setLoadingPlay] = useState(false)
  const { toast } = useToast()

  const handleSuccess = () => {
    setShowModal(false)
    toast(`${title} has been added to your library!`, "success")
    onStatusChange?.()
  }

  const handlePlay = async () => {
    if (playUrl) {
      window.open(playUrl, "_blank")
      return
    }

    if (!availability?.jellyfinItemId) return

    setLoadingPlay(true)
    try {
      const res = await fetch(`/api/jellyfin/stream/${availability.jellyfinItemId}`)
      const data = await res.json()
      if (data.direct) {
        setPlayUrl(data.direct)
        window.open(data.direct, "_blank")
      } else {
        toast("Failed to get stream URL", "error")
      }
    } catch {
      toast("Failed to start playback", "error")
    } finally {
      setLoadingPlay(false)
    }
  }

  if (availability?.status === "in_library") {
    return (
      <Button onClick={handlePlay} disabled={loadingPlay}>
        {loadingPlay ? (
          <Loader2 className="mr-1 size-4 animate-spin" />
        ) : (
          <Play className="mr-1 size-4" />
        )}
        Play on Jellyfin
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
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}
