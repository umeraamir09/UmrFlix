"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "@/components/Toast"
import { acquireSharedEventSource } from "@/lib/use-event-stream"
import {
  DRIFT_THRESHOLDS,
  PartyCommand,
  PartyCommandType,
  PartyMember,
  PartyRoomSnapshot,
  PartyState,
  predictedPosition,
} from "@/lib/party/protocol"

export type UsePartySyncOptions = {
  partyId?: string
  clientId: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  seekTo?: (timeSec: number) => void
  togglePlay?: () => void
  onItemChange?: (itemId: string) => void
  onPartyEnded?: () => void
}

export type UsePartySyncReturn = {
  sendCommand: (
    type: PartyCommandType,
    positionSec?: number,
    playbackRate?: number
  ) => Promise<void>
  partyState: PartyState | null
  members: PartyMember[]
  isOwner: boolean
  serverOffset: number
  isBuffering: boolean
  bufferingUsers: string[]
}

export function usePartySync({
  partyId,
  clientId,
  videoRef,
  seekTo,
  onItemChange,
  onPartyEnded,
}: UsePartySyncOptions): UsePartySyncReturn {
  const { toast } = useToast()
  const [partyState, setPartyState] = useState<PartyState | null>(null)
  const [members, setMembers] = useState<PartyMember[]>([])
  const [isOwner, setIsOwner] = useState<boolean>(false)
  const [serverOffset, setServerOffset] = useState<number>(0) // serverTime - localTime

  const versionRef = useRef<number>(0)
  const partyStateRef = useRef<PartyState | null>(null)
  const serverOffsetRef = useRef<number>(0)
  const bufferingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const bufferingReportedRef = useRef<boolean>(false)
  const isSeekingOrScrubbingRef = useRef<boolean>(false)
  const prevMembersRef = useRef<PartyMember[]>([])
  const userIdRef = useRef<string | null>(null)
  const isOwnerRef = useRef<boolean>(false)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
  const partyEndedRef = useRef<boolean>(false)
  const lastSeekRef = useRef<{ target: number; at: number } | null>(null)
  const initialApplyRef = useRef<boolean>(false)
  const bestRttRef = useRef<number>(Infinity)
  const lastHardSeekAtRef = useRef<number>(0)

  // Keep refs synchronized
  useEffect(() => {
    partyStateRef.current = partyState
    serverOffsetRef.current = serverOffset
  }, [partyState, serverOffset])

  // Immediately applies a peer's state to the local video (seek + play/pause parity).
  // Runs on SSE delivery rather than waiting for the periodic drift loop.
  const applyPartyState = useCallback(
    (state: PartyState) => {
      const video = videoRef.current
      if (!video || state.senderClientId === clientId) return

      // Don't fight the user's in-flight scrub on the same item
      if (isSeekingOrScrubbingRef.current) return

      // Play / Pause parity
      if (state.playing && video.paused) {
        video.play().catch(() => {})
      } else if (!state.playing && !video.paused) {
        video.pause()
      }

      const serverNowEst = Date.now() + serverOffsetRef.current
      let targetPos = predictedPosition(state, serverNowEst)
      // Never aim past the end of the media (duration can be NaN/Infinity for live)
      if (Number.isFinite(video.duration) && video.duration > 0) {
        targetPos = Math.min(targetPos, video.duration)
      }
      const drift = video.currentTime - targetPos

      // Immediate reposition when the peer action moved us out of tolerance
      if (Math.abs(drift) > DRIFT_THRESHOLDS.SEEK_THRESHOLD) {
        // Oscillation guard: skip re-seek to a nearby target we just re-positioned to
        const last = lastSeekRef.current
        if (
          last &&
          Math.abs(last.target - targetPos) < DRIFT_THRESHOLDS.RESEEK_GUARD &&
          Date.now() - last.at < 1500
        ) {
          return
        }
        lastSeekRef.current = { target: targetPos, at: Date.now() }
        if (seekTo) {
          seekTo(targetPos)
        } else {
          video.currentTime = targetPos
        }
      }
    },
    [clientId, seekTo, videoRef]
  )

  // Multi-sample clock sync: take 3 quick snapshots and keep the min-RTT offset
  // estimate. A single cold-RTT sample (e.g. first fetch after connect) can be
  // hundreds of ms off and would otherwise poison every drift computation.
  const syncServerClock = useCallback(async () => {
    if (!partyId) return
    let best: { offset: number; rtt: number } | null = null
    for (let i = 0; i < 3; i++) {
      try {
        const startTime = Date.now()
        const res = await fetch(`/api/party/${partyId}`)
        const receiveTime = Date.now()
        if (!res.ok) continue
        const snapshot: PartyRoomSnapshot = await res.json()
        const rtt = receiveTime - startTime
        const offset = snapshot.serverNow + rtt / 2 - receiveTime
        if (!best || rtt < best.rtt) best = { offset, rtt }
      } catch {
        // best-effort; refreshSnapshot covers state anyway
      }
      if (i < 2) await new Promise((r) => setTimeout(r, 300))
    }
    if (best) {
      bestRttRef.current = Math.min(bestRttRef.current, best.rtt)
      serverOffsetRef.current = best.offset
      setServerOffset(best.offset)
    }
  }, [partyId])

  // Fetch latest snapshot from server
  const refreshSnapshot = useCallback(async () => {
    if (!partyId) return null
    try {
      const startTime = Date.now()
      const res = await fetch(`/api/party/${partyId}`)
      if (res.status === 404) {
        // Room has been cleaned up — trigger ended callback
        if (!partyEndedRef.current) {
          partyEndedRef.current = true
          onPartyEnded?.()
        }
        return null
      }
      if (!res.ok) return null

      const receiveTime = Date.now()
      const snapshot: PartyRoomSnapshot = await res.json()

      // Store userId for owner comparison
      userIdRef.current = snapshot.userId

      // Update smoothed server clock offset (EWMA over RTT/2 estimates).
      // High-RTT samples are rejected so a transient slow poll can't drag the
      // offset; the offset itself is seeded by syncServerClock (min-RTT).
      const rtt = receiveTime - startTime
      bestRttRef.current = Math.min(bestRttRef.current, rtt)
      const rttOk = rtt < 250 || rtt < bestRttRef.current * 1.5
      const estimatedServerNow = snapshot.serverNow + rtt / 2
      const offset = estimatedServerNow - receiveTime
      const smoothedOffset =
        serverOffsetRef.current === 0
          ? offset
          : rttOk
            ? serverOffsetRef.current * 0.7 + offset * 0.3
            : serverOffsetRef.current

      setServerOffset(smoothedOffset)
      serverOffsetRef.current = smoothedOffset
      setIsOwner(snapshot.isOwner)
      isOwnerRef.current = snapshot.isOwner
      setMembers(snapshot.members)
      prevMembersRef.current = snapshot.members

      if (snapshot.state && snapshot.state.version >= versionRef.current) {
        const isNewer = snapshot.state.version > versionRef.current
        versionRef.current = snapshot.state.version
        setPartyState(snapshot.state)
        // Apply immediately on first snapshot (join) or a newer state arriving
        // outside of SSE, so a joiner snaps straight to the party position.
        if (!initialApplyRef.current) {
          initialApplyRef.current = true
          applyPartyState(snapshot.state)
        } else if (isNewer) {
          applyPartyState(snapshot.state)
        }
      }

      return snapshot
    } catch (err) {
      console.error("[usePartySync] Failed to refresh snapshot:", err)
      return null
    }
  }, [partyId, onPartyEnded, applyPartyState])

  // Initial load: sync the clock first so the first state application uses an
  // accurate offset, then pull the full snapshot.
  useEffect(() => {
    if (partyId) {
      void (async () => {
        await syncServerClock()
        await refreshSnapshot()
      })()
    }
  }, [partyId, syncServerClock, refreshSnapshot])

  // Command dispatcher
  const sendCommand = useCallback(
    async (
      type: PartyCommandType,
      positionSec?: number,
      playbackRate?: number
    ) => {
      if (!partyId) return
      const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      const video = videoRef.current

      const pos = positionSec ?? (video ? video.currentTime : 0)

      const payload: PartyCommand = {
        type,
        positionSec: pos,
        playbackRate,
        clientId,
        commandId,
      }

      try {
        const res = await fetch(`/api/party/${partyId}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.state && data.state.version > versionRef.current) {
            versionRef.current = data.state.version
            setPartyState(data.state)
          }
        }
      } catch (err) {
        console.error("[usePartySync] Send command failed:", err)
      }
    },
    [partyId, clientId, videoRef]
  )

  // Report buffering status to room
  const sendStatus = useCallback(
    async (buffering: boolean, pos?: number) => {
      if (!partyId) return
      try {
        const video = videoRef.current
        const positionSec = pos ?? (video ? video.currentTime : 0)
        const res = await fetch(`/api/party/${partyId}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buffering, positionSec }),
        })
        if (res.ok) {
          const data = await res.json()
          if (data.state && data.state.version > versionRef.current) {
            versionRef.current = data.state.version
            setPartyState(data.state)
          }
        }
      } catch (err) {
        console.error("[usePartySync] Status update failed:", err)
      }
    },
    [partyId, videoRef]
  )

  // SSE event handling
  useEffect(() => {
    if (!partyId) return

    const { es: eventSource, release } = acquireSharedEventSource(() => {
      // SSE (re)connected: re-sync the clock against the warm connection, then refresh
      void syncServerClock()
      void refreshSnapshot()
    })

    const handlePartyState = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.partyId !== partyId) return

        const state: PartyState = payload.state
        if (!state) return

        // Echo suppression: ignore if from this tab and drift is small
        if (state.senderClientId === clientId) {
          if (versionRef.current < state.version) {
            versionRef.current = state.version
            setPartyState(state)
          }
          return
        }

        if (state.version > versionRef.current) {
          versionRef.current = state.version
          setPartyState(state)
          // Immediate reaction to a peer action — no waiting for the drift loop
          applyPartyState(state)
        }
      } catch (err) {
        console.error("[usePartySync] Error parsing party:state", err)
      }
    }

    const handlePartyMembership = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.partyId !== partyId) return

        // Update isOwner when ownerId is present in payload
        if (typeof payload.ownerId === "string" && userIdRef.current) {
          const isOwnerNow = payload.ownerId === userIdRef.current
          if (isOwnerNow !== isOwnerRef.current) {
            setIsOwner(isOwnerNow)
            isOwnerRef.current = isOwnerNow
          }
        }

        if (Array.isArray(payload.members)) {
          const newMembers: PartyMember[] = payload.members
          const oldMembers = prevMembersRef.current

          // Diff members to trigger join/leave toasts
          if (oldMembers.length > 0) {
            const added = newMembers.filter(
              (nm) => !oldMembers.some((om) => om.userId === nm.userId)
            )
            const removed = oldMembers.filter(
              (om) => !newMembers.some((nm) => nm.userId === om.userId)
            )

            for (const m of added) {
              toast(`${m.username} joined the Watch Party`, "info")
            }
            for (const m of removed) {
              toast(`${m.username} left the Watch Party`, "info")
            }
            if (payload.action === "owner-changed" && newMembers.length > 0) {
              toast(`${newMembers[0].username} is now the Watch Party host`, "info")
            }
          }

          prevMembersRef.current = newMembers
          setMembers(newMembers)
        }
      } catch (err) {
        console.error("[usePartySync] Error parsing party:membership", err)
      }
    }

    const handlePartyEnded = () => {
      if (!partyEndedRef.current) {
        partyEndedRef.current = true
        toast("This watch party has ended", "info")
        onPartyEnded?.()
      }
    }

    const handlePartyItem = (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data)
        if (payload.partyId !== partyId) return
        if (payload.state) {
          const state = payload.state as PartyState
          const isNewer = state.version >= versionRef.current
          versionRef.current = state.version
          setPartyState(state)
          if (isNewer && state.senderClientId !== clientId) {
            applyPartyState(state)
          }
        }
        if (payload.itemId && onItemChange) {
          onItemChange(payload.itemId)
        }
      } catch (err) {
        console.error("[usePartySync] Error parsing party:item", err)
      }
    }

    eventSource.addEventListener("party:state", handlePartyState as EventListener)
    eventSource.addEventListener("party:membership", handlePartyMembership as EventListener)
    eventSource.addEventListener("party:ended", handlePartyEnded as EventListener)
    eventSource.addEventListener("party:item", handlePartyItem as EventListener)

    return () => {
      eventSource.removeEventListener("party:state", handlePartyState as EventListener)
      eventSource.removeEventListener("party:membership", handlePartyMembership as EventListener)
      eventSource.removeEventListener("party:ended", handlePartyEnded as EventListener)
      eventSource.removeEventListener("party:item", handlePartyItem as EventListener)
      release()
    }
  }, [partyId, clientId, onItemChange, onPartyEnded, refreshSnapshot, applyPartyState, toast, syncServerClock])

  // Heartbeat ping every 60s to keep presence alive
  useEffect(() => {
    if (!partyId) return

    const heartbeat = async () => {
      try {
        await fetch(`/api/party/${partyId}/ping`, { method: "POST" })
      } catch {}
    }

    heartbeat()
    heartbeatRef.current = setInterval(heartbeat, 60_000)

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
    }
  }, [partyId])

  // Periodic 5s snapshot polling safety net (ensures membership & state sync even if SSE drops/buffers)
  useEffect(() => {
    if (!partyId) return

    const pollInterval = setInterval(() => {
      void refreshSnapshot()
    }, 5000)

    return () => {
      clearInterval(pollInterval)
    }
  }, [partyId, refreshSnapshot])

  // beforeunload: notify server on tab close
  useEffect(() => {
    if (!partyId) return

    const handleBeforeUnload = () => {
      navigator.sendBeacon(`/api/party/${partyId}/leave`, "")
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
    }
  }, [partyId])

  // Background tab recovery listener (visibilitychange)
  useEffect(() => {
    if (!partyId) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshSnapshot()
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [partyId, refreshSnapshot])

  // Video event listeners for buffer detection
  useEffect(() => {
    const video = videoRef.current
    if (!video || !partyId) return

    const handleWaiting = () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      // Debounce waiting for 1s (ignore micro-stalls); report once per episode.
      // Lower latency here = peers pause sooner and drift apart less.
      bufferingTimerRef.current = setTimeout(() => {
        // `waiting` also fires during seeks/scrubs — don't pause the room for that
        if (isSeekingOrScrubbingRef.current) return
        if (!bufferingReportedRef.current) {
          bufferingReportedRef.current = true
          sendStatus(true, video.currentTime)
        }
      }, 1000)
    }

    // Recovery signals — report buffering ended on whichever fires first
    const reportRecovered = () => {
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current)
        bufferingTimerRef.current = null
      }
      if (bufferingReportedRef.current) {
        bufferingReportedRef.current = false
        sendStatus(false, video.currentTime)
      }
    }

    const handlePlaying = reportRecovered
    const handleCanPlay = reportRecovered
    const handleLoadedData = reportRecovered

    const handleSeeking = () => {
      isSeekingOrScrubbingRef.current = true
    }

    const handleSeeked = () => {
      isSeekingOrScrubbingRef.current = false
    }

    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("playing", handlePlaying)
    video.addEventListener("canplay", handleCanPlay)
    video.addEventListener("loadeddata", handleLoadedData)
    video.addEventListener("seeking", handleSeeking)
    video.addEventListener("seeked", handleSeeked)

    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("playing", handlePlaying)
      video.removeEventListener("canplay", handleCanPlay)
      video.removeEventListener("loadeddata", handleLoadedData)
      video.removeEventListener("seeking", handleSeeking)
      video.removeEventListener("seeked", handleSeeked)
    }
  }, [partyId, sendStatus, videoRef])

  // 750ms Drift Corrector Loop (micro rate-slider + hard-seek fallback; discrete
  // peer actions are already applied instantly via applyPartyState on SSE delivery)
  useEffect(() => {
    if (!partyId) return

    const interval = setInterval(() => {
      const video = videoRef.current
      const state = partyStateRef.current
      if (!video || !state || isSeekingOrScrubbingRef.current) return

      // Play / Pause Parity (always enforced)
      if (state.playing && video.paused) {
        video.play().catch(() => {})
      } else if (!state.playing && !video.paused) {
        video.pause()
      }

      // When the room is paused (incl. buffer-holds) the target is static and
      // members were already aligned on state application — no corrections here.
      if (!state.playing) {
        const roomRate = state.playbackRate || 1.0
        if (video.playbackRate !== roomRate) video.playbackRate = roomRate
        return
      }

      const serverNowEst = Date.now() + serverOffsetRef.current
      let targetPos = predictedPosition(state, serverNowEst)
      if (Number.isFinite(video.duration) && video.duration > 0) {
        targetPos = Math.min(targetPos, video.duration)
      }
      const currentPos = video.currentTime
      const drift = currentPos - targetPos
      const absDrift = Math.abs(drift)

      // Drift Correction Logic
      if (absDrift < DRIFT_THRESHOLDS.MICRO_LOWER) {
        // Under 0.15s -> Normal speed
        video.playbackRate = state.playbackRate || 1.0
      } else if (absDrift <= DRIFT_THRESHOLDS.MICRO_UPPER) {
        // 0.15s to 0.35s -> Micro rate adjustment (±3%)
        const roomRate = state.playbackRate || 1.0
        const adjust = drift < 0 ? 1 + DRIFT_THRESHOLDS.MICRO_ADJUST : 1 - DRIFT_THRESHOLDS.MICRO_ADJUST
        video.playbackRate = roomRate * adjust
      } else if (absDrift <= DRIFT_THRESHOLDS.MID_UPPER) {
        // 0.35s to 1.5s -> Medium rate adjustment (±8%)
        const roomRate = state.playbackRate || 1.0
        const adjust = drift < 0 ? 1 + DRIFT_THRESHOLDS.MID_ADJUST : 1 - DRIFT_THRESHOLDS.MID_ADJUST
        video.playbackRate = roomRate * adjust
      } else {
        // Over 1.5s -> Hard Seek (throttled: seeks can stall, re-stall, and
        // churn; never fire more than one per 2.5s per client)
        const nowMs = Date.now()
        if (nowMs - lastHardSeekAtRef.current < 2500) return
        lastHardSeekAtRef.current = nowMs
        video.playbackRate = state.playbackRate || 1.0
        lastSeekRef.current = { target: targetPos, at: nowMs }
        if (seekTo) {
          seekTo(targetPos)
        } else {
          video.currentTime = targetPos
        }
      }
    }, 750)

    return () => clearInterval(interval)
  }, [partyId, seekTo, videoRef])

  const bufferingUsers = members.filter((m) => m.buffering).map((m) => m.username)
  const isBuffering = bufferingUsers.length > 0

  return {
    sendCommand,
    partyState,
    members,
    isOwner,
    serverOffset,
    isBuffering,
    bufferingUsers,
  }
}
