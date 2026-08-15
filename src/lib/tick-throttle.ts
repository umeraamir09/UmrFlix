/**
 * Rate limiter for high-frequency event-driven state (issue 4.1).
 *
 * Browser `timeupdate` events can fire anywhere from 66ms to 250ms apart.
 * A `createThrottledClock(250)` guarantees at most one `update() === true`
 * per 250ms window so UI state mirrors high-frequency media events at a
 * bounded rate (≤4 renders/sec) instead of on every tick.
 */
export function createThrottledClock(minIntervalMs: number) {
  let lastEmitAt = -Infinity

  return {
    /** Returns true when `now` is at least `minIntervalMs` after the last true. */
    update(now: number): boolean {
      if (now - lastEmitAt < minIntervalMs) return false
      lastEmitAt = now
      return true
    },
    /** Allow the next `update()` to pass immediately (item/reset boundaries). */
    reset() {
      lastEmitAt = -Infinity
    },
  }
}
