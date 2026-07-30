import { ConvexHttpClient } from "convex/browser"
import { api } from "../../../convex/_generated/api"
import type { PartyRoom } from "./room-manager"
import type { PartyMember, PartyState } from "./protocol"

function getConvexClient(): ConvexHttpClient | null {
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY

  if (!url) return null

  try {
    const client = new ConvexHttpClient(url, {
      skipConvexDeploymentUrlCheck: true,
    })
    if (adminKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawClient = client as any
      if (typeof rawClient.setAdminAuth === "function") {
        rawClient.setAdminAuth(adminKey)
      } else {
        client.setAuth(adminKey)
      }
    }
    return client
  } catch (err) {
    console.warn("[Convex] Failed to instantiate ConvexHttpClient:", err)
    return null
  }
}

export async function persistRoomToConvex(room: PartyRoom): Promise<void> {
  const convex = getConvexClient()
  if (!convex) return

  try {
    const membersArray = Array.from(room.members.values())
    const pendingInvitesArray = Array.from(room.pendingInvites)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partyApi = (api as any).party

    await convex.mutation(partyApi.upsertRoom, {
      partyId: room.id,
      ownerId: room.ownerId,
      createdAt: room.createdAt,
      stateJson: room.state ? JSON.stringify(room.state) : undefined,
      membersJson: JSON.stringify(membersArray),
      pendingInvitesJson: JSON.stringify(pendingInvitesArray),
      updatedAt: Date.now(),
    })
  } catch (err) {
    console.error("[PartyConvexStore] Error persisting room:", err)
  }
}

export async function deleteRoomFromConvex(partyId: string): Promise<void> {
  const convex = getConvexClient()
  if (!convex) return

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partyApi = (api as any).party
    await convex.mutation(partyApi.deleteRoom, { partyId })
  } catch (err) {
    console.error("[PartyConvexStore] Error deleting room:", err)
  }
}

export async function loadAllRoomsFromConvex(): Promise<PartyRoom[]> {
  const convex = getConvexClient()
  if (!convex) return []

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const partyApi = (api as any).party
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records: any[] = await convex.query(partyApi.listAllRooms, {})
    if (!Array.isArray(records)) return []

    const rooms: PartyRoom[] = []

    for (const rec of records) {
      try {
        const members: PartyMember[] = JSON.parse(rec.membersJson || "[]")
        const pendingInvites: string[] = JSON.parse(rec.pendingInvitesJson || "[]")
        const state: PartyState | null = rec.stateJson ? JSON.parse(rec.stateJson) : null

        const membersMap = new Map<string, PartyMember>()
        const lastSeenAtMap = new Map<string, number>()

        for (const m of members) {
          membersMap.set(m.userId, m)
          lastSeenAtMap.set(m.userId, m.lastSeenAt || rec.createdAt)
        }

        rooms.push({
          id: rec.partyId,
          ownerId: rec.ownerId,
          createdAt: rec.createdAt,
          state,
          members: membersMap,
          pendingInvites: new Set(pendingInvites),
          lastSeenAt: lastSeenAtMap,
          bufferingTimers: new Map(),
        })
      } catch (e) {
        console.error(`[PartyConvexStore] Error parsing room ${rec.partyId}:`, e)
      }
    }

    return rooms
  } catch (err) {
    console.error("[PartyConvexStore] Error loading rooms from Convex:", err)
    return []
  }
}
