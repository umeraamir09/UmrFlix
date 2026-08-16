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

  it("preserves the Jellyfin transcode-warmup timeout tuning", () => {
    const config = buildHlsConfig({ startPosition: -1, isTouchDevice: false })
    assert.strictEqual(config.fragLoadingTimeOut, 60_000)
    assert.strictEqual(config.manifestLoadingTimeOut, 20_000)
    assert.strictEqual(config.levelLoadingTimeOut, 20_000)
    assert.strictEqual(config.fragLoadingMaxRetry, 6)
    assert.strictEqual(config.fragLoadingRetryDelay, 2_000)
  })
})
