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
  /** Server-space epoch ms at the moment the position was captured. Lets the
   *  server advance positionSec by the transport delay so receivers
   *  extrapolate to the issuer's true playhead. */
  sentAt?: number
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
  if (cmd.sentAt !== undefined && (typeof cmd.sentAt !== "number" || !Number.isFinite(cmd.sentAt))) {
    return null
  }
  return cmd as PartyCommand
}

export const DRIFT_THRESHOLDS = {
  MICRO_LOWER: 0.12, // seconds
  MICRO_UPPER: 0.3, // seconds
  MICRO_ADJUST: 0.05, // 5% playback rate adjustment
  MID_UPPER: 1.0, // seconds
  MID_ADJUST: 0.12, // 12% playback rate adjustment
  SEEK_THRESHOLD: 0.2, // seconds – immediate reposition when applying peer state
  SEEK_HARD: 1.0, // seconds – hard seek beyond the micro/mid bands
  RESEEK_GUARD: 0.1, // seconds – minimum reposition delta to avoid oscillation
}

// Client-side buffering policy for watch parties. The room waits for a
// stalled member until they prove a genuine recovery — never force-resumes
// while someone is still buffering.
export const PARTY_BUFFERING = {
  STALL_DEBOUNCE_MS: 400, // stall → server report latency
  RECOVERY_BUFFER_AHEAD_SEC: 8, // default buffered ahead required to release the room pause
  RECOVERY_BUFFER_AHEAD_MIN_SEC: 3, // min bound (e.g. mobile 3G/4G or short segments)
  RECOVERY_BUFFER_AHEAD_MAX_SEC: 8, // max bound
  RECOVERY_GRACE_MS: 2000, // sustained playable state before reporting recovery
  RECOVERY_POLL_MS: 500, // recovery check cadence
  SCRUB_IGNORE_MS: 2500, // after a seek begins, suppress stall reports/repositions
}

/**
 * 8.2 — Adaptive buffer-ahead requirement based on stream segment duration.
 * Scales: max(3, min(8, segmentDuration * 2)) so mobile streams recover rapidly
 * without keeping the room locked in prolonged buffer-holds.
 */
export function computeRecoveryBufferAheadSec(segmentDurationSec?: number): number {
  if (
    typeof segmentDurationSec === "number" &&
    Number.isFinite(segmentDurationSec) &&
    segmentDurationSec > 0
  ) {
    return Math.max(
      PARTY_BUFFERING.RECOVERY_BUFFER_AHEAD_MIN_SEC,
      Math.min(PARTY_BUFFERING.RECOVERY_BUFFER_AHEAD_MAX_SEC, segmentDurationSec * 2)
    )
  }
  return PARTY_BUFFERING.RECOVERY_BUFFER_AHEAD_SEC
}

export type SyncQuality = "synced" | "syncing" | "resyncing" | "buffering" | "paused"

/**
 * 8.4 — Computes user-facing sync quality based on current drift in seconds and playback state.
 */
export function getSyncQuality(
  driftSec: number,
  isBuffering: boolean,
  isPlaying: boolean
): SyncQuality {
  if (isBuffering) return "buffering"
  if (!isPlaying) return "paused"
  const absDrift = Math.abs(driftSec)
  if (absDrift <= DRIFT_THRESHOLDS.MICRO_UPPER) return "synced"
  if (absDrift <= DRIFT_THRESHOLDS.MID_UPPER) return "syncing"
  return "resyncing"
}

// Server-space clock used by sentAt / latency compensation
export const MAX_COMMAND_TRANSPORT_MS = 2000

