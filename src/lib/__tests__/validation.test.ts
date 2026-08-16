import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isValidItemId, isValidPathSlug, isValidIndex } from "../validation"

describe("API Input Validation Helpers", () => {
  describe("isValidItemId", () => {
    it("accepts valid alphanumeric, hex UUIDs and slug IDs", () => {
      assert.strictEqual(isValidItemId("1234567890abcdef1234567890abcdef"), true)
      assert.strictEqual(isValidItemId("item_123"), true)
      assert.strictEqual(isValidItemId("movie-456"), true)
      assert.strictEqual(isValidItemId("AbCdEf"), true)
    })

    it("rejects path traversal attempts", () => {
      assert.strictEqual(isValidItemId("../System/Info"), false)
      assert.strictEqual(isValidItemId("..\\System\\Info"), false)
      assert.strictEqual(isValidItemId("../.."), false)
      assert.strictEqual(isValidItemId("/etc/passwd"), false)
    })

    it("rejects invalid characters, null bytes and abnormal lengths", () => {
      assert.strictEqual(isValidItemId(""), false)
      assert.strictEqual(isValidItemId(null), false)
      assert.strictEqual(isValidItemId(undefined), false)
      assert.strictEqual(isValidItemId("item\0inject"), false)
      assert.strictEqual(isValidItemId("item<script>"), false)
      assert.strictEqual(isValidItemId("a".repeat(65)), false)
    })
  })

  describe("isValidPathSlug", () => {
    it("accepts valid string array segments", () => {
      assert.strictEqual(isValidPathSlug(["Videos", "123", "stream.m3u8"]), true)
      assert.strictEqual(isValidPathSlug(["Items", "abc", "Images", "Primary"]), true)
    })

    it("rejects path traversal in segments", () => {
      assert.strictEqual(isValidPathSlug(["..", "secret"]), false)
      assert.strictEqual(isValidPathSlug(["Videos", "..", "System"]), false)
      assert.strictEqual(isValidPathSlug(["Videos/123", "stream"]), false)
      assert.strictEqual(isValidPathSlug(["Videos\\123", "stream"]), false)
    })

    it("rejects empty or invalid slugs", () => {
      assert.strictEqual(isValidPathSlug([]), false)
      assert.strictEqual(isValidPathSlug(null), false)
      assert.strictEqual(isValidPathSlug([""]), false)
    })
  })

  describe("isValidIndex", () => {
    it("accepts non-negative integers within bounds", () => {
      assert.strictEqual(isValidIndex(0), true)
      assert.strictEqual(isValidIndex(5), true)
      assert.strictEqual(isValidIndex("12"), true)
    })

    it("rejects negative, float, or out-of-bounds indices", () => {
      assert.strictEqual(isValidIndex(-1), false)
      assert.strictEqual(isValidIndex(1.5), false)
      assert.strictEqual(isValidIndex(1001, 1000), false)
      assert.strictEqual(isValidIndex("abc"), false)
      assert.strictEqual(isValidIndex(NaN), false)
    })
  })
})
