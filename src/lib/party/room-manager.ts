import { eventBus } from "../event-bus"
import type { PartyCommand, PartyMember, PartyRoomSnapshot, PartyState } from "./protocol"
import { MAX_COMMAND_TRANSPORT_MS, MAX_PARTY_POSITION_SEC } from "./protocol"
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
  pausedForBuffering: boolean
}

/** A buffering member whose tab died mid-stall can never report recovery.
 *  Treat them as departed after this much silence from their heartbeat. */
const GHOST_BUFFER_TIMEOUT_MS = 90_000

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

  private reapStaleRooms() {
    const now = Date.now()
    const MAX_INACTIVE_MS = 30 * 60 * 1000 // 30 minutes

    for (const [roomId, room] of this.rooms.entries()) {
      let newestActivity = room.createdAt
      for (const timestamp of room.lastSeenAt.values()) {
        if (timestamp > newestActivity) newestActivity = timestamp
      }

      if (room.members.size === 0 || now - newestActivity > MAX_INACTIVE_MS) {
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
      pausedForBuffering: false,
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
      this.pruneGhostBufferingMembers(room)
    }
  }

  /**
   * Strict buffer-hold resume: transitions a paused-for-buffering room back to
   * playing when NO member is buffering anymore. Returns the new state (and
   * sets it on the room) or null when no transition applies.
   */
  private maybeResume(room: PartyRoom): PartyState | null {
    if (!room.state || !room.pausedForBuffering || room.state.playing) return null
    const isAnyBuffering = Array.from(room.members.values()).some((m) => m.buffering)
    if (isAnyBuffering) return null

    room.pausedForBuffering = false
    const newState: PartyState = {
      ...room.state,
      playing: true,
      updatedAt: Date.now(),
      version: room.state.version + 1,
      // System-generated event, not a user command: never inherit the last
      // commander's clientId or that client's echo suppression will skip
      // applying the resume (see buffer-pause).
      senderClientId: undefined,
      reason: "buffer-resume",
    }
    room.state = newState
    return newState
  }

  /**
   * Crash cleanup, NOT eviction: a member whose tab died mid-stall can never
   * send `buffering=false`, which would otherwise hold the room paused
   * forever. Members that haven't sent a heartbeat in GHOST_BUFFER_TIMEOUT_MS
   * are treated as departed — removed, membership broadcast, and the room
   * resumed if they were the last one holding it. Present members (fresh
   * heartbeat) are never touched.
   */
  private pruneGhostBufferingMembers(room: PartyRoom): void {
    const now = Date.now()
    let removed = false
    let ownerRemoved = false
    for (const [userId, member] of room.members.entries()) {
      if (!member.buffering) continue
      if (now - member.lastSeenAt <= GHOST_BUFFER_TIMEOUT_MS) continue
      room.members.delete(userId)
      room.lastSeenAt.delete(userId)
      removed = true
      if (room.ownerId === userId) ownerRemoved = true
    }
    if (!removed) return

    if (room.members.size === 0) {
      this.rooms.delete(room.id)
      this.removeFromConvex(room.id)
      eventBus.emitEvent({
        type: "party:ended",
        payload: { partyId: room.id, audience: [] },
      })
      return
    }

    if (ownerRemoved) {
      // Transfer ownership to the oldest remaining member
      const remainingMembers = Array.from(room.members.values()).sort(
        (a, b) => a.joinedAt - b.joinedAt
      )
      room.ownerId = remainingMembers[0].userId
    }

    const membersArray = Array.from(room.members.values()).sort(
      (a, b) => a.joinedAt - b.joinedAt
    )
    eventBus.emitEvent({
      type: "party:membership",
      payload: {
        partyId: room.id,
        action: ownerRemoved ? "owner-changed" : "leave",
        ownerId: room.ownerId,
        members: membersArray,
        audience: Array.from(room.members.keys()),
      },
    })

    const resumed = this.maybeResume(room)
    if (resumed) {
      eventBus.emitEvent({
        type: "party:state",
        payload: {
          partyId: room.id,
          state: resumed,
          audience: Array.from(room.members.keys()),
        },
      })
    }

    this.syncToConvex(room)
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

    room.members.delete(userId)
    room.lastSeenAt.delete(userId)

    if (room.members.size === 0) {
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

    // Clean leave is not crash cleanup, but the same hold applies: if the
    // member who just left was the only one buffering, nobody can report
    // recovery anymore — release the buffer-pause or the room stays paused
    // forever. (Crash cleanup has its own path in pruneGhostBufferingMembers.)
    const resumed = this.maybeResume(room)
    if (resumed) {
      eventBus.emitEvent({
        type: "party:state",
        payload: {
          partyId,
          state: resumed,
          audience,
        },
      })
    }

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

    this.pruneGhostBufferingMembers(room)

    // Only owner can change playback rate
    if (cmd.type === "rate" && room.ownerId !== userId) {
      return room.state
    }

    // Strict buffer-hold: nobody — not even the host — may play while any
    // member is buffering. The room resumes exclusively via buffer-resume
    // once every member's client reports a genuine recovery.
    if (cmd.type === "play") {
      const isAnyBuffering = Array.from(room.members.values()).some((m) => m.buffering)
      if (isAnyBuffering) {
        return room.state
      }
    }

    const now = Date.now()
    const currentPos = room.state
      ? room.state.playing
        ? room.state.positionSec + ((now - room.state.updatedAt) / 1000) * room.state.playbackRate
        : room.state.positionSec
      : 0

    // Sender-RTT compensation: the position was captured on the client one
    // transport round-trip before we stamp `updatedAt`. Advance it by the
    // elapsed time so every receiver extrapolates to the issuer's true
    // playhead instead of lagging one RTT behind on every command. Pauses
    // capture the exact stop point, so they are not advanced. The elapsed
    // window is clamped so a poisoned `sentAt` can't distort the playhead.
    let newPos = cmd.positionSec ?? currentPos
    if (cmd.positionSec !== undefined && cmd.type !== "pause" && cmd.sentAt !== undefined) {
      const elapsedMs = Math.min(MAX_COMMAND_TRANSPORT_MS, Math.max(0, now - cmd.sentAt))
      const rate = cmd.playbackRate ?? room.state?.playbackRate ?? 1.0
      newPos = Math.min(MAX_PARTY_POSITION_SEC, newPos + (elapsedMs / 1000) * rate)
    }

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

    this.pruneGhostBufferingMembers(room)

    const member = room.members.get(userId)!
    member.buffering = buffering
    member.lastSeenAt = Date.now()
    room.lastSeenAt.set(userId, member.lastSeenAt)

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
    } else {
      // Resume everyone when the last buffering member clears — even if a
      // manual pause / seek happened during the buffer-pause, we auto-resume.
      newState = this.maybeResume(room)
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
