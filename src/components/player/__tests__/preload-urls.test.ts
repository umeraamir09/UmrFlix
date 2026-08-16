import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { ChapterInfo, TrickplayInfo } from "@/lib/playback-types"
import {
  getTrickplayPreloadUrls,
  MAX_PRELOAD_TILES,
  trickplayTileUrl,
} from "../TrickplayPreview"
import { getChapterPreloadUrls, chapterImageUrl, MAX_PRELOAD_CHAPTERS } from "../ChapterImagePreview"

const TRICKPLAY: TrickplayInfo = {
  interval: 10_000,
  thumbnailCount: 120,
  width: 320,
  height: 180,
  tileWidth: 5,
  tileHeight: 5,
}

describe("getTrickplayPreloadUrls (issue 4.6 — sprite preloading)", () => {
  it("returns one URL per sprite tile", () => {
    // 120 thumbnails / (5x5 = 25 per tile) = 4.8 → 5 tiles
    const urls = getTrickplayPreloadUrls(TRICKPLAY, "item-1")
    assert.deepEqual(
      urls,
      [0, 1, 2, 3, 4].map((i) => trickplayTileUrl("item-1", 320, i)),
    )
  })

  it("always returns at least one tile", () => {
    const urls = getTrickplayPreloadUrls(
      { ...TRICKPLAY, thumbnailCount: 0 },
      "item-1",
    )
    assert.strictEqual(urls.length, 1)
    assert.strictEqual(urls[0], trickplayTileUrl("item-1", 320, 0))
  })

  it("caps preloading at MAX_PRELOAD_TILES for extremely long content", () => {
    // 10_000 thumbnails / (10x5 = 50 per tile) = 200 tiles → capped
    const urls = getTrickplayPreloadUrls(
      { ...TRICKPLAY, thumbnailCount: 10_000, tileWidth: 10, tileHeight: 5 },
      "item-1",
    )
    assert.strictEqual(urls.length, MAX_PRELOAD_TILES)
    assert.strictEqual(urls[0], trickplayTileUrl("item-1", 320, 0))
    assert.strictEqual(urls[MAX_PRELOAD_TILES - 1], trickplayTileUrl("item-1", 320, MAX_PRELOAD_TILES - 1))
    assert.ok(
      !urls.includes(trickplayTileUrl("item-1", 320, MAX_PRELOAD_TILES)),
      "tiles beyond the cap must not be preloaded",
    )
  })

  it("does not exceed the cap when per-tile capacity is small", () => {
    // 5x5 tiles, 10_000 thumbnails → 400 tiles → capped at 32
    const urls = getTrickplayPreloadUrls(
      { ...TRICKPLAY, thumbnailCount: 10_000 },
      "item-1",
    )
    assert.strictEqual(urls.length, MAX_PRELOAD_TILES)
  })
})

describe("getChapterPreloadUrls (issue 4.6 — trickplay-less fallback)", () => {
  const chapters: ChapterInfo[] = [
    { name: "Intro", startSeconds: 0, imageTag: "abc123" },
    { name: "No image", startSeconds: 300, imageTag: undefined },
    { name: "Credits", startSeconds: 600, imageTag: "xyz" },
  ]

  it("returns URLs only for chapters that have an image", () => {
    assert.deepEqual(getChapterPreloadUrls(chapters, "item-1"), [
      chapterImageUrl("item-1", 0, "abc123"),
      chapterImageUrl("item-1", 2, "xyz"),
    ])
  })

  it("returns [] when no chapter has an image", () => {
    const bare = chapters.map((c) => ({ ...c, imageTag: undefined }))
    assert.deepEqual(getChapterPreloadUrls(bare, "item-1"), [])
  })

  it("URL-encodes image tags", () => {
    const urls = getChapterPreloadUrls(
      [{ name: "x", startSeconds: 0, imageTag: "a/b c" }],
      "item-1",
    )
    assert.strictEqual(urls[0], chapterImageUrl("item-1", 0, "a/b c"))
    assert.ok(urls[0].includes("tag=a%2Fb%20c"))
  })

  it("caps preloading at MAX_PRELOAD_CHAPTERS for chapter-heavy movies", () => {
    const chapters: ChapterInfo[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Ch ${i}`,
      startSeconds: i * 60,
      imageTag: `tag${i}`,
    }))
    const urls = getChapterPreloadUrls(chapters, "item-1")
    assert.strictEqual(urls.length, MAX_PRELOAD_CHAPTERS)
    assert.strictEqual(urls[0], chapterImageUrl("item-1", 0, "tag0"))
    assert.strictEqual(
      urls[MAX_PRELOAD_CHAPTERS - 1],
      chapterImageUrl("item-1", MAX_PRELOAD_CHAPTERS - 1, `tag${MAX_PRELOAD_CHAPTERS - 1}`),
    )
    assert.ok(
      !urls.includes(chapterImageUrl("item-1", MAX_PRELOAD_CHAPTERS, `tag${MAX_PRELOAD_CHAPTERS}`)),
      "chapters beyond the cap must not be preloaded",
    )
  })

  it("counts only image-bearing chapters toward the cap", () => {
    // 40 chapters, only odd ones have images → all 20 fit under the cap.
    const chapters: ChapterInfo[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Ch ${i}`,
      startSeconds: i * 60,
      imageTag: i % 2 === 1 ? `tag${i}` : undefined,
    }))
    const urls = getChapterPreloadUrls(chapters, "item-1")
    assert.strictEqual(urls.length, 20)
    assert.strictEqual(urls[0], chapterImageUrl("item-1", 1, "tag1"))
    assert.strictEqual(urls[urls.length - 1], chapterImageUrl("item-1", 39, "tag39"))
  })
})
