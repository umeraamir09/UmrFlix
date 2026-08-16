import assert from "node:assert/strict"
import { test, describe, beforeEach } from "node:test"
import {
  formatAudioTrackLabel,
  getAvailableQualityPresets,
} from "../player-menus"
import {
  playerLog,
  getDebugEntries,
  clearDebugLogs,
  exportDebugLogs,
} from "../player-debug"
import type { AudioTrack } from "@/lib/playback-types"

describe("UX Improvements (Audit 6.1 - 6.10)", () => {
  describe("6.4 — Quality Menu source height filtering", () => {
    test("returns all presets when sourceHeight is undefined or 0", () => {
      const presets = getAvailableQualityPresets(undefined)
      assert.ok(presets.length > 0)
      assert.ok(presets.some((p) => p.id === "fhd"))
      assert.ok(presets.some((p) => p.id === "uhd"))
    })

    test("filters out 1080p (fhd), 4K (uhd) when source is 720p", () => {
      const presets = getAvailableQualityPresets(720)
      assert.ok(presets.some((p) => p.id === "auto"))
      assert.ok(presets.some((p) => p.id === "hd"))
      assert.ok(presets.some((p) => p.id === "sd"))
      assert.ok(!presets.some((p) => p.id === "fhd"))
      assert.ok(!presets.some((p) => p.id === "uhd"))
    })

    test("allows 1080p presets with small tolerance (e.g. 1076p video)", () => {
      const presets = getAvailableQualityPresets(1076)
      assert.ok(presets.some((p) => p.id === "fhd"))
      assert.ok(!presets.some((p) => p.id === "uhd"))
    })
  })

  describe("6.8 — Audio Track Label fallback chain", () => {
    test("uses track title when present", () => {
      const track: AudioTrack = {
        index: 1,
        title: "English 5.1 Surround",
        language: "eng",
        codec: "eac3",
        channels: 6,
        isDefault: true,
      }
      assert.equal(formatAudioTrackLabel(track, 0), "English 5.1 Surround")
    })

    test("falls back to displayTitle when title is empty", () => {
      const track = {
        index: 2,
        title: "",
        displayTitle: "Director's Commentary",
        language: "eng",
        codec: "aac",
      } as AudioTrack & { displayTitle: string }
      assert.equal(formatAudioTrackLabel(track, 1), "Director's Commentary")
    })

    test("falls back to language with channel count when title is missing", () => {
      const track: AudioTrack = {
        index: 3,
        title: "",
        language: "Japanese",
        codec: "aac",
        channels: 2,
        isDefault: false,
      }
      assert.equal(formatAudioTrackLabel(track, 2), "Japanese (2ch)")
    })

    test("falls back to Audio Track N when language and title are absent", () => {
      const track: AudioTrack = {
        index: 4,
        title: "",
        language: "",
        codec: "ac3",
        isDefault: false,
      }
      assert.equal(formatAudioTrackLabel(track, 3), "Audio Track 4")
    })
  })

  describe("6.10 — Debug Log export and ring buffer capacity", () => {
    beforeEach(() => {
      clearDebugLogs()
    })

    test("exports formatted log lines with tags, levels, and timestamps", () => {
      playerLog.info("test-tag", "Hello world", { key: "value" })
      playerLog.warn("network", "slow connection detected")

      const exported = exportDebugLogs()
      assert.ok(exported.includes("[INFO ] [test-tag] Hello world {\"key\":\"value\"}"))
      assert.ok(exported.includes("[WARN ] [network] slow connection detected"))
    })

    test("supports up to 200 entries before dropping oldest", () => {
      for (let i = 0; i < 250; i++) {
        playerLog.info("loop", `Entry #${i}`)
      }
      const entries = getDebugEntries()
      assert.equal(entries.length, 200)
      assert.equal(entries[0].message, "Entry #50")
      assert.equal(entries[199].message, "Entry #249")
    })
  })
})
