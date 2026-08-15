"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "@/components/Toast"
import { acquireSharedEventSource } from "@/lib/use-event-stream"
import {
  computeRecoveryBufferAheadSec,
  DRIFT_THRESHOLDS,
  getSyncQuality,
  PARTY_BUFFERING,
  PartyCommand,
  PartyCommandType,
  PartyMember,
  PartyRoomSnapshot,
  PartyState,
  predictedPosition,
  SyncQuality,
} from "@/lib/party/protocol"

export type UsePartySyncOptions = {
  partyId?: string
  clientId: string
  videoRef: React.RefObject<HTMLVideoElement | null>
  seekTo?: (timeSec: number) => void
  togglePlay?: () => void
  onItemChange?: (itemId: string) => void
  onPartyEnded?: () => void
  segmentDurationSec?: number | (() => number)
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
  syncQuality: SyncQuality
  syncDriftMs: number
}

export function usePartySync({
  partyId,
  clientId,
  videoRef,
  seekTo,
  onItemChange,
  onPartyEnded,
  segmentDurationSec,
}: UsePartySyncOptions): UsePartySyncReturn {
  const { toast } = useToast()
  const [partyState, setPartyState] = useState<PartyState | null>(null)
  const [members, setMembers] = useState<PartyMember[]>([])
  const [isOwner, setIsOwner] = useState<boolean>(false)
  const [serverOffset, setServerOffset] = useState<number>(0) // serverTime - localTime
  const [syncQuality, setSyncQuality] = useState<SyncQuality>("paused")
  const [syncDriftMs, setSyncDriftMs] = useState<number>(0)

  const versionRef = useRef<number>(0)
  const partyStateRef = useRef<PartyState | null>(null)
  const serverOffsetRef = useRef<number>(0)
  const bufferingTimerRef = useRef<NodeJS.Timeout | null>(null)
  const bufferingReportedRef = useRef<boolean>(false)
  const scrubUntilRef = useRef<number>(0)
  const recoveryCheckRef = useRef<{
    timer: NodeJS.Timeout | null
    startedAt: number
  } | null>(null)
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

      // Play / Pause parity — always enforced, even mid-scrub: a buffer-hold
      // must never be skipped because the user is dragging the seek bar.
      if (state.playing && video.paused) {
        video.play().catch(() => {})
      } else if (!state.playing && !video.paused) {
        video.pause()
      }

      // Don't reposition while the user is actively scrubbing or right after
      // a seek that hasn't settled (seeking into an unbuffered region can
      // delay `seeked` by seconds — the window is time-bound, not event-bound).
      if (Date.now() < scrubUntilRef.current) return

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
        // Server-space capture time so the server can advance the position by
        // the transport delay — otherwise every command leaves the group
        // targeting a playhead one RTT behind the issuer.
        sentAt: Date.now() + serverOffsetRef.current,
      }

      const revertLocal = () => {
        const v = videoRef.current
        if (!v) return
        if (type === "play" && !v.paused) v.pause()
        if (type === "pause" && v.paused) v.play().catch(() => {})
        if (type === "rate") {
          const roomRate = partyStateRef.current?.playbackRate ?? 1.0
          v.playbackRate = roomRate
        }
      }

      try {
        // keepalive: lets the final command survive page unload (e.g. the
        // pending-seek flush fired from CinemaPlayer's unmount cleanup).
        const res = await fetch(`/api/party/${partyId}/command`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        })
        if (res.ok) {
          const data = await res.json()
          if (data.state && data.state.version > versionRef.current) {
            versionRef.current = data.state.version
            setPartyState(data.state)
          }
          // Rejected by room rules (play refused during a buffer-hold, rate
          // refused for non-owners): the server echoes the current state, so
          // revert the optimistic local change and let the UI tell the truth.
          if (data.state) {
            const s = data.state as PartyState
            const v = videoRef.current
            if (type === "play" && s.playing === false && v && !v.paused) v.pause()
            if (type === "rate" && s.playbackRate && v && v.playbackRate !== s.playbackRate) {
              v.playbackRate = s.playbackRate
            }
          }
        } else {
          // 429 / 403 / 5xx — the command didn't land: undo the local action
          revertLocal()
        }
      } catch (err) {
        console.error("[usePartySync] Send command failed:", err)
        revertLocal()
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
      // 8.3 — SSE (re)connected: clear stale buffering flags in local member state
      // so disconnects don't keep the client UI or room locked in a stale buffer-hold
      setMembers((prev) => prev.map((m) => ({ ...m, buffering: false })))
      bufferingReportedRef.current = false
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

    const abortRecovery = () => {
      if (recoveryCheckRef.current) {
        if (recoveryCheckRef.current.timer) clearTimeout(recoveryCheckRef.current.timer)
        recoveryCheckRef.current = null
      }
    }

    const finishRecovery = () => {
      abortRecovery()
      if (bufferingReportedRef.current) {
        bufferingReportedRef.current = false
        const v = videoRef.current
        sendStatus(false, v ? v.currentTime : 0)
      }
    }

    const handleWaiting = () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      abortRecovery()
      // Debounce short stalls; defer stalls that begin inside the scrub window
      // until it expires, so a seek that lands in unbuffered territory is still
      // reported once the window passes instead of being dropped forever.
      const reportStall = () => {
        const waitMs = scrubUntilRef.current - Date.now()
        if (waitMs > 0) {
          bufferingTimerRef.current = setTimeout(reportStall, waitMs + PARTY_BUFFERING.STALL_DEBOUNCE_MS)
          return
        }
        const v = videoRef.current
        // The stall already cleared within the debounce window (the video has
        // future data again) — reporting it would pause the room for nothing.
        if (v && v.readyState >= 3) return
        if (!bufferingReportedRef.current) {
          bufferingReportedRef.current = true
          sendStatus(true, v ? v.currentTime : 0)
        }
      }
      bufferingTimerRef.current = setTimeout(reportStall, PARTY_BUFFERING.STALL_DEBOUNCE_MS)
    }

    // Recovery is NOT reported on the first canplay/loadeddata: while the room
    // pause holds, the stalled member's video keeps loading and `canplay` can
    // fire with only a thin buffer ahead — that premature "recovered" is what
    // let the room resume before the buffer was actually complete. Require the
    // video to be genuinely playing, or a sustained (grace window, no re-stall)
    // state with enough buffered ahead.
    const armRecoveryCheck = () => {
      if (!bufferingReportedRef.current) return
      if (recoveryCheckRef.current) return
      const startedAt = Date.now()
      recoveryCheckRef.current = { timer: null, startedAt }
      const check = () => {
        if (!recoveryCheckRef.current) return
        const v = videoRef.current
        if (!v) {
          recoveryCheckRef.current = null
          return
        }
        const bufferAhead = v.buffered.length
          ? v.buffered.end(v.buffered.length - 1) - v.currentTime
          : 0
        const segDuration =
          typeof segmentDurationSec === "function"
            ? segmentDurationSec()
            : segmentDurationSec
        const requiredBufferSec = computeRecoveryBufferAheadSec(segDuration)
        const playable =
          !v.paused ||
          (Date.now() - startedAt >= PARTY_BUFFERING.RECOVERY_GRACE_MS &&
            bufferAhead >= requiredBufferSec)
        if (playable) {
          finishRecovery()
          return
        }
        recoveryCheckRef.current.timer = setTimeout(check, PARTY_BUFFERING.RECOVERY_POLL_MS)
      }
      recoveryCheckRef.current.timer = setTimeout(check, PARTY_BUFFERING.RECOVERY_POLL_MS)
    }

    // Recovery signals — arm the recovery gate on whichever fires first
    const reportRecovered = () => {
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current)
        bufferingTimerRef.current = null
      }
      if (bufferingReportedRef.current) {
        armRecoveryCheck()
      }
    }

    const handlePlaying = reportRecovered
    const handleCanPlay = reportRecovered
    const handleLoadedData = reportRecovered

    // Time-bound scrub/seek window: `seeking` fires on every scrub AND on
    // party-forced repositions, and `seeked` can be delayed for seconds when
    // the target region isn't buffered. An event-only flag could stay set
    // forever, silently decoupling the member from the room. The window
    // expires on its own even if `seeked` never arrives.
    const handleSeeking = () => {
      scrubUntilRef.current = Date.now() + PARTY_BUFFERING.SCRUB_IGNORE_MS
    }

    const handleSeeked = () => {
      scrubUntilRef.current = 0
    }

    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("playing", handlePlaying)
    video.addEventListener("canplay", handleCanPlay)
    video.addEventListener("loadeddata", handleLoadedData)
    video.addEventListener("seeking", handleSeeking)
    video.addEventListener("seeked", handleSeeked)

    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      abortRecovery()
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("playing", handlePlaying)
      video.removeEventListener("canplay", handleCanPlay)
      video.removeEventListener("loadeddata", handleLoadedData)
      video.removeEventListener("seeking", handleSeeking)
      video.removeEventListener("seeked", handleSeeked)
    }
  }, [partyId, sendStatus, videoRef])

  // 500ms Drift Corrector Loop (micro rate-slider + hard-seek fallback; discrete
  // peer actions are already applied instantly via applyPartyState on SSE delivery)
  useEffect(() => {
    if (!partyId) return

    const interval = setInterval(() => {
      const video = videoRef.current
      const state = partyStateRef.current
      if (!video || !state) return

      // Play / Pause Parity (always enforced — even mid-scrub, so a
      // buffer-hold can never be skipped while the user drags the seek bar)
      if (state.playing && video.paused) {
        video.play().catch(() => {})
      } else if (!state.playing && !video.paused) {
        video.pause()
      }

      const bufferingUsersList = members.filter((m) => m.buffering).map((m) => m.username)
      const isBufferingNow = bufferingUsersList.length > 0

      // When the room is paused (incl. buffer-holds) the target is static and
      // members were already aligned on state application — no corrections here.
      if (!state.playing) {
        const roomRate = state.playbackRate || 1.0
        if (video.playbackRate !== roomRate) video.playbackRate = roomRate
        setSyncQuality(getSyncQuality(0, isBufferingNow, false))
        setSyncDriftMs(0)
        return
      }

      // Skip position corrections only while the user is actively scrubbing
      // (time-bound, so a slow seek can't wedge the loop permanently)
      if (Date.now() < scrubUntilRef.current) return

      const serverNowEst = Date.now() + serverOffsetRef.current
      let targetPos = predictedPosition(state, serverNowEst)
      if (Number.isFinite(video.duration) && video.duration > 0) {
        targetPos = Math.min(targetPos, video.duration)
      }
      const currentPos = video.currentTime
      const drift = currentPos - targetPos
      const absDrift = Math.abs(drift)

      // 8.4 — Update live drift metrics and sync quality status
      setSyncQuality(getSyncQuality(drift, isBufferingNow, !video.paused))
      setSyncDriftMs(Math.round(drift * 1000))

      // Drift Correction Logic
      if (absDrift < DRIFT_THRESHOLDS.MICRO_LOWER) {
        // Under 0.12s -> Normal speed
        video.playbackRate = state.playbackRate || 1.0
      } else if (absDrift <= DRIFT_THRESHOLDS.MICRO_UPPER) {
        // 0.12s to 0.3s -> Micro rate adjustment (±5%)
        const roomRate = state.playbackRate || 1.0
        const adjust = drift < 0 ? 1 + DRIFT_THRESHOLDS.MICRO_ADJUST : 1 - DRIFT_THRESHOLDS.MICRO_ADJUST
        video.playbackRate = roomRate * adjust
      } else if (absDrift <= DRIFT_THRESHOLDS.MID_UPPER) {
        // 0.3s to 1.0s -> Medium rate adjustment (±12%)
        const roomRate = state.playbackRate || 1.0
        const adjust = drift < 0 ? 1 + DRIFT_THRESHOLDS.MID_ADJUST : 1 - DRIFT_THRESHOLDS.MID_ADJUST
        video.playbackRate = roomRate * adjust
      } else {
        // Over 1.0s -> Hard Seek (throttled: seeks can stall, re-stall, and
        // churn; never fire more than one per 1.5s per client)
        const nowMs = Date.now()
        if (nowMs - lastHardSeekAtRef.current < 1500) return
        lastHardSeekAtRef.current = nowMs
        video.playbackRate = state.playbackRate || 1.0
        lastSeekRef.current = { target: targetPos, at: nowMs }
        if (seekTo) {
          seekTo(targetPos)
        } else {
          video.currentTime = targetPos
        }
      }
    }, 500)

    return () => clearInterval(interval)
  }, [partyId, seekTo, videoRef, members])

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
    syncQuality,
    syncDriftMs,
  }
}
