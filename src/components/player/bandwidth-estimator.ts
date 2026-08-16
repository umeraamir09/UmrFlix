/**
 * Adaptive bandwidth estimator for CinemaPlayer.
 *
 * Monitors real-time network conditions through multiple signals:
 * 1. hls.js bandwidth estimates (from FRAG_LOADED events)
 * 2. Navigator.connection API (effectiveType, downlink)
 * 3. Buffer health monitoring (buffer-ahead seconds)
 *
 * Emits quality suggestions (upgrade / downgrade) that the player can
 * act on without interrupting the current stream — or trigger a stream
 * rebuild when necessary.
 */

import type Hls from "hls.js"
import { QUALITY_PRESETS, type QualityPreset } from "@/lib/playback-types"

export type BandwidthSample = {
  timestamp: number
  bitsPerSecond: number
  source: "hls" | "navigator" | "buffer"
}

export type QualitySuggestion = {
  action: "upgrade" | "downgrade" | "resolve" | "hold"
  targetPresetId: string
  reason: string
  estimatedBandwidth: number
}

type ConnectionInfo = {
  effectiveType?: string
  downlink?: number
  saveData?: boolean
}

const EWMA_FAST_ALPHA = 0.3   // smoother, less volatile
const EWMA_SLOW_ALPHA = 0.05  // smooths out spikes
const MIN_SAMPLES_FOR_DECISION = 8
const DOWNGRADE_BUFFER_THRESHOLD = 5  // seconds: buffer below this = danger
const UPGRADE_BUFFER_THRESHOLD = 25   // seconds: buffer above this = safe to upgrade
const SAFETY_FACTOR = 0.85            // use 85% of estimated bandwidth
// 3.7 — Netflix/YouTube-grade margins: a 1.3-1.35x upgrade margin lets CDN
// burst spikes trigger an upgrade, the higher bitrate exhausts the bandwidth,
// and the next check downgrades again — visible "pumping" that costs a full
// stream rebuild + transcode restart each time with Jellyfin.
const UPGRADE_MARGIN = 1.5            // require 1.5x bandwidth headroom for upgrades
const UPGRADE_STABILITY_REQUIRED = 3  // require 3 consecutive checks (15s) before upgrading
const UPGRADE_COOLDOWN_MS = 20_000    // don't upgrade within 20s of a downgrade or upgrade
const DOWNGRADE_COOLDOWN_MS = 10_000  // don't downgrade more than once per 10s
// 3.7 — hysteresis: after an upgrade, hold the new quality for 30s before
// allowing a bandwidth-based downgrade. Samples collected right after a
// stream rebuild are unreliable (new transcode session, cold ffmpeg), so a
// quick re-downgrade would just restart the transcode for nothing.
// The buffer-emergency downgrade stays exempt — a genuinely declining buffer
// must always be allowed to fire even inside the window.
const UPGRADE_DOWNGRADE_HYSTERESIS_MS = 30_000

// Ordered by bitrate ascending for easy binary searching.
// Auto preset has no maxStreamingBitrate — it's a no-op placeholder, not a
// real quality tier, so it's intentionally excluded from bandwidth decisions.
const SORTED_PRESETS = QUALITY_PRESETS
  .filter(q => q.maxStreamingBitrate != null)
  .sort((a, b) => (a.maxStreamingBitrate ?? 0) - (b.maxStreamingBitrate ?? 0))

export class BandwidthEstimator {
  private ewmaFast = 50_000_000 // default 50 Mbps (healthy high-res default)
  private ewmaSlow = 50_000_000
  private sampleCount = 0
  private lastDowngradeTime = 0
  private lastUpgradeTime = 0
  private pendingUpgradeTargetPresetId: string | null = null
  private pendingUpgradeCount = 0
  private bufferRing: number[] = new Array(10)
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

  /** Record current buffer-ahead seconds for trend analysis (ring buffer, O(1)). */
  recordBufferHealth(bufferAheadSeconds: number) {
    this.bufferRing[this.bufferRingIdx] = bufferAheadSeconds
    this.bufferRingIdx = (this.bufferRingIdx + 1) % 10
    if (this.bufferRingCount < 10) this.bufferRingCount++
  }

  /** Estimated bandwidth in bits/second (reflects active connection capacity). */
  get estimatedBandwidth(): number {
    // Conservative estimate (min of fast/slow EWMA): after a bandwidth drop,
    // the slow EWMA (α=0.05) lags high for a long time — using the max would
    // overstate capacity and delay bandwidth-based downgrades, forcing the
    // buffer-emergency path to do the work (i.e. rebuffering).
    return Math.min(this.ewmaFast, this.ewmaSlow)
  }

  /** Current time in ms — extracted so tests can drive cooldowns deterministically. */
  protected now(): number {
    return Date.now()
  }

  /** Check Navigator.connection for supplementary info. */
  private getConnectionInfo(): ConnectionInfo | null {
    const nav = typeof navigator !== "undefined" ? (navigator as unknown as { connection?: ConnectionInfo }) : null
    const conn = nav?.connection
    if (!conn) return null
    return {
      effectiveType: conn.effectiveType,
      downlink: conn.downlink ? conn.downlink * 1_000_000 : undefined, // Mbps → bps
      saveData: conn.saveData,
    }
  }

  /** Is the buffer health trending downward? */
  private isBufferDeclining(): boolean {
    if (this.bufferRingCount < 3) return false
    const i0 = (this.bufferRingIdx - 1 + 10) % 10
    const i1 = (i0 - 1 + 10) % 10
    const i2 = (i1 - 1 + 10) % 10
    return this.bufferRing[i2] > this.bufferRing[i1] && this.bufferRing[i1] > this.bufferRing[i0]
  }

  /**
   * Suggest a quality preset based on current conditions.
   * @param currentPresetId - The currently active quality preset ID
   * @param bufferAheadSeconds - Current buffer-ahead in seconds
   * @param sourceBitrate - Source file bitrate (for ceiling)
   */
  suggest(
    currentPresetId: string,
    bufferAheadSeconds: number,
    sourceBitrate?: number,
  ): QualitySuggestion {
    this.recordBufferHealth(bufferAheadSeconds)
    const now = this.now()
    const bw = this.estimatedBandwidth
    const safeBw = bw * SAFETY_FACTOR
    const conn = this.getConnectionInfo()

    // Data saver mode — force lowest quality
    if (conn?.saveData) {
      const lowest = SORTED_PRESETS[0]
      return {
        action: currentPresetId === lowest.id ? "hold" : "downgrade",
        targetPresetId: lowest.id,
        reason: "Data Saver enabled",
        estimatedBandwidth: bw,
      }
    }

    // Not enough network samples gathered yet — hold current quality
    if (this.sampleCount < MIN_SAMPLES_FOR_DECISION) {
      return { action: "hold", targetPresetId: currentPresetId, reason: "gathering data", estimatedBandwidth: bw }
    }

    // Find the best preset that fits within our safe bandwidth
    let bestPreset: QualityPreset | null = null
    for (let i = SORTED_PRESETS.length - 1; i >= 0; i--) {
      const p = SORTED_PRESETS[i]
      if ((p.maxStreamingBitrate ?? 0) <= safeBw) {
        bestPreset = p
        break
      }
    }

    // If safeBw is generous or initial estimate is high, default to highest available preset
    if (!bestPreset) {
      bestPreset = SORTED_PRESETS[SORTED_PRESETS.length - 1]
    }

    // Cap at source bitrate — don't recommend higher than the source
    if (sourceBitrate && bestPreset.maxStreamingBitrate &&
        bestPreset.maxStreamingBitrate > sourceBitrate * 1.2) {
      for (let i = SORTED_PRESETS.length - 1; i >= 0; i--) {
        if ((SORTED_PRESETS[i].maxStreamingBitrate ?? 0) <= sourceBitrate * 1.2) {
          bestPreset = SORTED_PRESETS[i]
          break
        }
      }
    }

    const currentPreset = SORTED_PRESETS.find(p => p.id === currentPresetId)

    // First resolution from "auto" (preset not found in SORTED_PRESETS):
    // If buffer is healthy (>= 5s), stay uncapped at highest preset rather than downgrading
    if (!currentPreset) {
      if (bufferAheadSeconds >= 5) {
        const topPreset = SORTED_PRESETS[SORTED_PRESETS.length - 1]
        return {
          action: "hold",
          targetPresetId: topPreset.id,
          reason: "initial auto resolution — healthy buffer",
          estimatedBandwidth: bw,
        }
      }
      return {
        action: "resolve",
        targetPresetId: bestPreset.id,
        reason: "initial auto resolution",
        estimatedBandwidth: bw,
      }
    }

    const currentBitrate = currentPreset.maxStreamingBitrate ?? Infinity

    // ── Emergency downgrade: buffer critically low ──
    if (bufferAheadSeconds < DOWNGRADE_BUFFER_THRESHOLD && this.isBufferDeclining()) {
      this.pendingUpgradeTargetPresetId = null
      this.pendingUpgradeCount = 0
      if (now - this.lastDowngradeTime < DOWNGRADE_COOLDOWN_MS) {
        return { action: "hold", targetPresetId: currentPresetId, reason: "downgrade cooldown", estimatedBandwidth: bw }
      }
      const currentIdx = SORTED_PRESETS.findIndex(p => p.id === currentPresetId)
      if (currentIdx > 0) {
        this.lastDowngradeTime = now
        const lower = SORTED_PRESETS[currentIdx - 1]
        return {
          action: "downgrade",
          targetPresetId: lower.id,
          reason: `buffer critically low (${bufferAheadSeconds.toFixed(1)}s) and declining`,
          estimatedBandwidth: bw,
        }
      }
    }

    // ── Bandwidth-based downgrade ──
    if (bestPreset.id !== currentPresetId &&
        (bestPreset.maxStreamingBitrate ?? 0) < currentBitrate) {
      this.pendingUpgradeTargetPresetId = null
      this.pendingUpgradeCount = 0
      // 3.7 — post-upgrade hysteresis: block bandwidth downgrades for 30s
      // after an upgrade. The new stream rebuild's early samples are
      // unreliable, and an immediate re-downgrade restarts the transcode.
      if (now - this.lastUpgradeTime < UPGRADE_DOWNGRADE_HYSTERESIS_MS) {
        return { action: "hold", targetPresetId: currentPresetId, reason: "post-upgrade hysteresis", estimatedBandwidth: bw }
      }
      if (now - this.lastDowngradeTime < DOWNGRADE_COOLDOWN_MS) {
        return { action: "hold", targetPresetId: currentPresetId, reason: "downgrade cooldown", estimatedBandwidth: bw }
      }
      this.lastDowngradeTime = now
      return {
        action: "downgrade",
        targetPresetId: bestPreset.id,
        reason: `bandwidth ${(bw / 1_000_000).toFixed(1)} Mbps < current quality needs`,
        estimatedBandwidth: bw,
      }
    }

    // ── Upgrade: require 1.5x margin, healthy buffer, cooldowns, and 3 consecutive checks ──
    const targetBitrate = bestPreset.maxStreamingBitrate ?? 0
    const satisfiesUpgradeMargin = bw >= targetBitrate * UPGRADE_MARGIN
    if (bestPreset.id !== currentPresetId &&
        targetBitrate > currentBitrate &&
        satisfiesUpgradeMargin &&
        bufferAheadSeconds > UPGRADE_BUFFER_THRESHOLD &&
        now - this.lastDowngradeTime > UPGRADE_COOLDOWN_MS &&
        now - this.lastUpgradeTime > UPGRADE_COOLDOWN_MS) {
      if (this.pendingUpgradeTargetPresetId === bestPreset.id) {
        this.pendingUpgradeCount++
      } else {
        this.pendingUpgradeTargetPresetId = bestPreset.id
        this.pendingUpgradeCount = 1
      }

      if (this.pendingUpgradeCount >= UPGRADE_STABILITY_REQUIRED) {
        this.lastUpgradeTime = now
        this.pendingUpgradeTargetPresetId = null
        this.pendingUpgradeCount = 0
        return {
          action: "upgrade",
          targetPresetId: bestPreset.id,
          reason: `bandwidth ${(bw / 1_000_000).toFixed(1)} Mbps >= ${UPGRADE_MARGIN}x target, buffer healthy (${bufferAheadSeconds.toFixed(0)}s), sustained over ${UPGRADE_STABILITY_REQUIRED} checks`,
          estimatedBandwidth: bw,
        }
      } else {
        return {
          action: "hold",
          targetPresetId: currentPresetId,
          reason: `upgrade to ${bestPreset.id} pending stability (${this.pendingUpgradeCount}/${UPGRADE_STABILITY_REQUIRED})`,
          estimatedBandwidth: bw,
        }
      }
    }

    // Upgrade condition not met or broken — reset stability counter
    this.pendingUpgradeTargetPresetId = null
    this.pendingUpgradeCount = 0

    return { action: "hold", targetPresetId: currentPresetId, reason: "stable", estimatedBandwidth: bw }
  }

  /** Reset all state (e.g. on stream change). */
  reset() {
    const conn = this.getConnectionInfo()
    const initialBps = conn?.downlink ? conn.downlink : 25_000_000 // 25 Mbps
    this.ewmaFast = initialBps
    this.ewmaSlow = initialBps
    this.sampleCount = 0
    this.lastDowngradeTime = 0
    this.lastUpgradeTime = 0
    this.pendingUpgradeTargetPresetId = null
    this.pendingUpgradeCount = 0
    this.bufferRing = new Array(10)
    this.bufferRingIdx = 0
    this.bufferRingCount = 0
  }
}

/**
 * Attach hls.js FRAG_LOADED listener to feed bandwidth samples.
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
    // skew bandwidth measurements. Real low-bitrate fragments (~150 KB at
    // ~600kbps/2s) must still count, or slow connections never gather enough
    // samples for an ABR decision (MIN_SAMPLES_FOR_DECISION = 8).
    if (typeof stats.loaded === "number" && stats.loaded < 10_000) return

    let bps = 0
    if (typeof stats.bwEstimate === "number" && stats.bwEstimate > 0) {
      bps = stats.bwEstimate
    } else if (typeof stats.loaded === "number" && stats.loaded > 0) {
      const start = stats.tfirst && stats.tfirst > 0 ? stats.tfirst : stats.trequest
      if (stats.tload && start && stats.tload > start) {
        const durationSec = (stats.tload - start) / 1000
        if (durationSec > 0) {
          bps = (stats.loaded * 8) / durationSec
        }
      }
    }

    if (bps > 0) {
      estimator.addSample(bps)
    }
  }

  hls.on(HlsCtor.Events.FRAG_LOADED, handler)
  return () => hls.off(HlsCtor.Events.FRAG_LOADED, handler)
}
