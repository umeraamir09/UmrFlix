import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isHlsSegmentPath, stripSegmentOnlySearchParams } from "../url-utils"

describe("stripSegmentOnlySearchParams (Phase 1 regression guard)", () => {
  it("removes startTimeTicks in both casing variants", () => {
    const params = new URLSearchParams("startTimeTicks=3088893333&x=keep")
    params.set("StartTimeTicks", "3088893333")
    stripSegmentOnlySearchParams(params)
    assert.strictEqual(params.get("startTimeTicks"), null)
    assert.strictEqual(params.get("StartTimeTicks"), null)
    assert.strictEqual(params.get("x"), "keep")
  })

  it("matches case-insensitively (starttimeticks, STARTTIMETICKS)", () => {
    const params = new URLSearchParams("a=1&STARTTIMETICKS=t&StartTimeticks=t2")
    stripSegmentOnlySearchParams(params)
    assert.strictEqual(String(params), "a=1")
  })

  it("leaves unrelated params untouched", () => {
    const params = new URLSearchParams(
      "runtimeTicks=3060000000&actualSegmentLengthTicks=30000000&mediaSourceId=ms1",
    )
    const before = String(params)
    stripSegmentOnlySearchParams(params)
    assert.strictEqual(String(params), before)
  })
})

describe("isHlsSegmentPath", () => {
  it("matches Jellyfin HLS media and init segment paths", () => {
    assert.equal(
      isHlsSegmentPath("Videos/bf57/hls1/main/102.fmp4"),
      true,
    )
    assert.equal(isHlsSegmentPath("Videos/bf57/hls1/main/-1.mp4"), true)
    assert.equal(isHlsSegmentPath("Videos/bf57/hls1/main/5.ts"), true)
  })

  it("does NOT match playlist requests (they may carry the offset)", () => {
    assert.equal(isHlsSegmentPath("Videos/bf57/master.m3u8"), false)
    assert.equal(isHlsSegmentPath("Videos/bf57/main.m3u8"), false)
    assert.equal(isHlsSegmentPath("Videos/bf57/stream.mp4"), false)
  })
})
