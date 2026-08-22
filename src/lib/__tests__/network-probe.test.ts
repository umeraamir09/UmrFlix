import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  combineBandwidthEstimates,
  initialAutoCapBps,
  probeThroughput,
  shouldPreferTranscodeForBandwidth,
} from "../network-probe"

function streamFromChunks(chunks: Uint8Array[], gapMs = 0): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (chunks.length === 0) {
        controller.close()
        return
      }
      const c = chunks.shift()!
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs))
      controller.enqueue(c)
    },
  })
}

describe("combineBandwidthEstimates (Phase 2 — signal combination)", () => {
  it("a fresh probe wins outright even when other signals are higher", () => {
    const out = combineBandwidthEstimates({ probed: 8_000_000, connection: 50_000_000, persisted: 40_000_000 })
    assert.deepEqual(out, { bps: 8_000_000, sources: ["probe"] })
  })

  it("without a probe, takes the most conservative of connection/persisted", () => {
    const out = combineBandwidthEstimates({ connection: 25_000_000, persisted: 6_000_000 })
    assert.deepEqual(out, { bps: 6_000_000, sources: ["connection", "persisted"] })
  })

  it("works with a single signal", () => {
    assert.deepEqual(combineBandwidthEstimates({ connection: 10_000_000 }), {
      bps: 10_000_000,
      sources: ["connection"],
    })
    assert.deepEqual(combineBandwidthEstimates({ persisted: 4_000_000 }), {
      bps: 4_000_000,
      sources: ["persisted"],
    })
  })

  it("returns null when no valid signal exists", () => {
    assert.strictEqual(combineBandwidthEstimates({}), null)
    assert.strictEqual(combineBandwidthEstimates({ probed: 0, connection: -5, persisted: Number.NaN }), null)
  })
})

describe("initialAutoCapBps (Phase 2 — startup quality cap)", () => {
  it("falls back to legacy source×1.2 behavior without an estimate", () => {
    assert.strictEqual(initialAutoCapBps(null, 15_000_000), Math.round(15_000_000 * 1.2))
    assert.strictEqual(initialAutoCapBps(null, 200_000_000), 120_000_000)
    // Unknown source bitrate → uncapped ceiling.
    assert.strictEqual(initialAutoCapBps(null, 0), 120_000_000)
  })

  it("applies the 80% safety factor to the estimate", () => {
    assert.strictEqual(initialAutoCapBps(10_000_000, 0), 8_000_000)
  })

  it("clamps to the minimum watchable floor on very slow links", () => {
    assert.strictEqual(initialAutoCapBps(100_000, 0), 400_000)
  })

  it("never asks for more than the source needs", () => {
    // 50 Mbps link, 4 Mbps source → cap at source×1.2 = 4.8 Mbps
    assert.strictEqual(initialAutoCapBps(50_000_000, 4_000_000), 4_800_000)
  })
})

describe("shouldPreferTranscodeForBandwidth (Phase 2 — direct-play guard)", () => {
  it("blocks direct play when the source exceeds estimated capacity with headroom", () => {
    assert.equal(shouldPreferTranscodeForBandwidth(10_000_000, 20_000_000), true)
  })

  it("allows direct play when capacity covers the source", () => {
    assert.equal(shouldPreferTranscodeForBandwidth(30_000_000, 20_000_000), false)
    // Exactly at the headroom boundary → still allowed (strict >).
    assert.equal(shouldPreferTranscodeForBandwidth(20_000_000 / 1.15, 20_000_000), false)
  })

  it("never blocks on unknown data", () => {
    assert.equal(shouldPreferTranscodeForBandwidth(null, 20_000_000), false)
    assert.equal(shouldPreferTranscodeForBandwidth(undefined, 20_000_000), false)
    assert.equal(shouldPreferTranscodeForBandwidth(10_000_000, undefined), false)
    assert.equal(shouldPreferTranscodeForBandwidth(10_000_000, 0), false)
  })
})

describe("probeThroughput (browser glue, injected fetch)", () => {
  it("measures throughput over the full response body", async () => {
    const chunk = new Uint8Array(300_000).fill(7) // > 50KB trust threshold total
    const fetchImpl = (async () =>
      ({
        ok: true,
        body: streamFromChunks([chunk, chunk]),
      })) as unknown as typeof fetch
    const bps = await probeThroughput({ fetchImpl, deadlineMs: 5_000 })
    assert.ok(bps != null && bps > 0, `expected positive bps, got ${bps}`)
  })

  it("returns a partial sample when the deadline cuts the transfer short", async () => {
    const chunk = new Uint8Array(200_000).fill(9)
    const fetchImpl = (async () =>
      ({
        ok: true,
        body: streamFromChunks([chunk, chunk, chunk, chunk], 120),
      })) as unknown as typeof fetch
    const bps = await probeThroughput({ fetchImpl, deadlineMs: 150 })
    // At least one chunk arrived before the deadline.
    assert.ok(bps != null && bps > 0, `expected partial sample, got ${bps}`)
  })

  it("returns null on HTTP errors or missing body", async () => {
    const fail = (async () => ({ ok: false, body: null })) as unknown as typeof fetch
    assert.equal(await probeThroughput({ fetchImpl: fail }), null)
  })

  it("returns null when too little data arrives to be trustworthy", async () => {
    const tiny = new Uint8Array(1_000).fill(1)
    const fetchImpl = (async () =>
      ({ ok: true, body: streamFromChunks([tiny]) })) as unknown as typeof fetch
    assert.equal(await probeThroughput({ fetchImpl, deadlineMs: 1_000 }), null)
  })

  it("returns null when the fetch itself rejects", async () => {
    const boom = (async () => {
      throw new Error("offline")
    }) as unknown as typeof fetch
    assert.equal(await probeThroughput({ fetchImpl: boom }), null)
  })
})
