import { describe, it, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { checkRateLimit, resetRateLimit, PLAYBACK_RATE_LIMITS } from "../rate-limit"
import { getClientIp } from "../audit"
import {
  parsePlaybackPayload,
  isValidPlaybackPayload,
  type PlaybackPayload,
} from "../playback-types"
import { invalidatePlaybackCache } from "@/app/api/jellyfin/playback/[id]/route"
import { GET as getPlayback } from "@/app/api/jellyfin/playback/[id]/route"
import { POST as reportProgress } from "@/app/api/jellyfin/playback/progress/route"
import { POST as markPlayed } from "@/app/api/jellyfin/played/[id]/route"

const originalFetch = globalThis.fetch
const originalTrustedProxy = process.env.TRUSTED_PROXY
const originalClientIpHeader = process.env.CLIENT_IP_HEADER
const originalJellyfinUrl = process.env.JELLYFIN_URL
const originalJellyfinUsername = process.env.JELLYFIN_USERNAME
const originalJellyfinPassword = process.env.JELLYFIN_PASSWORD

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalTrustedProxy === undefined) delete process.env.TRUSTED_PROXY
  else process.env.TRUSTED_PROXY = originalTrustedProxy
  if (originalClientIpHeader === undefined) delete process.env.CLIENT_IP_HEADER
  else process.env.CLIENT_IP_HEADER = originalClientIpHeader
  if (originalJellyfinUrl === undefined) delete process.env.JELLYFIN_URL
  else process.env.JELLYFIN_URL = originalJellyfinUrl
  if (originalJellyfinUsername === undefined) delete process.env.JELLYFIN_USERNAME
  else process.env.JELLYFIN_USERNAME = originalJellyfinUsername
  if (originalJellyfinPassword === undefined) delete process.env.JELLYFIN_PASSWORD
  else process.env.JELLYFIN_PASSWORD = originalJellyfinPassword
  invalidatePlaybackCache()
})

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
  describe("9.2b — Playback route integration", () => {
    it("validates proxy identity instead of returning a shared unknown bucket", () => {
      process.env.TRUSTED_PROXY = "1"
      delete process.env.CLIENT_IP_HEADER

      assert.equal(
        getClientIp(new Request("http://localhost", {
          headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.10" },
        })),
        "203.0.113.10",
      )
      assert.equal(
        getClientIp(new Request("http://localhost", {
          headers: { "x-forwarded-for": "not-an-ip" },
        })),
        null,
      )
      assert.equal(getClientIp(new Request("http://localhost")), null)
    })

    it("negotiates a fresh Jellyfin session and playback state for every request", async () => {
      process.env.JELLYFIN_URL = "http://jellyfin.test"
      process.env.JELLYFIN_USERNAME = "test-user"
      process.env.JELLYFIN_PASSWORD = "test-password"
      process.env.TRUSTED_PROXY = "1"

      let playbackInfoCalls = 0
      let detailCalls = 0
      let segmentCalls = 0
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url.endsWith("/Users/AuthenticateByName")) {
          return Response.json({ AccessToken: "test-token", User: { Id: "test-user" } })
        }
        if (url.includes("/PlaybackInfo")) {
          playbackInfoCalls++
          return Response.json({
            PlaySessionId: `session-${playbackInfoCalls}`,
            MediaSources: [{
              Id: "source-1",
              Container: "mp4",
              Bitrate: 1_000_000,
              RunTimeTicks: 1_000_000_000,
              SupportsDirectPlay: true,
              SupportsDirectStream: true,
              SupportsTranscoding: true,
              IsRemote: false,
              MediaStreams: [{
                Index: 0,
                Type: "Video",
                Codec: "h264",
                IsDefault: true,
                IsForced: false,
                IsExternal: false,
                Width: 1920,
                Height: 1080,
              }],
            }],
          })
        }
        if (url.includes("/Users/test-user/Items/item-123")) {
          detailCalls++
          return Response.json({
            Id: "item-123",
            Name: "Test movie",
            Type: "Movie",
            RunTimeTicks: 1_000_000_000,
            UserData: {
              PlaybackPositionTicks: detailCalls * 100_000_000,
              Played: false,
              PlayedPercentage: detailCalls,
            },
          })
        }
        if (url.includes("/MediaSegments/") || url.includes("/IntroSkipperSegments")) {
          segmentCalls++
          return new Response(null, { status: 404 })
        }
        throw new Error(`Unexpected test request: ${url}`)
      }

      invalidatePlaybackCache("item-123")
      const makeRequest = () => new Request("http://localhost/api/jellyfin/playback/item-123", {
        headers: { "x-forwarded-for": "203.0.113.20" },
      })
      const first = await getPlayback(makeRequest(), { params: Promise.resolve({ id: "item-123" }) })
      const second = await getPlayback(makeRequest(), { params: Promise.resolve({ id: "item-123" }) })
      const firstPayload = await first.json()
      const secondPayload = await second.json()

      assert.equal(first.status, 200)
      assert.equal(second.status, 200)
      assert.equal(first.headers.get("cache-control"), "private, no-store")
      assert.equal(firstPayload.playSessionId, "session-1")
      assert.equal(secondPayload.playSessionId, "session-2")
      assert.equal(firstPayload.resumeTicks, 100_000_000)
      assert.equal(secondPayload.resumeTicks, 200_000_000)
      assert.equal(playbackInfoCalls, 2)
      assert.equal(detailCalls, 2)
      assert.equal(segmentCalls, 2)
    })

    it("invalidates static metadata after a stopped progress report", async () => {
      process.env.JELLYFIN_URL = "http://jellyfin.test"
      process.env.JELLYFIN_USERNAME = "test-user"
      process.env.JELLYFIN_PASSWORD = "test-password"
      process.env.TRUSTED_PROXY = "1"

      let segmentCalls = 0
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url.endsWith("/Users/AuthenticateByName")) {
          return Response.json({ AccessToken: "test-token", User: { Id: "test-user" } })
        }
        if (url.includes("/PlaybackInfo")) {
          return Response.json({
            PlaySessionId: "session-1",
            MediaSources: [{
              Id: "source-1",
              Container: "mp4",
              SupportsDirectPlay: true,
              SupportsDirectStream: true,
              SupportsTranscoding: true,
              IsRemote: false,
              MediaStreams: [],
            }],
          })
        }
        if (url.includes("/Users/test-user/Items/item-456")) {
          return Response.json({ Id: "item-456", Name: "Test movie", Type: "Movie" })
        }
        if (url.includes("/MediaSegments/") || url.includes("/IntroSkipperSegments")) {
          segmentCalls++
          return new Response(null, { status: 404 })
        }
        if (url.includes("/Sessions/Playing/Stopped")) return new Response(null, { status: 204 })
        throw new Error(`Unexpected test request: ${url}`)
      }

      const request = () => new Request("http://localhost/api/jellyfin/playback/item-456", {
        headers: { "x-forwarded-for": "203.0.113.21" },
      })
      await getPlayback(request(), { params: Promise.resolve({ id: "item-456" }) })
      assert.equal(segmentCalls, 2)

      const stopped = await reportProgress(new Request("http://localhost/api/jellyfin/playback/progress", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.21",
        },
        body: JSON.stringify({ itemId: "item-456", positionTicks: 500_000_000, event: "stopped" }),
      }))
      assert.equal(stopped.status, 200)

      await getPlayback(request(), { params: Promise.resolve({ id: "item-456" }) })
      assert.equal(segmentCalls, 4)
    })

    it("rejects playback mutations without authentication or a valid client identity", async () => {
      process.env.TRUSTED_PROXY = "1"
      delete process.env.CLIENT_IP_HEADER

      const playback = await getPlayback(
        new Request("http://localhost/api/jellyfin/playback/item-789"),
        { params: Promise.resolve({ id: "item-789" }) },
      )
      const progress = await reportProgress(new Request("http://localhost/api/jellyfin/playback/progress", {
        method: "POST",
        body: JSON.stringify({ itemId: "item-789", positionTicks: 0, event: "progress" }),
      }))
      const played = await markPlayed(
        new Request("http://localhost/api/jellyfin/played/item-789", { method: "POST" }),
        { params: Promise.resolve({ id: "item-789" }) },
      )

      assert.equal(playback.status, 401)
      assert.equal(progress.status, 401)
      assert.equal(played.status, 401)
    })
  })

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
