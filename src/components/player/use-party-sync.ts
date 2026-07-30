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
  const isSeekingOrScrubbingRef = useRef<boolean>(false)
  const prevMembersRef = useRef<PartyMember[]>([])
  const userIdRef = useRef<string | null>(null)
  const isOwnerRef = useRef<boolean>(false)
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)
  const partyEndedRef = useRef<boolean>(false)

  // Keep refs synchronized
  useEffect(() => {
    partyStateRef.current = partyState
    serverOffsetRef.current = serverOffset
  }, [partyState, serverOffset])

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

      // Calculate smoothed server clock offset
      const rtt = receiveTime - startTime
      const estimatedServerNow = snapshot.serverNow + rtt / 2
      const offset = estimatedServerNow - receiveTime

      setServerOffset(offset)
      serverOffsetRef.current = offset
      setIsOwner(snapshot.isOwner)
      isOwnerRef.current = snapshot.isOwner
      setMembers(snapshot.members)
      prevMembersRef.current = snapshot.members

      if (snapshot.state && snapshot.state.version >= versionRef.current) {
        versionRef.current = snapshot.state.version
        setPartyState(snapshot.state)
      }

      return snapshot
    } catch (err) {
      console.error("[usePartySync] Failed to refresh snapshot:", err)
      return null
    }
  }, [partyId, onPartyEnded])

  // Initial snapshot load
  useEffect(() => {
    if (partyId) {
      refreshSnapshot()
    }
  }, [partyId, refreshSnapshot])

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
      refreshSnapshot()
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
          versionRef.current = payload.state.version
          setPartyState(payload.state)
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
  }, [partyId, clientId, onItemChange, onPartyEnded, refreshSnapshot, toast])

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
      // Debounce waiting for 2 seconds (ignore micro-stalls)
      bufferingTimerRef.current = setTimeout(() => {
        sendStatus(true, video.currentTime)
      }, 2000)
    }

    const handlePlaying = () => {
      if (bufferingTimerRef.current) {
        clearTimeout(bufferingTimerRef.current)
        bufferingTimerRef.current = null
      }
      sendStatus(false, video.currentTime)
    }

    const handleSeeking = () => {
      isSeekingOrScrubbingRef.current = true
    }

    const handleSeeked = () => {
      isSeekingOrScrubbingRef.current = false
    }

    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("playing", handlePlaying)
    video.addEventListener("seeking", handleSeeking)
    video.addEventListener("seeked", handleSeeked)

    return () => {
      if (bufferingTimerRef.current) clearTimeout(bufferingTimerRef.current)
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("playing", handlePlaying)
      video.removeEventListener("seeking", handleSeeking)
      video.removeEventListener("seeked", handleSeeked)
    }
  }, [partyId, sendStatus, videoRef])

  // 2s Drift Corrector Loop
  useEffect(() => {
    if (!partyId) return

    const interval = setInterval(() => {
      const video = videoRef.current
      const state = partyStateRef.current
      if (!video || !state || isSeekingOrScrubbingRef.current) return

      const serverNowEst = Date.now() + serverOffsetRef.current
      const targetPos = predictedPosition(state, serverNowEst)
      const currentPos = video.currentTime
      const drift = currentPos - targetPos
      const absDrift = Math.abs(drift)

      // Play / Pause Parity
      if (state.playing && video.paused) {
        video.play().catch(() => {})
      } else if (!state.playing && !video.paused) {
        video.pause()
      }

      // Drift Correction Logic
      if (absDrift < DRIFT_THRESHOLDS.MICRO_LOWER) {
        // Under 0.15s -> Normal speed
        video.playbackRate = state.playbackRate || 1.0
      } else if (absDrift <= DRIFT_THRESHOLDS.MICRO_UPPER) {
        // 0.15s to 0.75s -> Micro rate adjustment (±3%)
        const roomRate = state.playbackRate || 1.0
        const adjust = drift < 0 ? 1.03 : 0.97
        video.playbackRate = roomRate * adjust
      } else {
        // Over 0.75s -> Hard Seek
        video.playbackRate = state.playbackRate || 1.0
        if (seekTo) {
          seekTo(targetPos)
        } else {
          video.currentTime = targetPos
        }
      }
    }, 2000)

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
