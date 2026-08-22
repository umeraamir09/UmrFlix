import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { buildHlsConfig } from "../hls-config"

describe("buildHlsConfig (issue 4.5 — maxMaxBufferLength cap)", () => {
  it("caps the buffer ceiling at 120s on desktop", () => {
    const config = buildHlsConfig({ startPosition: -1, isTouchDevice: false })
    assert.strictEqual(config.maxMaxBufferLength, 120)
  })

  it("caps the buffer ceiling at 60s on touch devices", () => {
    const config = buildHlsConfig({ startPosition: -1, isTouchDevice: true })
    assert.strictEqual(config.maxMaxBufferLength, 60)
  })

  it("keeps maxMaxBufferLength above maxBufferLength (hls.js invariant)", () => {
    for (const isTouchDevice of [true, false]) {
      const config = buildHlsConfig({ startPosition: -1, isTouchDevice })
      assert.ok(
        config.maxMaxBufferLength > config.maxBufferLength,
        `maxMaxBufferLength (${config.maxMaxBufferLength}) must exceed maxBufferLength (${config.maxBufferLength})`,
      )
    }
  })

  it("passes through startPosition for position restore", () => {
    assert.strictEqual(
      buildHlsConfig({ startPosition: 1234.5, isTouchDevice: false }).startPosition,
      1234.5,
    )
    assert.strictEqual(
      buildHlsConfig({ startPosition: -1, isTouchDevice: false }).startPosition,
      -1,
    )
  })

  it("preserves the Jellyfin transcode-warmup budgets via LoadPolicies", () => {
    const config = buildHlsConfig({ startPosition: -1, isTouchDevice: false })
    // master.m3u8 spawns ffmpeg before responding.
    assert.strictEqual(config.manifestLoadPolicy.default.maxTimeToFirstByteMs, 20_000)
    assert.strictEqual(config.manifestLoadPolicy.default.timeoutRetry.maxNumRetry, 2)
    // Variant playlists can wait for the first segments.
    assert.strictEqual(config.playlistLoadPolicy.default.maxTimeToFirstByteMs, 20_000)
    assert.strictEqual(config.playlistLoadPolicy.default.errorRetry.maxNumRetry, 4)
    // Segments are produced on demand — aborting early restarts ffmpeg.
    assert.strictEqual(config.fragLoadPolicy.default.maxTimeToFirstByteMs, 60_000)
    assert.strictEqual(config.fragLoadPolicy.default.errorRetry.maxNumRetry, 6)
    assert.strictEqual(config.fragLoadPolicy.default.errorRetry.retryDelayMs, 2_000)
  })
})

describe("buildHlsConfig (Phase 2 — network scan seed)", () => {
  it("seeds abrEwmaDefaultEstimate from the measured bandwidth", () => {
    const config = buildHlsConfig({
      startPosition: -1,
      isTouchDevice: false,
      initialBandwidthBps: 8_450_000,
    })
    assert.strictEqual(config.abrEwmaDefaultEstimate, 8_450_000)
  })

  it("falls back to the legacy default when no seed is provided or the seed is invalid", () => {
    assert.strictEqual(
      buildHlsConfig({ startPosition: -1, isTouchDevice: false }).abrEwmaDefaultEstimate,
      25_000_000,
    )
    for (const bad of [Number.NaN, 0, -1_000]) {
      assert.strictEqual(
        buildHlsConfig({ startPosition: -1, isTouchDevice: false, initialBandwidthBps: bad })
          .abrEwmaDefaultEstimate,
        25_000_000,
      )
    }
  })
})
