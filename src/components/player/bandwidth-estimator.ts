/**
 * Adaptive bandwidth estimator for CinemaPlayer.
 *
 * Monitors real-time network conditions through multiple signals:
 * 1. Raw per-fragment throughput from hls.js FRAG_LOADED stats
 * 2. Navigator.connection API (effectiveType, downlink)
 * 3. Buffer health monitoring (buffer-ahead seconds)
 *
 * Phase 3: emits CONTINUOUS bitrate targets (quantized to a coarse grid)
 * instead of snapping to fixed presets — Jellyfin accepts any
 * maxStreamingBitrate, so auto quality can sit exactly where the network
 * sustains it. Preset ids are still emitted, but only as display labels.
 *
 * The decision logic is pure and deterministic given `now()` — tests drive
 * cooldowns with a fake clock.
 */

import type Hls from "hls.js"
import { QUALITY_PRESETS } from "@/lib/playback-types"
import { MAX_STREAM_BITRATE, MIN_STREAM_BITRATE } from "@/lib/network-probe"

export type BandwidthSample = {
  timestamp: number
  bitsPerSecond: number
  source: "hls" | "navigator" | "buffer"
}

export type QualitySuggestionInput = {
  /** Cap the stream is effectively using right now (never null). */
  currentTargetBps: number
  /**
   * True until ABR applies its first change: the startup scan cap then gets a
   * grace period on a healthy buffer instead of being instantly re-resolved.
   */
  isInitial: boolean
  bufferAheadSeconds: number
  /** Source file bitrate (never transcode above source × 1.2). */
  sourceBitrate?: number
  /** Real encoded bitrate of the active level, when known (Jellyfin often encodes below the cap). */
  actualStreamBitrate?: number
  /** True when triggered by an actual stall — emergency path without trend confirmation. */
  urgent?: boolean
}

export type QualitySuggestion = {
  action: "upgrade" | "downgrade" | "resolve" | "hold"
  targetBitrateBps: number
  /** Nearest preset id — display label only, never sent to Jellyfin. */
  targetPresetId: string
  reason: string
  estimatedBandwidth: number
}

type ConnectionInfo = {
  effectiveType?: string
  downlink?: number
  saveData?: boolean
}

// ── Policy ─────────────────────────────────────────────────────────────────

const EWMA_FAST_ALPHA = 0.3
const EWMA_SLOW_ALPHA = 0.05

/** Real throughput samples arrive per fragment; 6 is plenty and fast. */
const MIN_SAMPLES_FOR_DECISION = 6

/**
 * Buffer-health ring. At the 2s ABR cadence this spans ~30s; three strictly
 * declining samples (~6s) confirm a real downtrend.
 */
const BUFFER_RING_SIZE = 15

/** Buffer below this (and falling) = emergency territory. */
const DOWNGRADE_BUFFER_THRESHOLD = 5
/** Never upgrade while the viewer has less than this much runway. */
const UPGRADE_MIN_BUFFER = 10

/** All emitted targets land on this grid so URLs stay stable across ticks. */
const QUANTUM_BPS = 50_000
/** Tiny emergency steps are pointless — require at least this much reduction. */
const EMERGENCY_MIN_REDUCTION_RATIO = 0.02
/** Anti-spam guard for stall-driven rebuilds. */
const EMERGENCY_COOLDOWN_MS = 4_000

// Fraction of measured bandwidth a new target may consume.
const HOLD_FIT_FACTOR = 0.8 // resolve / downgrade decisions
const UPGRADE_FIT_FACTOR = 0.65 // before encode-ratio adjustment
const EMERGENCY_FIT_FACTOR = 0.55

// Directional switch thresholds relative to the current target: tiny drifts
// don't justify restarting a transcode session.
const SWITCH_UP_RATIO = 0.12
const SWITCH_DOWN_RATIO = 0.18

// Upgrade stability & cooldowns.
const UPGRADE_STABILITY_REQUIRED = 2
const UPGRADE_COOLDOWN_MS = 15_000
const DOWNGRADE_COOLDOWN_MS = 8_000
/** After an upgrade, block bandwidth-based downgrades for a settling window. */
const UPGRADE_DOWNGRADE_HYSTERESIS_MS = 20_000

/** Data-saver users get a deliberately modest target. */
const SAVE_DATA_TARGET_BPS = 1_500_000

// Ordered ascending by bitrate — used only for display labels.
const SORTED_PRESETS = QUALITY_PRESETS.filter((q) => q.maxStreamingBitrate != null).sort(
  (a, b) => (a.maxStreamingBitrate ?? 0) - (b.maxStreamingBitrate ?? 0),
)

function nearestPresetId(bps: number): string {
  let bestId = SORTED_PRESETS[0]?.id ?? "auto"
  let bestDiff = Number.POSITIVE_INFINITY
  for (const p of SORTED_PRESETS) {
    const diff = Math.abs((p.maxStreamingBitrate ?? 0) - bps)
    if (diff < bestDiff) {
      bestDiff = diff
      bestId = p.id
    }
  }
  return bestId
}

function fmtMbps(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)}Mbps`
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi))
}

export class BandwidthEstimator {
  private ewmaFast = 50_000_000
  private ewmaSlow = 50_000_000
  private sampleCount = 0
  private lastDowngradeTime = 0
  private lastUpgradeTime = 0
  private pendingUpgradeKey: number | null = null
  private pendingUpgradeCount = 0
  private bufferRing: number[] = new Array(BUFFER_RING_SIZE)
  private bufferRingIdx = 0
  private bufferRingCount = 0

  constructor() {
    this.reset()
  }

  /** Feed a new bandwidth sample (bits per second). */
  addSample(bps: number) {
    if (bps <= 0) return
    if (this.sampleCount === 0) {
      this.ewmaFast = bps
      this.ewmaSlow = bps
    } else {
      this.ewmaFast = EWMA_FAST_ALPHA * bps + (1 - EWMA_FAST_ALPHA) * this.ewmaFast
      this.ewmaSlow = EWMA_SLOW_ALPHA * bps + (1 - EWMA_SLOW_ALPHA) * this.ewmaSlow
    }
    this.sampleCount++
  }

  /** Record current buffer-ahead seconds for trend analysis (ring, O(1)). */
  recordBufferHealth(bufferAheadSeconds: number) {
    this.bufferRing[this.bufferRingIdx] = bufferAheadSeconds
    this.bufferRingIdx = (this.bufferRingIdx + 1) % BUFFER_RING_SIZE
    if (this.bufferRingCount < BUFFER_RING_SIZE) this.bufferRingCount++
  }

  /**
   * Estimated bandwidth in bits/second. Conservative (min of fast/slow EWMA):
   * after a drop the slow EWMA lags high for a long time, and overstating
   * capacity turns every hiccup into a rebuffer.
   */
  get estimatedBandwidth(): number {
    return Math.min(this.ewmaFast, this.ewmaSlow)
  }

  /** Current time in ms — overridden by tests to drive cooldowns deterministically. */
  protected now(): number {
    return Date.now()
  }

  /** Overridable in tests to stub navigator.connection. */
  protected getConnectionInfo(): ConnectionInfo | null {
    const nav = typeof navigator !== "undefined" ? (navigator as unknown as { connection?: ConnectionInfo }) : null
    const conn = nav?.connection
    if (!conn) return null
    return {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink ? conn.downlink * 1_000_000 : undefined, // Mbps → bps
      saveData: conn.saveData,
    }
  }

  /** Last three ring entries strictly decreasing? */
  private isBufferDeclining(): boolean {
    if (this.bufferRingCount < 3) return false
    const i0 = (this.bufferRingIdx - 1 + BUFFER_RING_SIZE) % BUFFER_RING_SIZE
    const i1 = (i0 - 1 + BUFFER_RING_SIZE) % BUFFER_RING_SIZE
    const i2 = (i1 - 1 + BUFFER_RING_SIZE) % BUFFER_RING_SIZE
    return this.bufferRing[i2] > this.bufferRing[i1] && this.bufferRing[i1] > this.bufferRing[i0]
  }

  private clampFit(v: number, ceiling: number): number {
    return clamp(v, MIN_STREAM_BITRATE, ceiling)
  }

  private quantizeFloor(v: number): number {
    return Math.floor(v / QUANTUM_BPS) * QUANTUM_BPS
  }

  private emit(
    action: QualitySuggestion["action"],
    targetBitrateBps: number,
    bw: number,
    reason: string,
  ): QualitySuggestion {
    return {
      action,
      targetBitrateBps,
      targetPresetId: nearestPresetId(targetBitrateBps),
      reason,
      estimatedBandwidth: bw,
    }
  }

  private hold(input: QualitySuggestionInput, bw: number, reason: string): QualitySuggestion {
    return this.emit("hold", input.currentTargetBps, bw, reason)
  }

  suggest(input: QualitySuggestionInput): QualitySuggestion {
    this.recordBufferHealth(input.bufferAheadSeconds)
    const bw = this.estimatedBandwidth
    const now = this.now()
    const current = input.currentTargetBps

    // Data saver → force a modest target regardless of measurements.
    if (this.getConnectionInfo()?.saveData) {
      if (current <= SAVE_DATA_TARGET_BPS * 1.05) {
        return this.hold(input, bw, "Data Saver enabled")
      }
      return this.emit("downgrade", SAVE_DATA_TARGET_BPS, bw, "Data Saver enabled")
    }

    // Not enough real samples yet — trust whatever the startup scan chose.
    if (this.sampleCount < MIN_SAMPLES_FOR_DECISION) {
      return this.hold(input, bw, "gathering data")
    }

    // Never request more than the source warrants.
    const ceiling =
      input.sourceBitrate && input.sourceBitrate > 0
        ? Math.min(Math.round(input.sourceBitrate * 1.2), MAX_STREAM_BITRATE)
        : MAX_STREAM_BITRATE

    // ── Emergency: buffer critically low and (falling or actively stalled).
    // Jumps straight to a conservative fit — one-step walks cost a rebuild
    // per rung and guarantee repeated stalls during a real collapse.
    const bufferCritical = input.bufferAheadSeconds < DOWNGRADE_BUFFER_THRESHOLD
    if (bufferCritical && (this.isBufferDeclining() || input.urgent === true)) {
      this.pendingUpgradeKey = null
      this.pendingUpgradeCount = 0
      const target = this.quantizeFloor(this.clampFit(bw * EMERGENCY_FIT_FACTOR, ceiling))
      const meaningfulDrop = target < current * (1 - EMERGENCY_MIN_REDUCTION_RATIO)
      if (!meaningfulDrop || now - this.lastDowngradeTime < EMERGENCY_COOLDOWN_MS) {
        return this.hold(input, bw, "emergency hold")
      }
      this.lastDowngradeTime = now
      return this.emit(
        "downgrade",
        target,
        bw,
        `buffer critically low (${input.bufferAheadSeconds.toFixed(1)}s)${input.urgent ? " + stall" : ""}`,
      )
    }

    // ── Initial scan-cap grace: give the fresh start a chance before
    // re-resolving it downward; only act when it's clearly not working out.
    if (input.isInitial) {
      if (input.bufferAheadSeconds >= DOWNGRADE_BUFFER_THRESHOLD) {
        return this.hold(input, bw, "initial scan cap — healthy buffer")
      }
      if (
        now - this.lastDowngradeTime >= DOWNGRADE_COOLDOWN_MS &&
        this.quantizeFloor(this.clampFit(bw * HOLD_FIT_FACTOR, ceiling)) <
          current * (1 - SWITCH_DOWN_RATIO)
      ) {
        const target = this.quantizeFloor(this.clampFit(bw * HOLD_FIT_FACTOR, ceiling))
        this.lastDowngradeTime = now
        return this.emit("resolve", target, bw, "initial cap too high — resolving down")
      }
      return this.hold(input, bw, "initial cap settling")
    }

    // ── Normal downgrade: sustained capacity no longer fits the target.
    const holdFit = this.quantizeFloor(this.clampFit(bw * HOLD_FIT_FACTOR, ceiling))
    if (holdFit < current * (1 - SWITCH_DOWN_RATIO)) {
      this.pendingUpgradeKey = null
      this.pendingUpgradeCount = 0
      if (now - this.lastUpgradeTime < UPGRADE_DOWNGRADE_HYSTERESIS_MS) {
        return this.hold(input, bw, "post-upgrade hysteresis")
      }
      if (now - this.lastDowngradeTime < DOWNGRADE_COOLDOWN_MS) {
        return this.hold(input, bw, "downgrade cooldown")
      }
      this.lastDowngradeTime = now
      return this.emit("downgrade", holdFit, bw, `bandwidth ${fmtMbps(bw)} sustained`)
    }

    // ── Upgrade: candidate fit scaled by how much of the cap Jellyfin really
    // encodes (ratio ≤ 1 means upgrades are cheaper than the nominal caps
    // suggest, e.g. animated content at 3 Mbps under a 20 Mbps cap).
    const ratio =
      input.actualStreamBitrate && input.actualStreamBitrate > 0 && current > 0
        ? clamp(input.actualStreamBitrate / current, 0.5, 1)
        : 1
    const upFactor = clamp(UPGRADE_FIT_FACTOR / ratio, 0.55, 0.95)
    const candidate = this.quantizeFloor(this.clampFit(bw * upFactor, ceiling))
    const wantsUp = candidate > current * (1 + SWITCH_UP_RATIO)

    if (wantsUp && input.bufferAheadSeconds > UPGRADE_MIN_BUFFER) {
      if (now - this.lastDowngradeTime < UPGRADE_COOLDOWN_MS) {
        return this.hold(input, bw, "upgrade cooldown after downgrade")
      }
      if (now - this.lastUpgradeTime < UPGRADE_COOLDOWN_MS) {
        return this.hold(input, bw, "upgrade cooldown")
      }
      if (this.pendingUpgradeKey === candidate) {
        this.pendingUpgradeCount++
      } else {
        this.pendingUpgradeKey = candidate
        this.pendingUpgradeCount = 1
      }
      if (this.pendingUpgradeCount >= UPGRADE_STABILITY_REQUIRED) {
        const appliedChecks = this.pendingUpgradeCount
        this.lastUpgradeTime = now
        this.pendingUpgradeKey = null
        this.pendingUpgradeCount = 0
        return this.emit(
          "upgrade",
          candidate,
          bw,
          `capacity ${fmtMbps(bw)} sustained (${appliedChecks} checks), buffer ${input.bufferAheadSeconds.toFixed(0)}s`,
        )
      }
      return this.hold(
        input,
        bw,
        `upgrade pending stability (${this.pendingUpgradeCount}/${UPGRADE_STABILITY_REQUIRED})`,
      )
    }

    // Upgrade condition broken — reset stability counter.
    this.pendingUpgradeKey = null
    this.pendingUpgradeCount = 0

    return this.hold(input, bw, "stable")
  }

  /** True once enough real samples exist to trust the estimate over its seed. */
  isReliable(): boolean {
    return this.sampleCount >= MIN_SAMPLES_FOR_DECISION
  }

  /** Reset all state (e.g. on stream change). Accepts a measured/known
   *  bandwidth seed (network scan) in bits/second; falls back to
   *  navigator.connection, then an optimistic default. */
  reset(seedBps?: number) {
    const initialBps =
      seedBps != null && Number.isFinite(seedBps) && seedBps > 0
        ? seedBps
        : (this.getConnectionInfo()?.downlink ?? 25_000_000)
    this.ewmaFast = initialBps
    this.ewmaSlow = initialBps
    this.sampleCount = 0
    this.lastDowngradeTime = 0
    this.lastUpgradeTime = 0
    this.pendingUpgradeKey = null
    this.pendingUpgradeCount = 0
    this.bufferRing = new Array(BUFFER_RING_SIZE)
    this.bufferRingIdx = 0
    this.bufferRingCount = 0
  }
}

/**
 * Attach hls.js FRAG_LOADED listener to feed bandwidth samples.
 *
 * Prefers RAW throughput (bytes ÷ transfer time between first and last byte):
 * hls.js' own stats.bwEstimate is already an EWMA, and feeding an EWMA into
 * another EWMA double-smooths the signal until it stops reacting. Raw samples
 * also arrive usable after the very first fragment instead of needing many.
 * Returns a cleanup function.
 */
export function attachHlsBandwidthMonitor(
  hls: Hls,
  HlsCtor: typeof Hls,
  estimator: BandwidthEstimator,
): () => void {
  const handler = (
    _event: string,
    data: {
      frag?: {
        stats?: {
          loaded?: number
          trequest?: number
          tfirst?: number
          tload?: number
          bwEstimate?: number
        }
      }
      stats?: {
        loaded?: number
        trequest?: number
        tfirst?: number
        tload?: number
        bwEstimate?: number
      }
    },
  ) => {
    const stats = data?.frag?.stats ?? data?.stats
    if (!stats) return

    // Ignore tiny fragments (< 10 KB) like init segments and playlists that
    // skew bandwidth measurements.
    if (typeof stats.loaded === "number" && stats.loaded < 10_000) return

    let bps = 0
    const start = typeof stats.tfirst === "number" && stats.tfirst > 0 ? stats.tfirst : stats.trequest
    if (
      typeof stats.loaded === "number" &&
      stats.loaded > 0 &&
      typeof stats.tload === "number" &&
      stats.tload > 0 &&
      typeof start === "number" &&
      start > 0 &&
      stats.tload > start
    ) {
      const durationSec = (stats.tload - start) / 1000
      if (durationSec > 0) bps = (stats.loaded * 8) / durationSec
    }
    // Fall back to hls.js' own estimate only when raw timing is unavailable.
    if (!(bps > 0) && typeof stats.bwEstimate === "number" && stats.bwEstimate > 0) {
      bps = stats.bwEstimate
    }

    if (bps > 0) {
      estimator.addSample(bps)
    }
  }

  hls.on(HlsCtor.Events.FRAG_LOADED, handler)
  return () => hls.off(HlsCtor.Events.FRAG_LOADED, handler)
}
