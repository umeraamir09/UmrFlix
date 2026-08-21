"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2, TriangleAlert } from "lucide-react"
import { CinemaPlayer } from "@/components/player/CinemaPlayer"
import type { NextEpisodeInfo } from "@/components/player/PlayerOverlays"
import { parsePlaybackPayload, type PlaybackPayload } from "@/lib/playback-types"
import type { AvailabilityResult } from "@/app/api/availability/route"
import type { EpisodeInfo, SeasonInfo } from "@/components/SeasonBrowser"
import { PartyRoomSnapshot, predictedPosition } from "@/lib/party/protocol"

type WatchError = {
  message: string
  detailHref?: string
}

function sortEpisodes(a: EpisodeInfo, b: EpisodeInfo) {
  return a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber
}

function playableEpisodes(eps: EpisodeInfo[] = []): EpisodeInfo[] {
  return eps.filter((e) => e.status === "in_library").sort(sortEpisodes)
}

/** Pick what to play for a series: in-progress episode → first unplayed → first episode. */
function pickSeriesEpisode(eps: EpisodeInfo[] = []): EpisodeInfo | null {
  const playable = playableEpisodes(eps)
  if (playable.length === 0) return null
  const inProgress = playable.find((e) => e.resumeTicks > 0 && !e.played)
  if (inProgress) return inProgress
  return playable.find((e) => !e.played) ?? playable[0]
}

function episodeLabel(ep: Pick<EpisodeInfo, "seasonNumber" | "episodeNumber">) {
  return `S${ep.seasonNumber}:E${ep.episodeNumber}`
}

export function WatchPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const idParam = searchParams.get("id")
  const tmdbParam = searchParams.get("tmdb")
  const typeParam = searchParams.get("type") // "movie" | "tv"
  const partyParam = searchParams.get("party")

  const [resolvedId, setResolvedId] = useState<string | null>(null)
  const [payload, setPayload] = useState<PlaybackPayload | null>(null)
  const [episodes, setEpisodes] = useState<EpisodeInfo[] | null>(null)
  const [seasons, setSeasons] = useState<SeasonInfo[]>([])
  const [error, setError] = useState<WatchError | null>(null)
  const [partyInfo, setPartyInfo] = useState<{ partyId: string; isOwner: boolean } | null>(null)
  const [partyStartAt, setPartyStartAt] = useState<number | undefined>(undefined)

  // ── Resolve WHAT to play (episode / series → episode / tmdb → jellyfin) ──
  useEffect(() => {
    let cancelled = false
    const fail = (e: WatchError) => {
      if (!cancelled) setError(e)
    }
    const play = (itemId: string) => {
      if (!cancelled) setResolvedId(itemId)
    }
    const playSeries = async (seriesId: string) => {
      const res = await fetch(`/api/jellyfin/series/${seriesId}/episodes`)
      const contentType = res.headers.get("content-type") || ""
      if (!res.ok || !contentType.includes("application/json")) {
        let errMsg = `Failed to load episodes (HTTP ${res.status})`
        try {
          const d = await res.json()
          if (d?.error) errMsg = d.error
        } catch {}
        throw new Error(errMsg)
      }
      const data = await res.json()
      const target = pickSeriesEpisode(data.episodes)
      if (!target) {
        fail({ message: "No playable episodes found in your library for this series yet." })
        return
      }
      play(target.id)
    }

    void (async () => {
      setResolvedId(null)
      setPayload(null)
      setEpisodes(null)
      setSeasons([])
      setError(null)

      try {
        if (partyParam) {
          const partyRes = await fetch(`/api/party/${partyParam}`)
          if (partyRes.ok) {
            const snap: PartyRoomSnapshot = await partyRes.json().catch(() => null)
            if (snap && !cancelled) {
              setPartyInfo({ partyId: partyParam, isOwner: snap.isOwner })
              if (snap.state) {
                const estPos = predictedPosition(snap.state, snap.serverNow)
                setPartyStartAt(estPos)
                if (snap.state.itemId) {
                  play(snap.state.itemId)
                  return
                }
              }
            }
          }
        }

        if (idParam) {
          if (typeParam === "tv") {
            await playSeries(idParam)
          } else {
            play(idParam)
          }
          return
        }

        if (tmdbParam) {
          const mediaType = typeParam === "tv" ? "tv" : "movie"
          const res = await fetch(`/api/availability?tmdbId=${tmdbParam}&type=${mediaType}`)
          const contentType = res.headers.get("content-type") || ""
          if (!res.ok || !contentType.includes("application/json")) {
            throw new Error(`Failed to check availability (HTTP ${res.status})`)
          }
          const data = await res.json()
          const av: AvailabilityResult | undefined = data.results?.[`${mediaType}-${tmdbParam}`]
          if (av?.status === "in_library" && av.jellyfinItemId) {
            if (mediaType === "tv") {
              await playSeries(av.jellyfinItemId)
            } else {
              play(av.jellyfinItemId)
            }
          } else {
            fail({
              message: "This title isn't in your library yet. Request it first, then come back to watch.",
              detailHref: `/${mediaType}/${tmdbParam}`,
            })
          }
          return
        }

        if (!partyParam) {
          fail({ message: "Nothing to play — no movie or episode was specified." })
        }
      } catch (e) {
        fail({ message: e instanceof Error ? e.message : "Failed to resolve the title to play." })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [idParam, tmdbParam, typeParam, partyParam])

  // ── Metadata / series context for the resolved item ──
  useEffect(() => {
    if (!resolvedId) return
    let cancelled = false
    fetch(`/api/jellyfin/playback/${resolvedId}`)
      .then(async (r) => {
        const contentType = r.headers.get("content-type") || ""
        if (!r.ok || !contentType.includes("application/json")) {
          let errorMsg = `Failed to load stream info (HTTP ${r.status})`
          try {
            const errData = await r.json()
            if (errData?.error) errorMsg = errData.error
          } catch {}
          throw new Error(errorMsg)
        }
        let raw: unknown
        try {
          raw = await r.json()
        } catch {
          throw new Error("Malformed playback data received")
        }
        if (!raw || (typeof raw === "object" && "error" in raw && !("itemId" in raw))) {
          throw new Error((raw as { error?: string })?.error ?? "Failed to load stream info")
        }
        return parsePlaybackPayload(raw)
      })
      .then((p) => {
        if (cancelled) return
        setPayload(p)
        if (p.series?.id) {
          fetch(`/api/jellyfin/series/${p.series.id}/episodes`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d && !cancelled) {
                setEpisodes(d.episodes ?? [])
                setSeasons(d.seasons ?? [])
              }
            })
            .catch(() => {})
        }
      })
      .catch(() => {
        // CinemaPlayer surfaces its own load error UI
      })
    return () => {
      cancelled = true
    }
  }, [resolvedId])

  // ── Next episode in the Jellyfin library (series context from the payload) ──
  const nextEpisode = useMemo<NextEpisodeInfo | null>(() => {
    const series = payload?.series
    if (!series || !episodes) return null
    const playable = playableEpisodes(episodes)
    if (playable.length === 0) return null

    const currentIdx = playable.findIndex((e) => e.id === resolvedId)
    const next =
      currentIdx >= 0
        ? playable[currentIdx + 1]
        : playable.find(
            (e) =>
              e.seasonNumber > (series.season ?? 0) ||
              (e.seasonNumber === (series.season ?? 0) && e.episodeNumber > (series.episode ?? 0)),
          )
    if (!next) return null
    return { id: next.id, title: next.title, label: episodeLabel(next), imageUrl: next.thumbUrl }
  }, [payload, episodes, resolvedId])

  const goToNextEpisode = useCallback(() => {
    if (!nextEpisode) return
    setResolvedId(nextEpisode.id)
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState(null, "", `/watch?id=${nextEpisode.id}`)
    }
  }, [nextEpisode])

  const handlePartyNextEpisode = useCallback(async () => {
    // Host advances the entire party to the next episode
    if (!nextEpisode || !partyInfo) return
    const { partyId } = partyInfo
    try {
      await fetch(`/api/party/${partyId}/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: nextEpisode.id }),
      })
      // Update locally — SSE broadcast will handle guests via onPartyItemChange
      setResolvedId(nextEpisode.id)
      if (typeof window !== "undefined" && window.history?.replaceState) {
        window.history.replaceState(null, "", `/watch?party=${partyId}`)
      }
    } catch (err) {
      console.error("[WatchPage] Party next episode error:", err)
    }
  }, [nextEpisode, partyInfo])

  const handleSelectEpisode = useCallback(
    async (episodeId: string) => {
      if (partyInfo) {
        if (!partyInfo.isOwner) return
        try {
          await fetch(`/api/party/${partyInfo.partyId}/item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId: episodeId }),
          })
          setResolvedId(episodeId)
          if (typeof window !== "undefined" && window.history?.replaceState) {
            window.history.replaceState(null, "", `/watch?party=${partyInfo.partyId}`)
          }
        } catch (err) {
          console.error("[WatchPage] Party episode select error:", err)
        }
        return
      }
      setResolvedId(episodeId)
      if (typeof window !== "undefined" && window.history?.replaceState) {
        window.history.replaceState(null, "", `/watch?id=${episodeId}`)
      }
    },
    [partyInfo],
  )

  const handleBack = useCallback(() => {
    if (window.history.length > 1) router.back()
    else router.push("/")
  }, [router])

  // Party-aware next-episode handler (must be before any early return — hooks order)
  const effectiveOnNextEpisode = useMemo(() => {
    if (!nextEpisode) return undefined
    if (partyInfo) {
      return partyInfo.isOwner ? handlePartyNextEpisode : undefined
    }
    return goToNextEpisode
  }, [nextEpisode, partyInfo, handlePartyNextEpisode, goToNextEpisode])

  // Party-aware arbitrary-episode handler for the in-player episode browser
  const effectiveOnSelectEpisode = useMemo(() => {
    if (partyInfo && !partyInfo.isOwner) return undefined
    return handleSelectEpisode
  }, [partyInfo, handleSelectEpisode])

  if (error) {
    return (
      <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <TriangleAlert className="size-10 text-accent" />
        <p className="text-lg font-bold text-white">Unable to play this title</p>
        <p className="max-w-md text-sm text-gray-400">{error.message}</p>
        <div className="flex items-center gap-3 pt-2">
          {error.detailHref && (
            <Link
              href={error.detailHref}
              className="rounded-none bg-accent px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
            >
              View Details
            </Link>
          )}
          <button
            onClick={handleBack}
            className="rounded-none border border-border bg-card px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
          >
            Go Back
          </button>
        </div>
      </div>
    )
  }

  if (!resolvedId) {
    return (
      <div className="flex min-h-[100dvh] w-full flex-col items-center justify-center gap-3 bg-black text-gray-400">
        <Loader2 className="size-10 animate-spin text-accent" />
        <p className="text-sm font-semibold">
          {partyParam ? "Joining watch party…" : "Preparing your stream…"}
        </p>
      </div>
    )
  }

  const series = payload?.series
  const playerTitle = series?.name
    ? `${series.name} — S${series.season ?? "?"}:E${series.episode ?? "?"}`
    : (payload?.title ?? "")
  const playerSubtitle = series?.name ? payload?.title : undefined
  return (
    <CinemaPlayer
      fill
      itemId={resolvedId}
      title={playerTitle}
      subtitle={playerSubtitle}
      poster={payload?.backdropUrl}
      autoPlay
      nextEpisode={nextEpisode}
      onNextEpisode={effectiveOnNextEpisode}
      episodes={episodes}
      seasons={seasons}
      onSelectEpisode={effectiveOnSelectEpisode}
      onBack={handleBack}
      party={partyInfo ?? undefined}
      startAtSec={partyStartAt}
      onPartyItemChange={(newItemId) => setResolvedId(newItemId)}
      onPartyEnded={() => router.push("/")}
    />
  )
}
