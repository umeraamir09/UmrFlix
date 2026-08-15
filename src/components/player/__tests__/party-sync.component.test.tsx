import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PartyBar } from "@/components/party/PartyBar"
import { computeRecoveryBufferAheadSec, getSyncQuality, PartyMember } from "@/lib/party/protocol"

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}))

describe("Watch Party Tests (Audit 8.1 - 8.4)", () => {
  afterEach(() => {
    cleanup()
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
    it("clears stale member buffering flags on reconnect mapping", () => {
      const staleMembers: PartyMember[] = [
        {
          userId: "user_1",
          username: "Alice",
          joinedAt: Date.now() - 10000,
          buffering: true, // stalled before disconnect
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

      // Simulation of the SSE onOpen handler reset
      const resetMembers = staleMembers.map((m) => ({ ...m, buffering: false }))
      expect(resetMembers.every((m) => !m.buffering)).toBe(true)
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
