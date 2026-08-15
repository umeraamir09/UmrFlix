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
}

export function buildHlsConfig({ startPosition, isTouchDevice }: HlsConfigInput) {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    capLevelToPlayerSize: false,
    abrEwmaDefaultEstimate: 25_000_000,
    backBufferLength: 60,
    maxBufferLength: 40,
    // 4.5 — cap the buffer ceiling: hls.js' 600s default allows ~1.5GB of
    // buffered 4K@20Mbps video in memory (OOM on mobile). Mobile gets a
    // tighter cap; both stay above maxBufferLength (hls.js requirement).
    maxMaxBufferLength: isTouchDevice ? 60 : 120,
    startPosition,
    // Jellyfin transcoders can take 30-60s to emit the first segment —
    // hls.js' 20s default frag timeout aborts the request too early and
    // the server has to restart ffmpeg for every retry (endless stall).
    manifestLoadingTimeOut: 20_000,
    manifestLoadingMaxRetry: 2,
    levelLoadingTimeOut: 20_000,
    levelLoadingMaxRetry: 4,
    fragLoadingTimeOut: 60_000,
    fragLoadingMaxRetry: 6,
    fragLoadingRetryDelay: 2_000,
    levelLoadingRetryDelay: 1_500,
    manifestLoadingRetryDelay: 1_500,
  }
}
