import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { findActiveCues, type VttCue } from "../vtt"

function cue(start: number, end: number, id?: string): VttCue {
  return { id: id ?? `${start}-${end}`, start, end, text: `cue ${id ?? start}` }
}

/** Non-overlapping film-like track: 1500 cues of 4s at 4s spacing. */
function filmTrack(count = 1500): VttCue[] {
  return Array.from({ length: count }, (_, i) => cue(i * 4, i * 4 + 3.5, `cue${i}`))
}

function bruteForce(cues: VttCue[], time: number): VttCue[] {
  return cues.filter((c) => time >= c.start && time < c.end)
}

describe("findActiveCues (issue 4.2 — O(n) linear scan)", () => {
  it("returns [] for empty input", () => {
    assert.deepEqual(findActiveCues([], 10), [])
  })

  it("returns [] before the first cue and after the last cue", () => {
    const cues = filmTrack(10)
    assert.deepEqual(findActiveCues(cues, -1), [])
    assert.deepEqual(findActiveCues(cues, -0.01), [])
    assert.deepEqual(findActiveCues(cues, 40), [])
    assert.deepEqual(findActiveCues(cues, 10_000), [])
  })

  it("includes a cue at its start boundary and excludes it at its end boundary", () => {
    const cues = filmTrack(10)
    assert.deepEqual(findActiveCues(cues, 4), [cues[1]])
    assert.deepEqual(findActiveCues(cues, 7.5), [])
  })

  it("finds the single active cue in the middle of a long track", () => {
    const cues = filmTrack(1500)
    const t = 60 * 60 + 2 // 1h00m02s → cue 900 spans [3600, 3603.5)
    assert.deepEqual(findActiveCues(cues, t), [cues[900]])
  })

  it("returns all overlapping cues in ascending file order", () => {
    const cues = [
      cue(0, 10, "a"),
      cue(2, 8, "b"),
      cue(4, 12, "c"),
      cue(20, 30, "d"),
    ]
    assert.deepEqual(findActiveCues(cues, 5), [cues[0], cues[1], cues[2]])
    assert.deepEqual(findActiveCues(cues, 6.5), [cues[0], cues[1], cues[2]])
    assert.deepEqual(findActiveCues(cues, 9), [cues[0], cues[2]])
    assert.deepEqual(findActiveCues(cues, 25), [cues[3]])
  })

  it("finds an old cue still active beyond the bounded scan window", () => {
    // One long cue (index 0) with 40 short cues stacked on top — the 32-cue
    // backward window ends inside the shorts, so only the prefix-max probe
    // can recover the long cue.
    const long = cue(0, 100, "long")
    const shorts = Array.from({ length: 40 }, (_, i) => cue(i + 1, i + 2, `s${i}`))
    const cues = [long, ...shorts]
    for (const t of [1.5, 10, 50, 99]) {
      assert.deepEqual(findActiveCues(cues, t), bruteForce(cues, t))
    }
  })

  it("collects every still-active cue beyond the window, in file order", () => {
    // Two long cues plus 40 shorts: the probe fires and the fallback must
    // recover BOTH long cues, not just the one that triggered the probe.
    const longs = [cue(0, 100, "a"), cue(1, 99, "b")]
    const shorts = Array.from({ length: 40 }, (_, i) => cue(i + 2, i + 3, `s${i}`))
    const cues = [...longs, ...shorts]
    assert.deepEqual(findActiveCues(cues, 50), bruteForce(cues, 50))
    assert.deepEqual(findActiveCues(cues, 98), bruteForce(cues, 98))
  })

  it("agrees with the brute-force filter on random sorted tracks", () => {
    // Seeded RNG for determinism
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let trial = 0; trial < 25; trial++) {
      const cues: VttCue[] = []
      let t = 0
      const n = 50 + Math.floor(rand() * 200)
      for (let i = 0; i < n; i++) {
        const start = t + rand() * 2 // sometimes overlaps the previous cue
        const end = start + 1 + rand() * 4
        cues.push(cue(start, end, `r${trial}-${i}`))
        t = end - 0.5
      }
      cues.sort((a, b) => a.start - b.start)
      for (let k = 0; k < 30; k++) {
        const time = rand() * (cues[n - 1].end + 2)
        assert.deepEqual(findActiveCues(cues, time), bruteForce(cues, time))
      }
    }
  })

  it("uses binary search and a bounded scan per query, not a linear scan (perf guard)", () => {
    const cues = filmTrack(1500)
    // Wrap in a Proxy that counts property reads on cue objects
    let startReads = 0
    let endReads = 0
    const counted = new Proxy(cues, {
      get(target, prop, receiver) {
        if (prop === "start") startReads++
        if (prop === "end") endReads++
        return Reflect.get(target, prop, receiver)
      },
    })

    findActiveCues(counted, 10) // warm the prefix-max cache (one O(n) pass)
    startReads = 0
    endReads = 0

    // Probe deep into the track (worst-case linear-scan territory)
    const t = 60 * 60 * 2 - 1 // 1h59m59s → last cue region
    findActiveCues(counted, t)

    // Binary search reads start ~log2(1500)≈11 times; the old filter would
    // have read `start` on all 1500 elements. The bounded overlap scan reads
    // `end` at most MAX_OVERLAP_SCAN (32) times; the prefix-max probe reads a
    // cached Float64Array, not cue properties.
    assert.ok(
      startReads <= 20,
      `expected ~log2(n) start reads, got ${startReads} (linear scan regression?)`,
    )
    assert.ok(
      endReads <= 32,
      `expected bounded overlap scan, got ${endReads} end reads`,
    )
  })
})
