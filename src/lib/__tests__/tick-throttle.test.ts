import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { createThrottledClock } from "../tick-throttle"

describe("createThrottledClock (issue 4.1 — timeupdate re-render throttle)", () => {
  it("passes the first update immediately after creation", () => {
    const clock = createThrottledClock(250)
    assert.strictEqual(clock.update(1_000), true)
  })

  it("blocks updates inside the 250ms window and passes after it", () => {
    const clock = createThrottledClock(250)
    clock.update(1_000) // emits

    assert.strictEqual(clock.update(1_249), false)
    assert.strictEqual(clock.update(1_250), true) // exactly at the boundary
    assert.strictEqual(clock.update(1_251), false)
    assert.strictEqual(clock.update(1_500), true)
  })

  it("emits at most once per window under a burst of high-frequency ticks", () => {
    const clock = createThrottledClock(250)
    clock.update(0)

    let emissions = 0
    for (let now = 1; now <= 10_000; now += 66) {
      // worst-case browser timeupdate cadence (~15Hz)
      if (clock.update(now)) emissions++
    }
    // 10s of ticks at ≤1 emission per 250ms → at most 40
    assert.ok(emissions <= 40, `expected ≤40 emissions, got ${emissions}`)
  })

  it("reset() lets the next update pass immediately (item change)", () => {
    const clock = createThrottledClock(250)
    clock.update(1_000)
    assert.strictEqual(clock.update(1_100), false)

    clock.reset()
    assert.strictEqual(clock.update(1_100), true)
    assert.strictEqual(clock.update(1_100), false) // throttle re-engaged
  })
})
