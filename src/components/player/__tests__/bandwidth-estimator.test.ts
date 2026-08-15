import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { BandwidthEstimator, type QualitySuggestion } from "../bandwidth-estimator"

/**
 * Deterministic-clock estimator: cooldown/hysteresis windows (20s/30s) are
 * driven by `now()` so tests don't have to sleep.
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

// QUALITY_PRESETS (bitrate-ascending after filtering): sd=1.5M, hd=4M, fhd=10M, uhd=20M
const UPGRADE_FROM = "hd" // 4 Mbps
const UPGRADE_TO = "fhd" // 10 Mbps — needs bw >= 10M * 1.5 = 15M
const UPGRADE_BW = 16_000_000 // safe = 13.6M → fits fhd only

function seedSamples(est: BandwidthEstimator, bps: number, count = 8) {
  for (let i = 0; i < count; i++) est.addSample(bps)
}

describe("BandwidthEstimator ABR (issue 3.7 — oscillation)", () => {
  it("requires 3 consecutive checks before upgrading (was 2)", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, UPGRADE_BW)

    const first = est.suggest(UPGRADE_FROM, 30)
    assert.strictEqual(first.action, "hold")
    assert.match(first.reason, /pending stability \(1\/3\)/)

    const second = est.suggest(UPGRADE_FROM, 30)
    assert.strictEqual(second.action, "hold")
    assert.match(second.reason, /pending stability \(2\/3\)/)

    const third = est.suggest(UPGRADE_FROM, 30)
    assert.strictEqual(third.action, "upgrade")
    assert.strictEqual(third.targetPresetId, UPGRADE_TO)
  })

  it("never upgrades below the 1.5x margin (burst spike at 1.4x)", () => {
    const est = new FakeClockEstimator()
    // 14 Mbps < fhd(10M) * 1.5 → upgrade condition must never fire
    seedSamples(est, 14_000_000)

    for (let i = 0; i < 3; i++) {
      const s = est.suggest(UPGRADE_FROM, 30)
      assert.notStrictEqual(s.action, "upgrade")
    }
    const final = est.suggest(UPGRADE_FROM, 30)
    assert.strictEqual(final.action, "hold")
    assert.strictEqual(final.reason, "stable")
  })

  it("imposes a 30s post-upgrade hysteresis before allowing a downgrade", () => {
    const est = new FakeClockEstimator()
    seedSamples(est, UPGRADE_BW)

    let s: QualitySuggestion = est.suggest(UPGRADE_FROM, 30)
    s = est.suggest(UPGRADE_FROM, 30)
    s = est.suggest(UPGRADE_FROM, 30)
    assert.strictEqual(s.action, "upgrade")
    assert.strictEqual(s.targetPresetId, UPGRADE_TO)

    // Bandwidth collapses right after the upgrade; buffer still healthy so the
    // emergency path doesn't mask the hysteresis window.
    est.advance(1_000)
    seedSamples(est, 2_000_000, 40)

    // Inside the 30s window → downgrade must be held
    const held = est.suggest(UPGRADE_TO, 10)
    assert.strictEqual(held.action, "hold")
    assert.match(held.reason, /hysteresis/)

    // After the window → downgrade fires
    est.advance(31_000)
    const downgrade = est.suggest(UPGRADE_TO, 10)
    assert.strictEqual(downgrade.action, "downgrade")
    assert.strictEqual(downgrade.targetPresetId, "sd")
  })
})
