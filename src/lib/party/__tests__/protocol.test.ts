import assert from "node:assert"
import { test, describe } from "node:test"
import { predictedPosition, DRIFT_THRESHOLDS, type PartyState } from "../protocol"

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
    assert.strictEqual(DRIFT_THRESHOLDS.MICRO_UPPER, 0.75)
  })
})
