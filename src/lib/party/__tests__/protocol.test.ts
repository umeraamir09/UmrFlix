import assert from "node:assert"
import { test, describe } from "node:test"
import {
  predictedPosition,
  DRIFT_THRESHOLDS,
  sanitizePartyCommand,
  isValidPositionSec,
  isValidPlaybackRate,
  type PartyState,
} from "../protocol"

describe("Party Sync Protocol Math", () => {
  test("predictedPosition calculates exact playhead based on elapsed time", () => {
    const updatedAt = Date.now() - 5000 // 5 seconds ago
    const state: PartyState = {
      itemId: "item_123",
      playing: true,
      positionSec: 10.0,
      updatedAt,
      playbackRate: 1.0,
      version: 1,
    }

    const currentServerNow = updatedAt + 5000
    const predicted = predictedPosition(state, currentServerNow)
    assert.strictEqual(Math.round(predicted), 15)
  })

  test("predictedPosition returns static position when paused", () => {
    const updatedAt = Date.now() - 10000
    const state: PartyState = {
      itemId: "item_123",
      playing: false,
      positionSec: 42.5,
      updatedAt,
      playbackRate: 1.0,
      version: 2,
    }

    const predicted = predictedPosition(state, Date.now())
    assert.strictEqual(predicted, 42.5)
  })

  test("predictedPosition accounts for custom playback rates", () => {
    const updatedAt = Date.now() - 4000 // 4 seconds ago
    const state: PartyState = {
      itemId: "item_123",
      playing: true,
      positionSec: 10.0,
      updatedAt,
      playbackRate: 1.5, // 1.5x speed -> +6s
      version: 3,
    }

    const currentServerNow = updatedAt + 4000
    const predicted = predictedPosition(state, currentServerNow)
    assert.strictEqual(predicted, 16.0)
  })

  test("drift thresholds are properly structured", () => {
    assert.strictEqual(DRIFT_THRESHOLDS.MICRO_LOWER, 0.15)
    assert.strictEqual(DRIFT_THRESHOLDS.MICRO_UPPER, 0.35)
  })

  test("isValidPositionSec rejects NaN, Infinity, negatives and out-of-bound values", () => {
    assert.strictEqual(isValidPositionSec(12.5), true)
    assert.strictEqual(isValidPositionSec(0), true)
    assert.strictEqual(isValidPositionSec(NaN), false)
    assert.strictEqual(isValidPositionSec(Infinity), false)
    assert.strictEqual(isValidPositionSec(-1), false)
    assert.strictEqual(isValidPositionSec(25 * 60 * 60), false)
    assert.strictEqual(isValidPositionSec("12"), false)
  })

  test("isValidPlaybackRate enforces the UI whitelist", () => {
    for (const rate of [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]) {
      assert.strictEqual(isValidPlaybackRate(rate), true)
    }
    assert.strictEqual(isValidPlaybackRate(1.1), false)
    assert.strictEqual(isValidPlaybackRate(0), false)
    assert.strictEqual(isValidPlaybackRate(4), false)
    assert.strictEqual(isValidPlaybackRate("1"), false)
  })

  test("sanitizePartyCommand accepts well-formed commands", () => {
    const cmd = sanitizePartyCommand({
      type: "seek",
      positionSec: 42,
      clientId: "tab_abc",
      commandId: "cmd_1",
    })
    assert.ok(cmd)
    assert.strictEqual(cmd.type, "seek")
    assert.strictEqual(cmd.positionSec, 42)
  })

  test("sanitizePartyCommand rejects poisoned payloads", () => {
    assert.strictEqual(
      sanitizePartyCommand({ type: "seek", positionSec: NaN, clientId: "t", commandId: "c" }),
      null
    )
    assert.strictEqual(
      sanitizePartyCommand({ type: "rate", playbackRate: 99, clientId: "t", commandId: "c" }),
      null
    )
    assert.strictEqual(
      sanitizePartyCommand({ type: "explode", clientId: "t", commandId: "c" }),
      null
    )
    assert.strictEqual(sanitizePartyCommand({ type: "play", commandId: "c" }), null)
    assert.strictEqual(sanitizePartyCommand(null), null)
    assert.strictEqual(sanitizePartyCommand("play"), null)
  })
})
