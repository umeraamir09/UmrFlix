import type { StoreOperation } from "@/lib/db/store"
import { getPostgresStore } from "@/lib/db/store"
import type { PartyRoom } from "./room-manager"
import type { PartyMember, PartyState } from "./protocol"

type RoomRecord = { partyId: string; ownerId: string; createdAt: number; stateJson?: string; membersJson: string; pendingInvitesJson: string; updatedAt: number }
const upsertRoom = "party:upsertRoom" as StoreOperation<RoomRecord, string>
const deleteRoom = "party:deleteRoom" as StoreOperation<{ partyId: string }, boolean>
const listAllRooms = "party:listAllRooms" as StoreOperation<Record<string, never>, RoomRecord[]>

// Preserve snapshot/delete ordering within the single party-owning Node process.
// Concurrent fire-and-forget writes must not resurrect a deleted room.
const pendingWrites = new Map<string, Promise<void>>()

function enqueueRoomWrite(partyId: string, action: () => Promise<unknown>): Promise<void> {
  const previous = pendingWrites.get(partyId) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action).then(() => {})
  pendingWrites.set(partyId, next)
  void next.finally(() => {
    if (pendingWrites.get(partyId) === next) pendingWrites.delete(partyId)
  }).catch(() => {})
  return next
}

export async function persistRoomToPostgres(room: PartyRoom): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return

  try {
    const membersArray = Array.from(room.members.values())
    const pendingInvitesArray = Array.from(room.pendingInvites)

    const snapshot: RoomRecord = {
      partyId: room.id,
      ownerId: room.ownerId,
      createdAt: room.createdAt,
      stateJson: room.state ? JSON.stringify(room.state) : undefined,
      membersJson: JSON.stringify(membersArray),
      pendingInvitesJson: JSON.stringify(pendingInvitesArray),
      updatedAt: Date.now(),
    }
    await enqueueRoomWrite(room.id, () => postgres.write(upsertRoom, snapshot))
  } catch (err) {
    console.error("[PartyPostgresStore] Error persisting room:", err)
  }
}

export async function deleteRoomFromPostgres(partyId: string): Promise<void> {
  const postgres = getPostgresStore()
  if (!postgres) return

  try {
    await enqueueRoomWrite(partyId, () => postgres.write(deleteRoom, { partyId }))
  } catch (err) {
    console.error("[PartyPostgresStore] Error deleting room:", err)
  }
}

export async function loadAllRoomsFromPostgres(): Promise<PartyRoom[]> {
  const postgres = getPostgresStore()
  if (!postgres) return []

  try {
    const records = await postgres.read(listAllRooms, {})
    if (!Array.isArray(records)) return []

    const rooms: PartyRoom[] = []

    for (const rec of records) {
      try {
        const members: PartyMember[] = JSON.parse(rec.membersJson || "[]")
        const pendingInvites: string[] = JSON.parse(rec.pendingInvitesJson || "[]")
        const state: PartyState | null = rec.stateJson ? JSON.parse(rec.stateJson) : null
        if (state) {
          // Rebase the timeline: the persisted updatedAt predates the restart, so
          // predictedPosition would extrapolate a playhead far into the future.
          state.updatedAt = Date.now()
        }

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
          pausedForBuffering: false,
        })
      } catch (e) {
        console.error(`[PartyPostgresStore] Error parsing room ${rec.partyId}:`, e)
      }
    }

    return rooms
  } catch (err) {
    console.error("[PartyPostgresStore] Error loading rooms from Postgres:", err)
    return []
  }
}
