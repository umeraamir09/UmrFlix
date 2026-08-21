import { test, describe } from "node:test"
import assert from "node:assert/strict"
import {
  recordRowImpression,
  getRowStats,
  recordRowFatigueImpression,
  resetRowFatigue,
  getRowFatigueMap,
} from "../store"
import { isRowSuppressed, FATIGUE_SUPPRESS_THRESHOLD } from "../ranking"

describe("Discovery Impression & Fatigue Tracking (R0-1)", () => {
  const userId = "test-user-r01"
  const profileId = "default"
  const rowKey = "micro-genre:28"

  test("recordRowImpression increments totalImpressions and records clicks", async () => {
    await recordRowImpression(rowKey)
    let stats = await getRowStats()
    assert.equal(stats.get(rowKey)?.totalImpressions, 1)
    assert.equal(stats.get(rowKey)?.totalClicks, 0)

    await recordRowImpression(rowKey, { clicked: true })
    stats = await getRowStats()
    assert.equal(stats.get(rowKey)?.totalImpressions, 2)
    assert.equal(stats.get(rowKey)?.totalClicks, 1)
  })

  test("recordRowFatigueImpression increments unclicked count and resets on click", async () => {
    // Record unclicked impressions up to threshold
    for (let i = 0; i < FATIGUE_SUPPRESS_THRESHOLD; i++) {
      await recordRowFatigueImpression(userId, profileId, rowKey)
    }

    let fatigueMap = await getRowFatigueMap(userId, profileId)
    const fatigue = fatigueMap.get(rowKey)
    assert.ok(fatigue)
    assert.equal(fatigue.unclickedImpressions, FATIGUE_SUPPRESS_THRESHOLD)
    assert.equal(isRowSuppressed(fatigue), true)

    // User clicks the row -> fatigue is reset
    await resetRowFatigue(userId, profileId, rowKey)
    fatigueMap = await getRowFatigueMap(userId, profileId)
    const resetFatigue = fatigueMap.get(rowKey)
    assert.ok(resetFatigue)
    assert.equal(resetFatigue.unclickedImpressions, 0)
    assert.equal(isRowSuppressed(resetFatigue), false)
  })
})
