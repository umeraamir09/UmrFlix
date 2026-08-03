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
  pausedForBuffering: boolean
  forceClearedAt: Map<string, number>
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
      const gcTimer = setInterval(() => this.reapStaleRooms(), 5 * 60 * 1000)
      // Don't keep a Node process alive just for GC (tests, scripts)
      gcTimer.unref?.()
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
      pausedForBuffering: false,
      forceClearedAt: new Map(),
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

    // Manual play while a member is buffering: only the host may force-resume
    // over a buffer-hold. The stuck member is LEFT BEHIND — their buffering
    // flag is cleared (so the room no longer waits on them) and they sit in
    // the flap-hysteresis window so their recovery report can't instantly
    // re-pause the room; they re-align to the group via normal drift sync.
    if (cmd.type === "play") {
      const bufferingMembers = Array.from(room.members.values()).filter((m) => m.buffering)
      if (bufferingMembers.length > 0) {
        if (room.ownerId !== userId) {
          return room.state
        }
        for (const m of bufferingMembers) {
          m.buffering = false
          this.clearBufferingTimer(room, m.userId)
          room.forceClearedAt.set(m.userId, Date.now())
        }
        const membersArray = Array.from(room.members.values()).sort(
          (a, b) => a.joinedAt - b.joinedAt
        )
        eventBus.emitEvent({
          type: "party:membership",
          payload: {
            partyId,
            action: "leave",
            ownerId: room.ownerId,
            members: membersArray,
            audience: Array.from(room.members.keys()),
          },
        })
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

    // A command that starts playback clears the buffer-pause hold; paused seeks
    // / rate changes during a buffer-pause keep it so buffering can still resume.
    if (isPlaying) {
      room.pausedForBuffering = false
    }

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
    room.pausedForBuffering = false

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

    // "Left behind" marker: this member was force-cleared during an extended
    // buffer (stuck timeout or host force-resume). Ignore fresh stall reports
    // so a hopeless network can't drag the room into a pause loop — the room
    // plays on without them. The marker lifts on their first genuine recovery
    // (buffering=false), after which their stalls pause the room normally.
    if (buffering) {
      if (room.forceClearedAt.has(userId)) {
        member.lastSeenAt = Date.now()
        room.lastSeenAt.set(userId, member.lastSeenAt)
        return room.state
      }
    } else {
      room.forceClearedAt.delete(userId)
    }

    member.buffering = buffering
    member.lastSeenAt = Date.now()
    room.lastSeenAt.set(userId, member.lastSeenAt)

    // Manage buffering timer cleanly (never evicts a member — see clearStuckBuffering)
    this.clearBufferingTimer(room, userId)
    if (buffering) {
      this.clearStuckBuffering(partyId, userId)
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

      room.pausedForBuffering = true

      newState = {
        ...room.state,
        playing: false,
        positionSec: currentPos,
        updatedAt: now,
        version: room.state.version + 1,
        // System-generated event, not a user command: never inherit the last
        // commander's clientId or that client's echo suppression will skip
        // applying the pause (and its reposition) entirely.
        senderClientId: undefined,
        reason: "buffer-pause",
      }
    } else if (
      !isAnyBuffering &&
      !room.state.playing &&
      room.pausedForBuffering
    ) {
      // Resume everyone when the last buffering member clears — even if a
      // manual pause / seek happened during the buffer-pause, we auto-resume.
      room.pausedForBuffering = false

      newState = {
        ...room.state,
        playing: true,
        updatedAt: now,
        version: room.state.version + 1,
        // See buffer-pause: must not inherit senderClientId (echo suppression).
        senderClientId: undefined,
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

  /**
   * If a member stays in `buffering` for too long, they are NOT evicted.
   * Instead they are LEFT BEHIND: their `buffering` flag is cleared, the room
   * resumes, and the member is marked in `forceClearedAt` so their recovery
   * chatter can't re-pause the room until they genuinely come back; the sync
   * engine re-aligns them once their client reports a fresh position.
   */
  private clearStuckBuffering(partyId: string, userId: string) {
    const room = this.rooms.get(partyId)
    if (!room) return

    const timer = setTimeout(() => {
      const stillRoom = this.rooms.get(partyId)
      if (!stillRoom) return
      stillRoom.bufferingTimers.delete(userId)
      const stillMember = stillRoom.members.get(userId)
      if (!stillMember || !stillMember.buffering) return

      // Clear the stuck flag — the member is never removed from the room
      stillMember.buffering = false
      stillRoom.forceClearedAt.set(userId, Date.now())

      // Emit membership update so all clients refresh member.buffering state
      const audience = Array.from(stillRoom.members.keys())
      const membersArray = Array.from(stillRoom.members.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      )

      eventBus.emitEvent({
        type: "party:membership",
        payload: {
          partyId,
          action: "join",
          ownerId: stillRoom.ownerId,
          members: membersArray,
          audience,
        },
      })

      // If this unblocks a buffer-pause, resume everyone
      if (stillRoom.state && !stillRoom.state.playing && stillRoom.pausedForBuffering) {
        const isAnyStillBuffering = membersArray.some((m) => m.buffering)
        if (!isAnyStillBuffering) {
          stillRoom.pausedForBuffering = false
          stillRoom.state = {
            ...stillRoom.state,
            playing: true,
            updatedAt: Date.now(),
            version: stillRoom.state.version + 1,
            senderClientId: undefined,
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
    timer.unref?.()

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
