import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { checkRateLimit, resetRateLimit, PLAYBACK_RATE_LIMITS } from "../rate-limit"
import {
  parsePlaybackPayload,
  isValidPlaybackPayload,
  type PlaybackPayload,
} from "../playback-types"
import { invalidatePlaybackCache } from "@/app/api/jellyfin/playback/[id]/route"

describe("API & Server-Side Issues (Audit 9.1 - 9.3)", () => {
  // ── 9.1 Rate Limiting ──────────────────────────────────────────
  describe("9.1 — Playback Rate Limiting", () => {
    beforeEach(() => {
      resetRateLimit("playback:test-user")
      resetRateLimit("played:test-user")
      resetRateLimit("progress:test-user")
    })

    it("enforces PLAYBACK_INFO rate limits (20 requests per 10s)", () => {
      const key = "playback:test-user"
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(
          checkRateLimit(key, PLAYBACK_RATE_LIMITS.PLAYBACK_INFO),
          true,
          `Request ${i + 1} should be allowed`,
        )
      }
      // 21st request exceeds limit
      assert.strictEqual(
        checkRateLimit(key, PLAYBACK_RATE_LIMITS.PLAYBACK_INFO),
        false,
        "21st request should be rate limited",
      )
    })

    it("enforces PLAYED rate limits (20 requests per 10s)", () => {
      const key = "played:test-user"
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(
          checkRateLimit(key, PLAYBACK_RATE_LIMITS.PLAYED),
          true,
          `Request ${i + 1} should be allowed`,
        )
      }
      assert.strictEqual(
        checkRateLimit(key, PLAYBACK_RATE_LIMITS.PLAYED),
        false,
        "21st request should be rate limited",
      )
    })

    it("enforces PROGRESS rate limits (30 requests per 10s)", () => {
      const key = "progress:test-user"
      for (let i = 0; i < 30; i++) {
        assert.strictEqual(
          checkRateLimit(key, PLAYBACK_RATE_LIMITS.PROGRESS),
          true,
          `Request ${i + 1} should be allowed`,
        )
      }
      assert.strictEqual(
        checkRateLimit(key, PLAYBACK_RATE_LIMITS.PROGRESS),
        false,
        "31st request should be rate limited",
      )
    })
  })

  // ── 9.2 Cache Invalidation & Caching Logic ───────────────────
  describe("9.2 — Playback Response Caching & Invalidation", () => {
    it("provides invalidatePlaybackCache function for item cleanup", () => {
      assert.strictEqual(typeof invalidatePlaybackCache, "function")
      // Calling with specific itemId or without arguments does not throw
      assert.doesNotThrow(() => invalidatePlaybackCache("test-item-123"))
      assert.doesNotThrow(() => invalidatePlaybackCache())
    })
  })

  // ── 9.3 Runtime Payload Validation ───────────────────────────
  describe("9.3 — Runtime PlaybackPayload Validation", () => {
    const validSamplePayload: PlaybackPayload = {
      itemId: "item123",
      playSessionId: "session456",
      mediaSourceId: "source789",
      container: "mkv",
      videoCodec: "h264",
      width: 1920,
      height: 1080,
      bitrate: 8000000,
      supportsDirectPlay: true,
      supportsDirectStream: true,
      supportsTranscoding: true,
      canDirectPlay: true,
      canDirectStream: true,
      directUrl: "http://localhost:8096/Videos/item123/stream",
      hlsUrl: "http://localhost:8096/Videos/item123/master.m3u8",
      runtimeTicks: 60000000000,
      resumeTicks: 1200000000,
      played: false,
      playedPercentage: 2,
      audio: [
        {
          index: 1,
          codec: "aac",
          language: "eng",
          title: "English Stereo",
          channels: 2,
          isDefault: true,
        },
      ],
      subtitles: [
        {
          index: 2,
          codec: "subrip",
          language: "eng",
          title: "English",
          isDefault: false,
          isForced: false,
          isExternal: true,
          isImageBased: false,
          url: "http://localhost:8096/Videos/item123/subtitles/2/Stream.vtt",
        },
      ],
      defaultAudioIndex: 1,
      markers: [{ type: "intro", start: 10, end: 75 }],
      chapters: [{ name: "Chapter 1", startSeconds: 0 }],
      trickplay: {
        width: 320,
        height: 180,
        tileWidth: 10,
        tileHeight: 10,
        thumbnailCount: 100,
        interval: 10000,
      },
      title: "Test Movie",
      series: null,
      backdropUrl: "http://localhost:8096/Items/item123/Images/Backdrop",
    }

    it("accepts a fully-formed valid PlaybackPayload", () => {
      assert.strictEqual(isValidPlaybackPayload(validSamplePayload), true)
      const parsed = parsePlaybackPayload(validSamplePayload)
      assert.strictEqual(parsed.itemId, "item123")
      assert.strictEqual(parsed.playSessionId, "session456")
      assert.strictEqual(parsed.canDirectPlay, true)
      assert.strictEqual(parsed.audio.length, 1)
      assert.strictEqual(parsed.subtitles.length, 1)
      assert.strictEqual(parsed.markers.length, 1)
      assert.strictEqual(parsed.markers[0].type, "intro")
      assert.strictEqual(parsed.chapters.length, 1)
      assert.strictEqual(parsed.trickplay?.thumbnailCount, 100)
    })

    it("rejects non-object or null payloads", () => {
      assert.strictEqual(isValidPlaybackPayload(null), false)
      assert.strictEqual(isValidPlaybackPayload(undefined), false)
      assert.strictEqual(isValidPlaybackPayload("string-payload"), false)
      assert.strictEqual(isValidPlaybackPayload(12345), false)

      assert.throws(
        () => parsePlaybackPayload(null),
        /Invalid playback payload: payload must be a non-null object/,
      )
    })

    it("rejects payloads missing mandatory string fields", () => {
      const missingHls = { ...validSamplePayload, hlsUrl: "" }
      assert.strictEqual(isValidPlaybackPayload(missingHls), false)
      assert.throws(
        () => parsePlaybackPayload(missingHls),
        /Invalid playback payload: missing or invalid required string field 'hlsUrl'/,
      )

      const missingItemId = { ...validSamplePayload, itemId: undefined }
      assert.strictEqual(isValidPlaybackPayload(missingItemId), false)
      assert.throws(
        () => parsePlaybackPayload(missingItemId),
        /Invalid playback payload: missing or invalid required string field 'itemId'/,
      )
    })

    it("rejects payloads with invalid boolean or numeric properties", () => {
      const invalidBool = { ...validSamplePayload, supportsDirectPlay: "true" as unknown as boolean }
      assert.strictEqual(isValidPlaybackPayload(invalidBool), false)
      assert.throws(
        () => parsePlaybackPayload(invalidBool),
        /Invalid playback payload: missing or invalid boolean field 'supportsDirectPlay'/,
      )

      const negativeRuntime = { ...validSamplePayload, runtimeTicks: -10 }
      assert.strictEqual(isValidPlaybackPayload(negativeRuntime), false)
      assert.throws(
        () => parsePlaybackPayload(negativeRuntime),
        /Invalid playback payload: 'runtimeTicks' must be a non-negative finite number/,
      )

      const nanResume = { ...validSamplePayload, resumeTicks: NaN }
      assert.strictEqual(isValidPlaybackPayload(nanResume), false)
      assert.throws(
        () => parsePlaybackPayload(nanResume),
        /Invalid playback payload: 'resumeTicks' must be a non-negative finite number/,
      )
    })

    it("normalizes missing or malformed audio/subtitles/markers arrays gracefully", () => {
      const payloadWithNullArrays = {
        ...validSamplePayload,
        audio: null,
        subtitles: undefined,
        markers: "not-an-array",
        chapters: null,
      }

      assert.strictEqual(isValidPlaybackPayload(payloadWithNullArrays), true)
      const parsed = parsePlaybackPayload(payloadWithNullArrays)
      assert.deepStrictEqual(parsed.audio, [])
      assert.deepStrictEqual(parsed.subtitles, [])
      assert.deepStrictEqual(parsed.markers, [])
      assert.deepStrictEqual(parsed.chapters, [])
    })

    it("filters invalid marker types and negative timestamps", () => {
      const payloadWithBadMarkers = {
        ...validSamplePayload,
        markers: [
          { type: "intro", start: 10, end: 40 },
          { type: "unknown_marker", start: 0, end: 10 },
          { type: "outro", start: 50, end: 20 }, // end < start
        ],
      }

      const parsed = parsePlaybackPayload(payloadWithBadMarkers)
      assert.strictEqual(parsed.markers.length, 1)
      assert.strictEqual(parsed.markers[0].type, "intro")
    })
  })
})
