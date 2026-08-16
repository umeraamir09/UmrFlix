import { act, cleanup, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PartyBar } from "@/components/party/PartyBar"
import { usePartySync } from "@/components/player/use-party-sync"
import {
  computeRecoveryBufferAheadSec,
  getSyncQuality,
  PartyMember,
  PartyRoomSnapshot,
  PartyState,
} from "@/lib/party/protocol"

const partySyncMocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: { data: string }) => void>>()
  const openHandlers = new Set<() => void>()
  const eventSource = {
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      const handlers = listeners.get(type) ?? new Set()
      handlers.add(listener)
      listeners.set(type, handlers)
    },
    removeEventListener(type: string, listener: (event: { data: string }) => void) {
      listeners.get(type)?.delete(listener)
    },
  }

  return {
    acquireSharedEventSource(onOpen?: () => void) {
      if (onOpen) openHandlers.add(onOpen)
      return { es: eventSource, release: () => onOpen && openHandlers.delete(onOpen) }
    },
    dispatch(type: string, payload: unknown) {
      listeners.get(type)?.forEach((listener) => listener({ data: JSON.stringify(payload) }))
    },
    reconnect() {
      openHandlers.forEach((onOpen) => onOpen())
    },
    reset() {
      listeners.clear()
      openHandlers.clear()
    },
  }
})

vi.mock("@/lib/use-event-stream", () => ({
  acquireSharedEventSource: partySyncMocks.acquireSharedEventSource,
}))

vi.mock("@/components/Toast", () => ({
  useToast: () => ({ toast: () => undefined }),
}))

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe("Watch Party Tests (Audit 8.1 - 8.4)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    partySyncMocks.reset()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const sampleMembers: PartyMember[] = [
    {
      userId: "user_1",
      username: "Alice",
      joinedAt: Date.now() - 10000,
      buffering: false,
      lastSeenAt: Date.now(),
    },
    {
      userId: "user_2",
      username: "Bob",
      joinedAt: Date.now() - 5000,
      buffering: false,
      lastSeenAt: Date.now(),
    },
  ]

  describe("8.2 — Adaptive buffer-ahead threshold for mobile & varying segment durations", () => {
    it("dynamically computes buffer-ahead duration for varying segment sizes", () => {
      // 1.5s segment duration (mobile / low latency) -> 3s (clamped to min bound)
      expect(computeRecoveryBufferAheadSec(1.5)).toBe(3)

      // 3.0s segment duration -> 6s
      expect(computeRecoveryBufferAheadSec(3.0)).toBe(6)

      // 5.0s segment duration -> 8s (clamped to max bound)
      expect(computeRecoveryBufferAheadSec(5.0)).toBe(8)

      // invalid / fallback
      expect(computeRecoveryBufferAheadSec(undefined)).toBe(8)
    })
  })

  describe("8.3 — Clearing stale buffering flags across SSE reconnection", () => {
    it("keeps a reported buffering member attached until recovery is confirmed", async () => {
      const video = document.createElement("video")
      Object.defineProperty(video, "readyState", { configurable: true, value: 0 })
      Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 12 })
      Object.defineProperty(video, "paused", { configurable: true, get: () => true })

      let bufferAhead = 0
      Object.defineProperty(video, "buffered", {
        configurable: true,
        get: () => ({
          length: bufferAhead > 0 ? 1 : 0,
          end: () => video.currentTime + bufferAhead,
        }),
      })

      let reconnecting = false
      let nextVersion = 1
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/status")) {
          const body = JSON.parse(String(init?.body)) as { buffering: boolean }
          nextVersion += 1
          const state: PartyState = {
            itemId: "item-1",
            playing: !body.buffering,
            positionSec: 12,
            updatedAt: Date.now(),
            playbackRate: 1,
            version: nextVersion,
            reason: body.buffering ? "buffer-pause" : "buffer-resume",
          }
          return { ok: true, status: 200, json: async () => ({ state }) } as Response
        }

        const snapshot: PartyRoomSnapshot = {
          partyId: "party-1",
          ownerId: "user-1",
          isOwner: true,
          userId: "user-1",
          createdAt: Date.now(),
          state: {
            itemId: "item-1",
            playing: reconnecting ? false : true,
            positionSec: 12,
            updatedAt: Date.now(),
            playbackRate: 1,
            version: reconnecting ? nextVersion : 1,
            reason: reconnecting ? "buffer-pause" : "item",
          },
          members: [
            {
              userId: "user-1",
              username: "Alice",
              joinedAt: Date.now(),
              buffering: reconnecting,
              lastSeenAt: Date.now(),
            },
          ],
          pendingInvites: [],
          serverNow: Date.now(),
        }
        return { ok: true, status: 200, json: async () => snapshot } as Response
      })
      vi.stubGlobal("fetch", fetchMock)

      const { result } = renderHook(() =>
        usePartySync({
          partyId: "party-1",
          clientId: "client-1",
          videoRef: { current: video },
        })
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      video.dispatchEvent(new Event("waiting"))
      await act(async () => {
        vi.advanceTimersByTime(400)
        await Promise.resolve()
      })
      expect(result.current.isBuffering).toBe(true)

      reconnecting = true
      await act(async () => {
        partySyncMocks.reconnect()
        await Promise.resolve()
        await Promise.resolve()
      })

      bufferAhead = 8
      video.dispatchEvent(new Event("canplay"))
      await act(async () => {
        vi.advanceTimersByTime(2000)
        await Promise.resolve()
      })

      const statusBodies = fetchMock.mock.calls
        .filter(([input]) => String(input).endsWith("/status"))
        .map(([, init]) => JSON.parse(String(init?.body)) as { buffering: boolean })
      expect(statusBodies.some((body) => body.buffering === false)).toBe(true)
    })

  })

  describe("8.4 — Immediate buffering quality updates", () => {
    it("reports buffering immediately from a local status update", async () => {
      const video = document.createElement("video")
      Object.defineProperty(video, "readyState", { configurable: true, value: 0 })
      Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 4 })
      Object.defineProperty(video, "paused", { configurable: true, get: () => true })
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            partyId: "party-1",
            ownerId: "user-1",
            isOwner: true,
            userId: "user-1",
            createdAt: Date.now(),
            state: {
              itemId: "item-1",
              playing: false,
              positionSec: 4,
              updatedAt: Date.now(),
              playbackRate: 1,
              version: 2,
              reason: "buffer-pause",
            },
            members: [
              {
                userId: "user-1",
                username: "Alice",
                joinedAt: Date.now(),
                buffering: false,
                lastSeenAt: Date.now(),
              },
            ],
            pendingInvites: [],
            serverNow: Date.now(),
          }),
        }))
      )

      const { result } = renderHook(() =>
        usePartySync({
          partyId: "party-1",
          clientId: "client-1",
          videoRef: { current: video },
        })
      )

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      video.dispatchEvent(new Event("waiting"))
      await act(async () => {
        vi.advanceTimersByTime(400)
        await Promise.resolve()
      })

      expect(result.current.syncQuality).toBe("buffering")
      expect(result.current.isBuffering).toBe(true)
    })
  })

  describe("8.4 — Sync Quality Indicator in PartyBar", () => {
    it("renders Synced indicator when party is in sync", () => {
      render(
        <PartyBar
          partyId="party_123"
          isOwner={true}
          members={sampleMembers}
          syncQuality="synced"
          syncDriftMs={45}
        />
      )

      expect(screen.getByText("Synced")).toBeDefined()
      expect(screen.getByTitle(/Party Sync Quality: Synced/i)).toBeDefined()
    })

    it("renders Syncing with drift indicator during micro corrections", () => {
      render(
        <PartyBar
          partyId="party_123"
          isOwner={false}
          members={sampleMembers}
          syncQuality="syncing"
          syncDriftMs={240}
        />
      )

      expect(screen.getByText(/Syncing \(240ms\)/i)).toBeDefined()
    })

    it("renders Buffering indicator when a member is buffering", () => {
      const bufferingMembers: PartyMember[] = [
        { ...sampleMembers[0], buffering: true },
        sampleMembers[1],
      ]

      render(
        <PartyBar
          partyId="party_123"
          isOwner={false}
          members={bufferingMembers}
          bufferingUsers={["Alice"]}
          syncQuality="buffering"
          syncDriftMs={0}
        />
      )

      expect(screen.getByText("Buffering")).toBeDefined()
      expect(screen.getByText("Waiting for Alice…")).toBeDefined()
    })

    it("renders Paused indicator when room is paused", () => {
      render(
        <PartyBar
          partyId="party_123"
          isOwner={false}
          members={sampleMembers}
          syncQuality="paused"
          syncDriftMs={0}
        />
      )

      expect(screen.getByText("Paused")).toBeDefined()
    })

    it("computes sync quality correctly according to drift math", () => {
      expect(getSyncQuality(0.04, false, true)).toBe("synced")
      expect(getSyncQuality(0.45, false, true)).toBe("syncing")
      expect(getSyncQuality(1.8, false, true)).toBe("resyncing")
      expect(getSyncQuality(0.0, true, true)).toBe("buffering")
      expect(getSyncQuality(0.0, false, false)).toBe("paused")
    })
  })
})
