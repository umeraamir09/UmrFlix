import { eventBus } from "../event-bus"
import type { PartyCommand, PartyMember, PartyRoomSnapshot, PartyState } from "./protocol"
import {
  persistRoomToConvex,
  deleteRoomFromConvex,
  loadAllRoomsFromConvex,
} from "./party-convex-store"

export type PartyRoom = {
  id: string
  ownerId: string
  createdAt: number
  state: PartyState | null
  members: Map<string, PartyMember>
  pendingInvites: Set<string>
  lastSeenAt: Map<string, number>
  bufferingTimers: Map<string, NodeJS.Timeout>
}

export const ROOM_LIMITS = {
  MAX_ROOMS_PER_USER: 5,
  MAX_ROOM_CAPACITY: 50,
  MAX_TOTAL_ROOMS: 100,
  MAX_INVITES_PER_ROOM: 50,
}

class PartyRoomManager {
  private rooms = new Map<string, PartyRoom>()
  private isHydrated = false

  constructor() {
    // Background garbage collection every 5 minutes
    if (typeof window === "undefined") {
      setInterval(() => this.reapStaleRooms(), 5 * 60 * 1000)
      // Hydrate from Convex database on server startup
      void this.hydrateFromConvex()
    }
  }

  private async hydrateFromConvex() {
    if (this.isHydrated) return
    try {
      const storedRooms = await loadAllRoomsFromConvex()
      for (const room of storedRooms) {
        if (!this.rooms.has(room.id)) {
          this.rooms.set(room.id, room)
        }
      }
      this.isHydrated = true
    } catch (err) {
      console.error("[PartyRoomManager] Failed to hydrate from Convex:", err)
    }
  }

  private syncToConvex(room: PartyRoom) {
    void persistRoomToConvex(room)
  }

  private removeFromConvex(partyId: string) {
    void deleteRoomFromConvex(partyId)
  }

  private clearAllBufferingTimers(room: PartyRoom) {
    for (const timer of room.bufferingTimers.values()) {
      clearTimeout(timer)
    }
    room.bufferingTimers.clear()
  }

  private clearBufferingTimer(room: PartyRoom, userId: string) {
    const existing = room.bufferingTimers.get(userId)
    if (existing) {
      clearTimeout(existing)
      room.bufferingTimers.delete(userId)
    }
  }

  private reapStaleRooms() {
    const now = Date.now()
    const MAX_INACTIVE_MS = 30 * 60 * 1000 // 30 minutes

    for (const [roomId, room] of this.rooms.entries()) {
      let newestActivity = room.createdAt
      for (const timestamp of room.lastSeenAt.values()) {
        if (timestamp > newestActivity) newestActivity = timestamp
      }

      if (room.members.size === 0 || now - newestActivity > MAX_INACTIVE_MS) {
        this.clearAllBufferingTimers(room)
        this.rooms.delete(roomId)
        this.removeFromConvex(roomId)
        eventBus.emitEvent({
          type: "party:ended",
          payload: {
            partyId: roomId,
            audience: Array.from(room.members.keys()),
          },
        })
      }
    }
  }

  private generateId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `party_${crypto.randomUUID()}`
    }
    return `party_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  public createRoom(
    ownerId: string,
    ownerUsername: string,
    ownerAvatarUrl?: string,
    itemId: string | null = null
  ): PartyRoomSnapshot | null {
    // Capacity checks
    if (this.rooms.size >= ROOM_LIMITS.MAX_TOTAL_ROOMS) {
      console.warn("[PartyRoomManager] Create room rejected: MAX_TOTAL_ROOMS reached")
      return null
    }

    let userOwnedCount = 0
    for (const r of this.rooms.values()) {
      if (r.ownerId === ownerId) userOwnedCount++
    }
    if (userOwnedCount >= ROOM_LIMITS.MAX_ROOMS_PER_USER) {
      console.warn(`[PartyRoomManager] Create room rejected: user ${ownerId} hit MAX_ROOMS_PER_USER`)
      return null
    }

    const partyId = this.generateId()
    const now = Date.now()

    const ownerMember: PartyMember = {
      userId: ownerId,
      username: ownerUsername,
      avatarUrl: ownerAvatarUrl,
      joinedAt: now,
      buffering: false,
      lastSeenAt: now,
    }

    const initialState: PartyState | null = itemId
      ? {
          itemId,
          playing: true,
          positionSec: 0,
          updatedAt: now,
          playbackRate: 1.0,
          version: 1,
          reason: "item",
        }
      : null

    const room: PartyRoom = {
      id: partyId,
      ownerId,
      createdAt: now,
      state: initialState,
      members: new Map([[ownerId, ownerMember]]),
      pendingInvites: new Set(),
      lastSeenAt: new Map([[ownerId, now]]),
      bufferingTimers: new Map(),
    }

    this.rooms.set(partyId, room)
    this.syncToConvex(room)

    return this.getSnapshot(partyId, ownerId)!
  }

  public getRoom(partyId: string): PartyRoom | undefined {
    return this.rooms.get(partyId)
  }

  public touchPresence(partyId: string, userId: string): void {
    const room = this.rooms.get(partyId)
    if (!room) return
    const member = room.members.get(userId)
    if (member) {
      const now = Date.now()
      member.lastSeenAt = now
      room.lastSeenAt.set(userId, now)
    }
  }

  public getSnapshot(partyId: string, currentUserId: string): PartyRoomSnapshot | null {
    const room = this.rooms.get(partyId)
    if (!room) return null

    const membersArray = Array.from(room.members.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt
    )

    return {
      partyId: room.id,
      ownerId: room.ownerId,
      isOwner: room.ownerId === currentUserId,
      userId: currentUserId,
      createdAt: room.createdAt,
      state: room.state,
      members: membersArray,
      pendingInvites: Array.from(room.pendingInvites),
      serverNow: Date.now(),
    }
  }

  public joinRoom(
    partyId: string,
    userId: string,
    username: string,
    avatarUrl?: string
  ): PartyRoomSnapshot | null {
    const room = this.rooms.get(partyId)
    if (!room) return null

    if (room.members.size >= ROOM_LIMITS.MAX_ROOM_CAPACITY && !room.members.has(userId)) {
      console.warn(`[PartyRoomManager] Join room rejected: MAX_ROOM_CAPACITY reached for ${partyId}`)
      return null
    }

    const now = Date.now()
    const member: PartyMember = {
      userId,
      username,
      avatarUrl,
      joinedAt: room.members.get(userId)?.joinedAt ?? now,
      buffering: false,
      lastSeenAt: now,
    }

    room.members.set(userId, member)
    room.pendingInvites.delete(userId)
    room.lastSeenAt.set(userId, now)

    const audience = Array.from(room.members.keys())
    const membersArray = Array.from(room.members.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt
    )

    eventBus.emitEvent({
      type: "party:membership",
      payload: {
        partyId,
        action: "join",
        ownerId: room.ownerId,
        members: membersArray,
        audience,
      },
    })

    this.syncToConvex(room)
    return this.getSnapshot(partyId, userId)
  }

  public leaveRoom(partyId: string, userId: string): { roomEnded: boolean; newOwnerId?: string } {
    const room = this.rooms.get(partyId)
    if (!room) return { roomEnded: false }

    this.clearBufferingTimer(room, userId)
    room.members.delete(userId)
    room.lastSeenAt.delete(userId)

    if (room.members.size === 0) {
      this.clearAllBufferingTimers(room)
      this.rooms.delete(partyId)
      this.removeFromConvex(partyId)
      return { roomEnded: true }
    }

    let newOwnerId: string | undefined = undefined
    if (room.ownerId === userId) {
      // Transfer ownership to oldest member
      const remainingMembers = Array.from(room.members.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      )
      newOwnerId = remainingMembers[0].userId
      room.ownerId = newOwnerId
    }

    const audience = Array.from(room.members.keys())
    const membersArray = Array.from(room.members.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt
    )

    eventBus.emitEvent({
      type: "party:membership",
      payload: {
        partyId,
        action: newOwnerId ? "owner-changed" : "leave",
        ownerId: room.ownerId,
        members: membersArray,
        audience,
      },
    })

    this.syncToConvex(room)
    return { roomEnded: false, newOwnerId }
  }

  public inviteUsers(
    partyId: string,
    inviterId: string,
    inviterName: string,
    userIds: string[]
  ): boolean {
    const room = this.rooms.get(partyId)
    if (!room) return false

    if (room.pendingInvites.size >= ROOM_LIMITS.MAX_INVITES_PER_ROOM) {
      console.warn(`[PartyRoomManager] Invite users rejected: MAX_INVITES_PER_ROOM reached for ${partyId}`)
      return false
    }

    for (const id of userIds) {
      if (!room.members.has(id)) {
        room.pendingInvites.add(id)
      }
    }

    const audience = Array.from(new Set([...userIds, ...room.members.keys()]))

    eventBus.emitEvent({
      type: "party:invited",
      payload: {
        partyId,
        inviterId,
        inviterName,
        audience,
      },
    })

    this.syncToConvex(room)
    return true
  }

  public endRoom(partyId: string, ownerId: string): boolean {
    const room = this.rooms.get(partyId)
    if (!room || room.ownerId !== ownerId) return false

    const audience = Array.from(room.members.keys())
    this.clearAllBufferingTimers(room)
    this.rooms.delete(partyId)
    this.removeFromConvex(partyId)

    // party:ended is the single canonical event for room destruction
    eventBus.emitEvent({
      type: "party:ended",
      payload: {
        partyId,
        audience,
      },
    })

    return true
  }

  public applyCommand(partyId: string, userId: string, cmd: PartyCommand): PartyState | null {
    const room = this.rooms.get(partyId)
    if (!room || !room.members.has(userId)) return null

    // Only owner can change playback rate
    if (cmd.type === "rate" && room.ownerId !== userId) {
      return room.state
    }

    // Check if anyone is buffering before allowing manual play command
    if (cmd.type === "play") {
      const bufferingMember = Array.from(room.members.values()).find((m) => m.buffering)
      if (bufferingMember) {
        // Reject play command while a member is buffering
        return room.state
      }
    }

    const now = Date.now()
    const currentPos = room.state
      ? room.state.playing
        ? room.state.positionSec + ((now - room.state.updatedAt) / 1000) * room.state.playbackRate
        : room.state.positionSec
      : 0

    const newPos = cmd.positionSec ?? currentPos
    const newRate = cmd.playbackRate ?? room.state?.playbackRate ?? 1.0
    const isPlaying = cmd.type === "play" ? true : cmd.type === "pause" ? false : room.state?.playing ?? true

    const newState: PartyState = {
      itemId: room.state?.itemId ?? null,
      playing: isPlaying,
      positionSec: newPos,
      updatedAt: now,
      playbackRate: newRate,
      version: (room.state?.version ?? 0) + 1,
      senderClientId: cmd.clientId,
      reason: "command",
    }

    room.state = newState

    const audience = Array.from(room.members.keys())
    eventBus.emitEvent({
      type: "party:state",
      payload: {
        partyId,
        state: newState,
        audience,
      },
    })

    this.syncToConvex(room)
    return newState
  }

  public applyItem(partyId: string, ownerId: string, itemId: string): PartyState | null {
    const room = this.rooms.get(partyId)
    if (!room || room.ownerId !== ownerId) return null

    const now = Date.now()
    const newState: PartyState = {
      itemId,
      playing: true,
      positionSec: 0,
      updatedAt: now,
      playbackRate: 1.0,
      version: (room.state?.version ?? 0) + 1,
      reason: "item",
    }

    room.state = newState

    const audience = Array.from(room.members.keys())

    eventBus.emitEvent({
      type: "party:item",
      payload: {
        partyId,
        itemId,
        state: newState,
        audience,
      },
    })

    eventBus.emitEvent({
      type: "party:state",
      payload: {
        partyId,
        state: newState,
        audience,
      },
    })

    this.syncToConvex(room)
    return newState
  }

  public setBuffering(
    partyId: string,
    userId: string,
    buffering: boolean,
    positionSec?: number
  ): PartyState | null {
    const room = this.rooms.get(partyId)
    if (!room || !room.members.has(userId)) return null

    const member = room.members.get(userId)!
    member.buffering = buffering
    member.lastSeenAt = Date.now()
    room.lastSeenAt.set(userId, member.lastSeenAt)

    // Manage buffering eviction timer cleanly
    this.clearBufferingTimer(room, userId)
    if (buffering) {
      this.evictStuckBuffering(partyId, userId)
    }

    if (!room.state) return null

    const now = Date.now()
    const isAnyBuffering = Array.from(room.members.values()).some((m) => m.buffering)

    let newState: PartyState | null = null

    if (isAnyBuffering && room.state.playing) {
      const currentPos = positionSec ?? (
        room.state.playing
          ? room.state.positionSec + ((now - room.state.updatedAt) / 1000) * room.state.playbackRate
          : room.state.positionSec
      )

      newState = {
        ...room.state,
        playing: false,
        positionSec: currentPos,
        updatedAt: now,
        version: room.state.version + 1,
        reason: "buffer-pause",
      }
    } else if (!isAnyBuffering && !room.state.playing && room.state.reason === "buffer-pause") {
      // Resume everyone when buffering clears
      newState = {
        ...room.state,
        playing: true,
        updatedAt: now,
        version: room.state.version + 1,
        reason: "buffer-resume",
      }
    }

    if (newState) {
      room.state = newState
      const audience = Array.from(room.members.keys())
      eventBus.emitEvent({
        type: "party:state",
        payload: {
          partyId,
          state: newState,
          audience,
        },
      })
    }

    this.syncToConvex(room)
    return room.state
  }

  private evictStuckBuffering(partyId: string, userId: string) {
    const room = this.rooms.get(partyId)
    if (!room) return

    const timer = setTimeout(() => {
      const stillRoom = this.rooms.get(partyId)
      if (!stillRoom) return
      stillRoom.bufferingTimers.delete(userId)
      const stillMember = stillRoom.members.get(userId)
      if (!stillMember || !stillMember.buffering) return

      // Remove the stuck member
      stillRoom.members.delete(userId)
      stillRoom.lastSeenAt.delete(userId)

      const audience = Array.from(stillRoom.members.keys())
      const membersArray = Array.from(stillRoom.members.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      )

      // Transfer ownership if needed
      if (stillRoom.ownerId === userId && stillRoom.members.size > 0) {
        stillRoom.ownerId = membersArray[0].userId
        eventBus.emitEvent({
          type: "party:membership",
          payload: {
            partyId,
            action: "owner-changed",
            ownerId: stillRoom.ownerId,
            members: membersArray,
            audience,
          },
        })
      } else if (stillRoom.members.size === 0) {
        this.clearAllBufferingTimers(stillRoom)
        this.rooms.delete(partyId)
        this.removeFromConvex(partyId)
        eventBus.emitEvent({
          type: "party:ended",
          payload: { partyId, audience: [userId] },
        })
        return
      }

      // Emit membership update so clients see the member removed
      eventBus.emitEvent({
        type: "party:membership",
        payload: {
          partyId,
          action: "leave",
          ownerId: stillRoom.ownerId,
          members: membersArray,
          audience,
        },
      })

      // Emit updated state in case this unblocks a buffer-pause
      if (stillRoom.state && stillRoom.state.reason === "buffer-pause") {
        const isAnyStillBuffering = membersArray.some((m) => m.buffering)
        if (!isAnyStillBuffering) {
          stillRoom.state = {
            ...stillRoom.state,
            playing: true,
            updatedAt: Date.now(),
            version: stillRoom.state.version + 1,
            reason: "buffer-resume",
          }
          eventBus.emitEvent({
            type: "party:state",
            payload: {
              partyId,
              state: stillRoom.state,
              audience,
            },
          })
        }
      }

      this.syncToConvex(stillRoom)
    }, 30_000)

    room.bufferingTimers.set(userId, timer)
  }

  public getUserParties(userId: string): {
    active: PartyRoomSnapshot[]
    invites: PartyRoomSnapshot[]
  } {
    const active: PartyRoomSnapshot[] = []
    const invites: PartyRoomSnapshot[] = []

    for (const room of this.rooms.values()) {
      if (room.members.has(userId)) {
        const snap = this.getSnapshot(room.id, userId)
        if (snap) active.push(snap)
      } else if (room.pendingInvites.has(userId)) {
        const snap = this.getSnapshot(room.id, userId)
        if (snap) invites.push(snap)
      }
    }

    return { active, invites }
  }
}

const globalForPartyRoomManager = globalThis as unknown as {
  partyRoomManager: PartyRoomManager | undefined
}

export const roomManager =
  globalForPartyRoomManager.partyRoomManager ??
  (globalForPartyRoomManager.partyRoomManager = new PartyRoomManager())
