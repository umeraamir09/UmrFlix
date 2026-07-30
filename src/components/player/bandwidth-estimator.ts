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

const EWMA_FAST_ALPHA = 0.5   // responds quickly to drops
const EWMA_SLOW_ALPHA = 0.1   // smooths out spikes
const MIN_SAMPLES_FOR_DECISION = 3
const DOWNGRADE_BUFFER_THRESHOLD = 5  // seconds: buffer below this = danger
const UPGRADE_BUFFER_THRESHOLD = 30   // seconds: buffer above this = safe to upgrade
const SAFETY_FACTOR = 0.75            // use 75% of estimated bandwidth for quality selection
const UPGRADE_COOLDOWN_MS = 30_000    // don't upgrade within 30s of a downgrade
const DOWNGRADE_COOLDOWN_MS = 10_000  // don't downgrade more than once per 10s

// Ordered by bitrate ascending for easy binary searching.
// Auto preset has no maxStreamingBitrate — it's a no-op placeholder, not a
// real quality tier, so it's intentionally excluded from bandwidth decisions.
const SORTED_PRESETS = QUALITY_PRESETS
  .filter(q => q.maxStreamingBitrate != null)
  .sort((a, b) => (a.maxStreamingBitrate ?? 0) - (b.maxStreamingBitrate ?? 0))

export class BandwidthEstimator {
  private ewmaFast = 25_000_000 // default 25 Mbps (healthy high-res default)
  private ewmaSlow = 25_000_000
  private sampleCount = 0
  private lastDowngradeTime = 0
  private lastUpgradeTime = 0
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

  /** Estimated bandwidth in bits/second (conservative — uses the slower EWMA). */
  get estimatedBandwidth(): number {
    return Math.min(this.ewmaFast, this.ewmaSlow)
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
    const now = Date.now()
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

    // Not enough network samples gathered yet — hold current high quality
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
    // jump straight to the best preset without touching upgrade/downgrade cooldowns.
    if (!currentPreset) {
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

    // ── Upgrade: only when buffer is healthy and cooldown expired ──
    if (bestPreset.id !== currentPresetId &&
        (bestPreset.maxStreamingBitrate ?? 0) > currentBitrate &&
        bufferAheadSeconds > UPGRADE_BUFFER_THRESHOLD &&
        now - this.lastDowngradeTime > UPGRADE_COOLDOWN_MS &&
        now - this.lastUpgradeTime > UPGRADE_COOLDOWN_MS) {
      this.lastUpgradeTime = now
      return {
        action: "upgrade",
        targetPresetId: bestPreset.id,
        reason: `bandwidth ${(bw / 1_000_000).toFixed(1)} Mbps supports higher quality, buffer healthy (${bufferAheadSeconds.toFixed(0)}s)`,
        estimatedBandwidth: bw,
      }
    }

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
