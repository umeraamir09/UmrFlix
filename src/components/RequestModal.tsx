"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { X, Loader2 } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type ProfilesData = {
  qualityProfiles: { id: number; name: string }[]
  rootFolders: { id: number; path: string; accessible: boolean }[]
}

export function RequestModal({
  tmdbId,
  title,
  type,
  year,
  onClose,
  onSuccess,
  tvdbId,
}: {
  tmdbId: number
  title: string
  type: "movie" | "tv"
  year?: number
  onClose: () => void
  onSuccess: () => void
  tvdbId?: number
}) {
  const endpoint = type === "movie" ? "/api/radarr/profiles" : "/api/sonarr/profiles"
  const { data, error, isLoading } = useSWR<ProfilesData>(endpoint, fetcher)

  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null)
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (data?.qualityProfiles?.length && qualityProfileId === null) {
      setQualityProfileId(data.qualityProfiles[0].id)
    }
    if (data?.rootFolders?.length && rootFolderPath === null) {
      setRootFolderPath(data.rootFolders[0].path)
    }
  }, [data, qualityProfileId, rootFolderPath])

  const handleSubmit = async () => {
    if (qualityProfileId === null || rootFolderPath === null) return
    setSubmitting(true)
    setSubmitError(null)

    try {
      if (type === "movie") {
        const res = await fetch("/api/radarr/movies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tmdbId,
            title,
            year: year ?? new Date().getFullYear(),
            qualityProfileId,
            rootFolderPath,
            monitored: true,
            addOptions: { searchForMovie: true },
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? "Failed to add movie")
        }
      } else {
        const resolvedTvdbId = tvdbId ?? tmdbId
        const seasonsPayload = Array.from({ length: 30 }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: true,
        }))

        const res = await fetch("/api/sonarr/series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tvdbId: resolvedTvdbId,
            title,
            qualityProfileId,
            rootFolderPath,
            monitored: true,
            seasonFolder: true,
            addOptions: { searchForMissingEpisodes: true },
            seasons: seasonsPayload,
          }),
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.error ?? "Failed to add series")
        }
      }

      onSuccess()
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Request failed")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-none bg-card border border-border p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add to Library</h2>
          <button onClick={onClose} className="text-muted hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted">
          Requesting: <span className="text-foreground">{title}</span>
        </p>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted" />
          </div>
        )}

        {error && (
          <p className="py-4 text-sm text-red-400">
            Failed to load profiles. Make sure Radarr/Sonarr is accessible.
          </p>
        )}

        {data && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Quality Profile</label>
              <select
                value={qualityProfileId ?? ""}
                onChange={(e) => setQualityProfileId(Number(e.target.value))}
                className="w-full rounded-none border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {data.qualityProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Root Folder</label>
              <select
                value={rootFolderPath ?? ""}
                onChange={(e) => setRootFolderPath(e.target.value)}
                className="w-full rounded-none border border-border bg-background px-3 py-2 text-sm text-foreground"
              >
                {data.rootFolders.map((f) => (
                  <option key={f.id} value={f.path}>
                    {f.path}
                  </option>
                ))}
              </select>
            </div>

            {submitError && (
              <p className="text-sm text-red-400">{submitError}</p>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                variant="accent"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? "Adding..." : "Add to Library"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
