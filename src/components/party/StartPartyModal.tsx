"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, ChevronDown, Copy, Film, Loader2, Users, X } from "lucide-react"

type PartyUser = {
  id: string
  username: string
  avatarUrl?: string
}

type EpisodeItem = {
  id: string
  title: string
  seasonNumber: number
  episodeNumber: number
  status: string
  thumbUrl: string
}

export type StartPartyModalProps = {
  isOpen: boolean
  onClose: () => void
  itemId?: string | null
  seriesId?: string | null
  existingPartyId?: string | null
}

export function StartPartyModal({
  isOpen,
  onClose,
  itemId,
  seriesId,
  existingPartyId,
}: StartPartyModalProps) {
  const router = useRouter()
  const [users, setUsers] = useState<PartyUser[]>([])
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [partyId, setPartyId] = useState<string | null>(existingPartyId ?? null)

  // ── Episode picker state (TV series) ──
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(null)
  const [episodePickerExpanded, setEpisodePickerExpanded] = useState(false)

  const hasSeries = !!seriesId

  // Resolve the effective itemId: either direct itemId or selected episode
  const effectiveItemId = selectedEpisodeId || itemId || null

  // Fetch episodes when seriesId is provided
  useEffect(() => {
    if (!isOpen || !hasSeries || !seriesId) return
    let cancelled = false
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoadingEpisodes(true)
    setSelectedEpisodeId(null)
    setEpisodePickerExpanded(true)
    /* eslint-enable react-hooks/set-state-in-effect */

    fetch(`/api/jellyfin/series/${seriesId}/episodes`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.episodes)) {
          const playable = data.episodes.filter(
            (e: EpisodeItem) => e.status === "in_library"
          )
          setEpisodes(playable)
        }
      })
      .catch((err) => console.error("[StartPartyModal] Failed to fetch episodes", err))
      .finally(() => {
        if (!cancelled) setLoadingEpisodes(false)
      })

    return () => { cancelled = true }
  }, [isOpen, hasSeries, seriesId])

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setSelectedUserIds([])
      setCopied(false)
      setInviteError(null)
      if (!existingPartyId) setPartyId(null)
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [isOpen, existingPartyId])

  // Fetch candidate users for invitation
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setLoadingUsers(true)

    fetch("/api/party/users")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.users) {
          setUsers(data.users)
        }
      })
      .catch((err) => console.error("[StartPartyModal] Failed to fetch users", err))
      .finally(() => {
        if (!cancelled) setLoadingUsers(false)
      })

    return () => {
      cancelled = true
    }
  }, [isOpen])

  // Create room or ensure partyId exists
  const ensureRoom = useCallback(async (): Promise<string | null> => {
    if (partyId) return partyId

    try {
      const res = await fetch("/api/party", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: effectiveItemId ?? null }),
      })
      if (!res.ok) return null
      const data = await res.json()
      setPartyId(data.partyId)
      return data.partyId
    } catch {
      return null
    }
  }, [partyId, effectiveItemId])

  const handleCopyLink = async () => {
    const id = await ensureRoom()
    if (!id) return
    const shareUrl = `${window.location.origin}/party/join/${id}`
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const toggleUserSelection = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const id = await ensureRoom()
      if (!id) throw new Error("Failed to create room")

      if (selectedUserIds.length > 0) {
        const inviteRes = await fetch(`/api/party/${id}/invite`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: selectedUserIds }),
        })
        if (!inviteRes.ok) {
          let message = "Failed to send invites. Please try again."
          try {
            const data = (await inviteRes.json()) as { error?: string }
            if (data?.error) message = data.error
          } catch {
            /* non-JSON error body */
          }
          setInviteError(message)
          setSubmitting(false)
          return
        }
      }

      onClose()
      if (!existingPartyId) {
        router.push(`/watch?party=${id}`)
      }
    } catch (err) {
      console.error("[StartPartyModal] Invite/launch error:", err)
    } finally {
      setSubmitting(false)
    }
  }

  // Group episodes by season (must be before early return — hooks order)
  const episodesBySeason = useMemo(() => {
    const grouped: Record<number, EpisodeItem[]> = {}
    for (const ep of episodes) {
      const s = ep.seasonNumber
      if (!grouped[s]) grouped[s] = []
      grouped[s].push(ep)
    }
    return Object.entries(grouped).sort(
      ([a], [b]) => Number(a) - Number(b)
    )
  }, [episodes])

  const [origin, setOrigin] = useState("")

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect */
    setOrigin(window.location.origin)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  if (!isOpen) return null

  const shareableUrl = partyId
    ? `${origin || ""}/party/join/${partyId}`
    : "Link will generate on copy or launch"

  const selectedEpisode = episodes.find((e) => e.id === selectedEpisodeId)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-party-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-2 sm:p-4 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md border border-border bg-[#141519] shadow-2xl rounded-none text-white flex flex-col max-h-[90dvh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 p-4 sm:p-6 pb-4 shrink-0 bg-[#141519] z-10">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded bg-accent/20 text-accent">
              <Users className="size-5" />
            </div>
            <div>
              <h2 id="start-party-modal-title" className="text-lg font-extrabold uppercase tracking-wider">
                {existingPartyId ? "Invite Members" : "Start a Watch Party"}
              </h2>
              <p className="text-xs text-gray-400">
                Watch together in sync with friends
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-gray-400 hover:text-white transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {/* Episode picker (for TV shows) */}
          {hasSeries && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
                  Select Episode
                </label>
                <button
                  onClick={() => setEpisodePickerExpanded((p) => !p)}
                  className="flex items-center gap-1 text-[11px] text-accent hover:underline min-h-[44px]"
                >
                  {episodePickerExpanded ? "Collapse" : "Expand"}
                  <ChevronDown
                    className={`size-3 transition-transform ${
                      episodePickerExpanded ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </div>

              {selectedEpisode && !episodePickerExpanded && (
                <div className="flex items-center gap-2.5 bg-accent/10 border border-accent/30 px-3 py-2">
                  <Film className="size-4 text-accent shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">
                      S{selectedEpisode.seasonNumber}:E{selectedEpisode.episodeNumber} — {selectedEpisode.title}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedEpisodeId(null)
                      setEpisodePickerExpanded(true)
                    }}
                    className="text-[10px] text-gray-400 hover:text-white underline shrink-0"
                  >
                    Change
                  </button>
                </div>
              )}

              {episodePickerExpanded && (
                <div className="max-h-52 overflow-y-auto border border-border/80 bg-surface/50 divide-y divide-border/40">
                  {loadingEpisodes ? (
                    <div className="flex items-center justify-center p-6 text-gray-400 gap-2">
                      <Loader2 className="size-5 animate-spin text-accent" />
                      <span className="text-xs">Loading episodes…</span>
                    </div>
                  ) : episodesBySeason.length === 0 ? (
                    <div className="p-6 text-center text-xs text-gray-400">
                      No playable episodes found in this series.
                    </div>
                  ) : (
                    episodesBySeason.map(([seasonNum, seasonEps]) => (
                      <div key={seasonNum}>
                        <div className="px-3 py-1.5 bg-surface border-b border-border/30 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                          Season {seasonNum}
                        </div>
                        {seasonEps.map((ep) => {
                          const isSelected = selectedEpisodeId === ep.id
                          return (
                            <div
                              key={ep.id}
                              onClick={() => {
                                setSelectedEpisodeId(ep.id)
                                setEpisodePickerExpanded(false)
                              }}
                              className={`flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                                isSelected
                                  ? "bg-accent/20 text-accent font-extrabold"
                                  : "hover:bg-surface-hover text-gray-200"
                              }`}
                            >
                              <div className="flex items-center gap-2 truncate">
                                <span className="text-xs font-bold font-mono">
                                  E{ep.episodeNumber}
                                </span>
                                <span className="text-xs truncate">{ep.title}</span>
                              </div>
                              {isSelected && <Check className="size-3.5 text-accent shrink-0" />}
                            </div>
                          )
                        })}
                      </div>
                    ))
                  )}
                </div>
              )}

              {!selectedEpisodeId && !loadingEpisodes && episodes.length > 0 && (
                <p className="text-[10px] text-amber-400">
                  Please select an episode before launching the party.
                </p>
              )}
            </div>
          )}

          {/* Copy Shareable Link Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
              Shareable Invite Link
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareableUrl}
                className="flex-1 bg-surface border border-border px-3 py-2 text-[16px] sm:text-xs font-mono text-gray-300 truncate focus:outline-none"
              />
              <button
                onClick={handleCopyLink}
                className="flex min-h-[44px] items-center gap-1.5 bg-accent hover:bg-accent-hover px-4 py-2 text-xs font-bold text-white transition-colors rounded-none"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* User Selection List */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
              Invite Users Directly ({selectedUserIds.length} selected)
            </label>

            <div className="max-h-48 overflow-y-auto divide-y divide-border/40 border border-border/80 bg-surface/50">
              {loadingUsers ? (
                <div className="flex items-center justify-center p-6 text-gray-400 gap-2">
                  <Loader2 className="size-5 animate-spin text-accent" />
                  <span className="text-xs">Loading available users…</span>
                </div>
              ) : users.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">
                  No other users found on this server. Share the link above to invite!
                </div>
              ) : (
                users.map((u) => {
                  const isSelected = selectedUserIds.includes(u.id)
                  return (
                    <div
                      key={u.id}
                      onClick={() => toggleUserSelection(u.id)}
                      className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                        isSelected ? "bg-accent/15" : "hover:bg-surface-hover"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-8 items-center justify-center rounded-full bg-accent/20 font-bold text-accent text-xs">
                          {u.username.substring(0, 2).toUpperCase()}
                        </div>
                        <span className="text-xs font-semibold text-gray-200">
                          {u.username}
                        </span>
                      </div>
                      <div
                        className={`size-4 rounded border flex items-center justify-center transition-colors ${
                          isSelected
                            ? "bg-accent border-accent text-white"
                            : "border-gray-600"
                        }`}
                      >
                        {isSelected && <Check className="size-3 stroke-[3]" />}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {inviteError && (
            <p role="alert" className="text-[11px] text-red-400">
              {inviteError}
            </p>
          )}
        </div>

        {/* Pinned Sticky Action Footer */}
        <div className="sticky bottom-0 bg-[#141519] border-t border-border/80 p-4 shrink-0 z-10 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors min-h-[44px]"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || (hasSeries && !selectedEpisodeId)}
            className="flex min-h-[44px] items-center gap-2 bg-accent hover:bg-accent-hover px-5 py-2.5 text-xs font-extrabold uppercase tracking-wider text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg rounded-none"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Launching…</span>
              </>
            ) : existingPartyId ? (
              <span>Send Invites</span>
            ) : (
              <span>Start Watch Party</span>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
