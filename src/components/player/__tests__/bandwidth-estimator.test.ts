import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BandwidthEstimator, type QualitySuggestionInput } from "../bandwidth-estimator"

/**
 * Deterministic-clock estimator: cooldown/hysteresis windows are driven by
 * `now()` so tests don't have to sleep.
 */
class FakeClockEstimator extends BandwidthEstimator {
  private fakeNow = Date.now()

  advance(ms: number) {
    this.fakeNow += ms
  }

  protected now(): number {
    return this.fakeNow
  }
}

function seedSamples(est: BandwidthEstimator, bps: number, count = 8) {
  for (let i = 0; i < count; i++) est.addSample(bps)
}

function baseInput(overrides: Partial<QualitySuggestionInput> = {}): QualitySuggestionInput {
  return {
    currentTargetBps: 5_000_000,
    isInitial: false,
    bufferAheadSeconds: 20,
    ...overrides,
  }
}

describe("BandwidthEstimator Phase 3 — continuous targeting", () => {
  it("holds while still gathering samples (<6)", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 10_000_000, 3)
    const s = est.suggest(baseInput())
    assert.strictEqual(s.action, "hold")
    assert.match(s.reason, /gathering data/)
  })

  it("gives the initial scan cap a grace period on a healthy buffer", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 2_000_000) // bw says downgrade…
    const s = est.suggest(baseInput({ isInitial: true, bufferAheadSeconds: 12 }))
    assert.strictEqual(s.action, "hold")
    assert.match(s.reason, /initial scan cap/)
  })

  it("resolves down when the initial cap clearly isn't working out", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 2_000_000)
    const s = est.suggest(
      baseInput({ isInitial: true, bufferAheadSeconds: 3, sourceBitrate: 15_000_000 }),
    )
    assert.strictEqual(s.action, "resolve")
    // fitHold = floor(2M × 0.8 / 50k) = 1.6M
    assert.strictEqual(s.targetBitrateBps, 1_600_000)
  })

  it("emergency (stall + critical buffer) jumps straight to a conservative fit", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 3_000_000)
    const s = est.suggest(
      baseInput({ currentTargetBps: 10_000_000, bufferAheadSeconds: 2, urgent: true }),
    )
    assert.strictEqual(s.action, "downgrade")
    // floor(3M × 0.55 / 50k) × 50k = 1.65M
    assert.strictEqual(s.targetBitrateBps, 1_650_000)
    assert.match(s.reason, /critically low/)
  })

  it("emergency has an anti-spam cooldown", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 3_000_000)
    const input = baseInput({ currentTargetBps: 10_000_000, bufferAheadSeconds: 2, urgent: true })
    assert.strictEqual(est.suggest(input).action, "downgrade")
    est.advance(1_000)
    assert.strictEqual(est.suggest(input).action, "hold")
    est.advance(4_000)
    assert.strictEqual(est.suggest(input).action, "downgrade")
  })

  it("upgrades after 2 consecutive stable checks with deep buffer", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 10_000_000)
    const first = est.suggest(baseInput({ currentTargetBps: 5_000_000 }))
    assert.strictEqual(first.action, "hold")
    assert.match(first.reason, /pending stability \(1\/2\)/)
    const second = est.suggest(baseInput({ currentTargetBps: 5_000_000 }))
    assert.strictEqual(second.action, "upgrade")
    // floor(10M × 0.65 / 50k) × 50k = 6.5M
    assert.strictEqual(second.targetBitrateBps, 6_500_000)
  })

  it("encode-ratio lets upgrades happen sooner when Jellyfin encodes below cap", () => {
    // Same bandwidth, no actual-level knowledge → no upgrade (candidate 8.45M
    // is under the +12% switch threshold above 10M… and actually below it).
    const plain = new FakeClockEstimator()
    seedSamples(plain, 13_000_000)
    const plainS = plain.suggest(baseInput({ currentTargetBps: 10_000_000 }))
    assert.strictEqual(plainS.action, "hold")

    // Knowing the stream really encodes at 3M → ratio clamps to 0.5 →
    // upFactor 0.95 → candidate floor(13×0.95)=12.35M > 10M×1.12 ✓
    const informed = new FakeClockEstimator()
    seedSamples(informed, 13_000_000)
    informed.suggest(baseInput({ currentTargetBps: 10_000_000, actualStreamBitrate: 3_000_000 }))
    const s = informed.suggest(
      baseInput({ currentTargetBps: 10_000_000, actualStreamBitrate: 3_000_000 }),
    )
    assert.strictEqual(s.action, "upgrade")
    assert.strictEqual(s.targetBitrateBps, 12_350_000)
  })

  it("switch thresholds hold steady inside the hysteresis band", () => {
    const est = new FakeClockEstimator()
    // 5.3M on a 5M target: holdFit 4.24M ≥ 5M×0.82=4.1M (no downgrade);
    // upgrade candidate 3.45M < 5.6M (no upgrade).
    seedSamples(est, 5_300_000)
    for (let i = 0; i < 4; i++) {
      const s = est.suggest(baseInput({ currentTargetBps: 5_000_000 }))
      assert.strictEqual(s.action, "hold")
      assert.strictEqual(s.reason, "stable")
      est.advance(2_000)
    }
  })

  it("normal downgrade respects post-upgrade hysteresis then fires", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, 10_000_000)
    est.suggest(baseInput({ currentTargetBps: 5_000_000 }))
    est.advance(16_000) // clear upgrade cooldown
    const up = est.suggest(baseInput({ currentTargetBps: 5_000_000 }))
    assert.strictEqual(up.action, "upgrade")

    // Capacity collapses; buffer stays healthy so the emergency path doesn't
    // mask the hysteresis window.
    est.advance(1_000)
    seedSamples(est, 2_000_000, 40)
    const held = est.suggest(baseInput({ currentTargetBps: 6_500_000, bufferAheadSeconds: 15 }))
    assert.strictEqual(held.action, "hold")
    assert.match(held.reason, /hysteresis/)

    est.advance(21_000)
    const down = est.suggest(baseInput({ currentTargetBps: 6_500_000, bufferAheadSeconds: 15 }))
    assert.strictEqual(down.action, "downgrade")
    // floor(2M × 0.8 / 50k) × 50k = 1.6M
    assert.strictEqual(down.targetBitrateBps, 1_600_000)
  })

  it("never emits targets above the source ceiling", () => {
    const est = new FakeClockEstimator()
    // Source 1M → ceiling 1.2M; even with 3M measured, the downgrade target
    // must clamp there.
    seedSamples(est, 3_000_000)
    const s = est.suggest(
      baseInput({ currentTargetBps: 5_000_000, bufferAheadSeconds: 15, sourceBitrate: 1_000_000 }),
    )
    assert.strictEqual(s.action, "downgrade")
    assert.strictEqual(s.targetBitrateBps, 1_200_000)
  })

  it("data-saver forces a modest target", () => {
    class DataSaverEstimator extends FakeClockEstimator {
      protected getConnectionInfo() {
        return { saveData: true }
      }
    }
    const est = new DataSaverEstimator()
    seedSamples(est, 50_000_000)
    const s = est.suggest(baseInput({ currentTargetBps: 10_000_000 }))
    assert.strictEqual(s.action, "downgrade")
    assert.strictEqual(s.targetBitrateBps, 1_500_000)
    // Already at/below the saver target → hold.
    const held = est.suggest(baseInput({ currentTargetBps: 1_400_000 }))
    assert.strictEqual(held.action, "hold")
  })
})
