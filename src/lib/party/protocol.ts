export type PartyState = {
  itemId: string | null
  playing: boolean
  positionSec: number
  updatedAt: number // server ms epoch
  playbackRate: number
  version: number // monotonic
  senderClientId?: string
  reason?: "command" | "buffer-pause" | "buffer-resume" | "item"
}

export type PartyCommandType = "play" | "pause" | "seek" | "rate"

export type PartyCommand = {
  type: PartyCommandType
  positionSec?: number
  playbackRate?: number
  clientId: string
  commandId: string
}

export type PartyMember = {
  userId: string
  username: string
  avatarUrl?: string
  joinedAt: number
  buffering: boolean
  lastSeenAt: number
}

export type PartyRoomSnapshot = {
  partyId: string
  ownerId: string
  isOwner: boolean
  userId: string
  createdAt: number
  state: PartyState | null
  members: PartyMember[]
  pendingInvites: string[]
  serverNow: number
}

/**
 * Calculates the predicted video position in seconds based on room state and estimated server time.
 */
export function predictedPosition(s: PartyState, serverNowEst: number): number {
  if (!s.playing) return s.positionSec
  const elapsedSec = (serverNowEst - s.updatedAt) / 1000
  return Math.max(0, s.positionSec + elapsedSec * (s.playbackRate || 1.0))
}

export const DRIFT_THRESHOLDS = {
  MICRO_LOWER: 0.15, // seconds
  MICRO_UPPER: 0.75, // seconds
  MICRO_ADJUST: 0.03, // 3% playback rate adjustment
}
