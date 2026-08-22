/**
 * hls.js configuration for the Jellyfin HLS engine (issues 1.2 / 4.5).
 * Pure data — unit-tested in isolation so the buffer caps and Jellyfin
 * transcode-warmup timeouts stay guarded.
 */

export type HlsConfigInput = {
  /** Position to start playback at (-1 = live/start). */
  startPosition: number
  /** Coarse-pointer device (mobile): tighter memory cap. */
  isTouchDevice: boolean
  /** Measured/known capacity seed (Phase 2 network scan) in bits/second —
   *  replaces the optimistic hardcoded default for ABR's initial guess. */
  initialBandwidthBps?: number
}

/**
 * Load policies tuned for a Jellyfin origin whose endpoints block while the
 * transcoder works:
 * - master.m3u8 spawns ffmpeg before responding → generous TTFB.
 * - variant playlists can wait for the first segments → generous TTFB.
 * - segments are produced on demand (worst right after startTimeTicks seeks)
 *   → very generous TTFB; aborting early makes Jellyfin restart ffmpeg for
 *   every retry, turning one slow segment into an endless stall.
 *
 * Replaces the deprecated `*LoadingTimeOut` / `*MaxRetry` / `*RetryDelay`
 * keys (hls.js ≥1.4).
 */
export function buildHlsConfig({ startPosition, isTouchDevice, initialBandwidthBps }: HlsConfigInput) {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    capLevelToPlayerSize: false,
    // Phase 2 — seed hls.js' initial bandwidth estimate from the network scan
    // when available; the previous hardcoded 25 Mbps was pure optimism and
    // pushed slow connections into an immediate top-level stall.
    abrEwmaDefaultEstimate:
      initialBandwidthBps != null && Number.isFinite(initialBandwidthBps) && initialBandwidthBps > 0
        ? Math.round(initialBandwidthBps)
        : 25_000_000,
    backBufferLength: 60,
    maxBufferLength: 40,
    // 4.5 — cap the buffer ceiling: hls.js' 600s default allows ~1.5GB of
    // buffered 4K@20Mbps video in memory (OOM on mobile). Mobile gets a
    // tighter cap; both stay above maxBufferLength (hls.js requirement).
    maxMaxBufferLength: isTouchDevice ? 60 : 120,
    startPosition,
    manifestLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 20_000,
        maxLoadTimeMs: 25_000,
        timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1_500, maxRetryDelayMs: 8_000 },
        errorRetry: { maxNumRetry: 2, retryDelayMs: 1_500, maxRetryDelayMs: 8_000 },
      },
    },
    playlistLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 20_000,
        maxLoadTimeMs: 30_000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1_500, maxRetryDelayMs: 8_000 },
        errorRetry: { maxNumRetry: 4, retryDelayMs: 1_500, maxRetryDelayMs: 8_000 },
      },
    },
    fragLoadPolicy: {
      default: {
        maxTimeToFirstByteMs: 60_000,
        maxLoadTimeMs: 120_000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 0, maxRetryDelayMs: 0 },
        errorRetry: { maxNumRetry: 6, retryDelayMs: 2_000, maxRetryDelayMs: 16_000 },
      },
    },
  }
}
