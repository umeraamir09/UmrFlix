import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { withStartTimeTicks } from "../url-utils"

describe("withStartTimeTicks — position-aware transcode URLs", () => {
  it("appends startTimeTicks in both casing variants with correct tick conversion", () => {
    const out = withStartTimeTicks("/api/jellyfin/proxy/Videos/abc/master.m3u8?segmentContainer=fmp4", 600)
    const parsed = new URL(out, "http://localhost")
    // 600s × 10_000_000 ticks/s = 6_000_000_000 ticks
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "6000000000")
    assert.strictEqual(parsed.searchParams.get("StartTimeTicks"), "6000000000")
    assert.strictEqual(parsed.searchParams.get("segmentContainer"), "fmp4")
    assert.strictEqual(parsed.pathname, "/api/jellyfin/proxy/Videos/abc/master.m3u8")
  })

  it("preserves all other query parameters", () => {
    const base = "/proxy/master.m3u8?mediaSourceId=ms1&PlaySessionId=s1_q_fhd&maxStreamingBitrate=10000000"
    const out = withStartTimeTicks(base, 1234.5)
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("mediaSourceId"), "ms1")
    assert.strictEqual(parsed.searchParams.get("PlaySessionId"), "s1_q_fhd")
    assert.strictEqual(parsed.searchParams.get("maxStreamingBitrate"), "10000000")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "12345000000")
  })

  it("handles URLs that have no query string yet", () => {
    const out = withStartTimeTicks("/proxy/main.m3u8", 30)
    assert.ok(out.includes("/proxy/main.m3u8?"))
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "300000000")
  })

  it("works with absolute URLs", () => {
    const out = withStartTimeTicks("https://jf.example.com/Videos/abc/main.m3u8?a=1", 90)
    assert.ok(out.startsWith("https://jf.example.com/"))
    const parsed = new URL(out)
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "900000000")
  })

  it("returns the URL unchanged for zero, negative, NaN, or infinite positions", () => {
    const base = "/proxy/master.m3u8?x=1"
    for (const pos of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.strictEqual(withStartTimeTicks(base, pos), base)
    }
  })

  it("returns the URL unchanged for empty URLs", () => {
    assert.strictEqual(withStartTimeTicks("", 120), "")
  })

  it("replaces pre-existing offsets instead of duplicating them", () => {
    const base =
      "/proxy/master.m3u8?startTimeTicks=1111111&StartTimeTicks=2222222&x=keep"
    const out = withStartTimeTicks(base, 45)
    const parsed = new URL(out, "http://localhost")
    // URLSearchParams.set replaces every entry of the same name — both casing
    // variants must end up with the new value and no stale duplicates.
    assert.strictEqual(parsed.searchParams.getAll("startTimeTicks").join(","), "450000000")
    assert.strictEqual(parsed.searchParams.getAll("StartTimeTicks").join(","), "450000000")
    assert.strictEqual(parsed.searchParams.get("x"), "keep")
  })

  it("clamps positions that overshoot the runtime to just before the end", () => {
    // runtime 1800s, requested 1799.9s → clamp to 1799.5s
    const out = withStartTimeTicks("/proxy/master.m3u8", 1799.9, 1800)
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), String(Math.round(1799.5 * 10_000_000)))
  })

  it("clamps when the position is beyond the runtime entirely", () => {
    const out = withStartTimeTicks("/proxy/master.m3u8", 5000, 1800)
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), String(Math.round(1799.5 * 10_000_000)))
  })

  it("does not clamp when the runtime is unknown (0 / NaN)", () => {
    const out = withStartTimeTicks("/proxy/master.m3u8", 7200, 0)
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "72000000000")

    const out2 = withStartTimeTicks("/proxy/master.m3u8", 7200, Number.NaN)
    const parsed2 = new URL(out2, "http://localhost")
    assert.strictEqual(parsed2.searchParams.get("startTimeTicks"), "72000000000")
  })

  it("rounds fractional seconds to whole ticks without precision loss", () => {
    const out = withStartTimeTicks("/proxy/master.m3u8", 0.1)
    const parsed = new URL(out, "http://localhost")
    assert.strictEqual(parsed.searchParams.get("startTimeTicks"), "1000000")
  })
})
