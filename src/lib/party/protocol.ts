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

export const ALLOWED_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const

export const MAX_PARTY_POSITION_SEC = 24 * 60 * 60 // 24h — sanity bound for playheads

export function isValidPositionSec(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_PARTY_POSITION_SEC
}

export function isValidPlaybackRate(v: unknown): v is number {
  return typeof v === "number" && (ALLOWED_PLAYBACK_RATES as readonly number[]).includes(v)
}

/**
 * Structural + range validation for inbound party commands. Returns the
 * command when valid, null otherwise — invalid payloads must never reach the
 * room state (NaN / absurd rates once poisoned every member's sync math).
 */
export function sanitizePartyCommand(raw: unknown): PartyCommand | null {
  if (!raw || typeof raw !== "object") return null
  const cmd = raw as Partial<PartyCommand>
  if (cmd.type !== "play" && cmd.type !== "pause" && cmd.type !== "seek" && cmd.type !== "rate") {
    return null
  }
  if (typeof cmd.clientId !== "string" || cmd.clientId.length === 0 || cmd.clientId.length > 64) {
    return null
  }
  if (typeof cmd.commandId !== "string" || cmd.commandId.length === 0 || cmd.commandId.length > 96) {
    return null
  }
  if (cmd.positionSec !== undefined && !isValidPositionSec(cmd.positionSec)) return null
  if (cmd.playbackRate !== undefined && !isValidPlaybackRate(cmd.playbackRate)) return null
  return cmd as PartyCommand
}

export const DRIFT_THRESHOLDS = {
  MICRO_LOWER: 0.15, // seconds
  MICRO_UPPER: 0.35, // seconds
  MICRO_ADJUST: 0.03, // 3% playback rate adjustment
  MID_UPPER: 1.5, // seconds
  MID_ADJUST: 0.08, // 8% playback rate adjustment
  SEEK_THRESHOLD: 0.25, // seconds – immediate reposition when applying peer state
  SEEK_HARD: 1.5, // seconds – hard seek beyond the micro/mid bands
  RESEEK_GUARD: 0.1, // seconds – minimum reposition delta to avoid oscillation
}
