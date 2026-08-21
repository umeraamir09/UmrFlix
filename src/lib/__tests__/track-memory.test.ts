import { describe, it, beforeEach } from "node:test"
import assert from "node:assert/strict"
import type { AudioTrack, PlaybackPayload, SubtitleTrack } from "../playback-types"
import {
  __resetTrackMemoryCacheForTests,
  audioTrackKey,
  loadTrackMemory,
  memoryKeyForPayload,
  normalizeLang,
  resolveInitialAudioIndex,
  resolveInitialSubtitleIndex,
  saveTrackSelection,
  subtitleTrackKey,
  type RememberedTrack,
} from "../track-memory"

function makePayload(overrides: Partial<PlaybackPayload> = {}): PlaybackPayload {
  return {
    itemId: "item1",
    playSessionId: "ps1",
    mediaSourceId: "ms1",
    container: "mkv",
    supportsDirectPlay: false,
    supportsTranscoding: true,
    canDirectPlay: false,
    directUrl: "http://x/direct",
    hlsUrl: "http://x/hls",
    runtimeTicks: 3600 * 10_000_000,
    resumeTicks: 0,
    played: false,
    playedPercentage: null,
    audio: [],
    subtitles: [],
    defaultAudioIndex: null,
    markers: [],
    chapters: [],
    trickplay: null,
    series: null,
    ...overrides,
  }
}

function audio(partial: Partial<AudioTrack> & { index: number }): AudioTrack {
  return { title: `Audio ${partial.index}`, isDefault: false, ...partial }
}

function sub(partial: Partial<SubtitleTrack> & { index: number }): SubtitleTrack {
  return {
    title: `Sub ${partial.index}`,
    isDefault: false,
    isForced: false,
    isExternal: false,
    isImageBased: false,
    url: `/subs/${partial.index}`,
    ...partial,
  }
}

const jpnAacStereo = audio({ index: 1, language: "jpn", codec: "aac", channels: 2 })

describe("normalizeLang", () => {
  it("lowercases and trims", () => {
    assert.strictEqual(normalizeLang(" ENG "), "eng")
  })

  it("canonicalizes ISO 639-2 aliases", () => {
    assert.strictEqual(normalizeLang("fre"), "fra")
    assert.strictEqual(normalizeLang("fra"), "fra")
    assert.strictEqual(normalizeLang("deu"), "ger")
    assert.strictEqual(normalizeLang("ger"), "ger")
  })

  it("returns empty string for missing language", () => {
    assert.strictEqual(normalizeLang(undefined), "")
    assert.strictEqual(normalizeLang(null), "")
  })
})

describe("memoryKeyForPayload", () => {
  it("keys episodes by series id", () => {
    const p = makePayload({ itemId: "ep3", series: { id: "series9" } })
    assert.strictEqual(memoryKeyForPayload(p), "series:series9")
  })

  it("keys movies by item id", () => {
    const p = makePayload({ itemId: "movie7" })
    assert.strictEqual(memoryKeyForPayload(p), "item:movie7")
  })
})

describe("resolveInitialAudioIndex", () => {
  const payload = makePayload({
    defaultAudioIndex: 0,
    audio: [
      audio({ index: 0, language: "eng", codec: "aac", channels: 2 }),
      jpnAacStereo,
    ],
  })

  it("restores a remembered track by identity key when the index shifted", () => {
    // Same series, next episode: jpn track moved from index 1 to index 3.
    const shifted = makePayload({
      defaultAudioIndex: 0,
      audio: [
        audio({ index: 0, language: "eng", codec: "aac", channels: 2 }),
        audio({ index: 2, language: "eng", codec: "ac3", channels: 6 }),
        audio({ index: 3, language: "jpn", codec: "aac", channels: 2, title: "Japanese Stereo" }),
      ],
    })
    const remembered: RememberedTrack = {
      index: 1,
      key: audioTrackKey(jpnAacStereo),
      lang: "jpn",
      updatedAt: 1,
    }
    assert.strictEqual(resolveInitialAudioIndex(shifted, remembered, "original"), 3)
  })

  it("falls back to raw index when the key matches nothing but the language still matches", () => {
    const remembered: RememberedTrack = {
      index: 1,
      key: "a:jpn|eac3|6", // old file had a different codec — key won't match
      lang: "jpn",
      updatedAt: 1,
    }
    assert.strictEqual(resolveInitialAudioIndex(payload, remembered, "original"), 1)
  })

  it("ignores a stale index whose language no longer matches", () => {
    // This file lost the jpn track entirely; eng now sits on the old index 0.
    const engOnly = makePayload({
      defaultAudioIndex: 0,
      audio: [audio({ index: 0, language: "eng", codec: "aac", channels: 2 })],
    })
    const remembered: RememberedTrack = { index: 0, key: "a:jpn|aac|2", lang: "jpn", updatedAt: 1 }
    assert.strictEqual(resolveInitialAudioIndex(engOnly, remembered, "original"), 0)
    assert.strictEqual(resolveInitialAudioIndex(engOnly, remembered, "eng"), 0)
  })

  it("prefers the preferred language over the Jellyfin default when nothing is remembered", () => {
    assert.strictEqual(resolveInitialAudioIndex(payload, undefined, "jpn"), 1)
    assert.strictEqual(resolveInitialAudioIndex(payload, undefined, "JPN"), 1)
  })

  it("memory beats the preferred language", () => {
    const remembered: RememberedTrack = {
      index: 1,
      key: audioTrackKey(jpnAacStereo),
      lang: "jpn",
      updatedAt: 1,
    }
    assert.strictEqual(resolveInitialAudioIndex(payload, remembered, "eng"), 1)
  })

  it('"original" preference and unknown languages fall back to the Jellyfin default', () => {
    assert.strictEqual(resolveInitialAudioIndex(payload, undefined, "original"), 0)
    assert.strictEqual(resolveInitialAudioIndex(payload, undefined, "kor"), 0)
    assert.strictEqual(resolveInitialAudioIndex(payload, undefined, ""), 0)
  })
})

describe("resolveInitialSubtitleIndex", () => {
  const engFull = sub({ index: 1, language: "eng", codec: "subrip" })
  const payload = makePayload({
    subtitles: [
      sub({ index: 0, language: "eng", codec: "subrip", isForced: true, title: "English Forced" }),
      engFull,
      sub({ index: 2, language: "spa", codec: "subrip" }),
    ],
  })

  it("restores a remembered subtitle by identity key when the index shifted", () => {
    const shifted = makePayload({
      subtitles: [
        sub({ index: 0, language: "spa", codec: "subrip" }),
        sub({ index: 5, language: "eng", codec: "subrip" }),
      ],
    })
    const remembered: RememberedTrack = {
      index: 1,
      key: subtitleTrackKey(engFull),
      lang: "eng",
      updatedAt: 1,
    }
    assert.strictEqual(resolveInitialSubtitleIndex(shifted, remembered, "none"), 5)
  })

  it('restores an explicit "off" even when a preferred language is set', () => {
    const remembered: RememberedTrack = { index: null, key: null, updatedAt: 1 }
    assert.strictEqual(resolveInitialSubtitleIndex(payload, remembered, "eng"), null)
  })

  it("applies the preferred language, skipping forced and image-based tracks", () => {
    const withImage = makePayload({
      subtitles: [
        sub({ index: 0, language: "eng", codec: "subrip", isForced: true }),
        sub({ index: 1, language: "eng", codec: "hdmv_pgs", isImageBased: true, url: null }),
        sub({ index: 2, language: "eng", codec: "subrip" }),
      ],
    })
    assert.strictEqual(resolveInitialSubtitleIndex(withImage, undefined, "eng"), 2)
    assert.strictEqual(resolveInitialSubtitleIndex(payload, undefined, "eng"), 1)
    assert.strictEqual(resolveInitialSubtitleIndex(payload, undefined, "spa"), 2)
  })

  it("matches language aliases both ways (fre/fra, deu/ger)", () => {
    const p = makePayload({ subtitles: [sub({ index: 4, language: "fra" })] })
    assert.strictEqual(resolveInitialSubtitleIndex(p, undefined, "fre"), 4)
    const p2 = makePayload({ subtitles: [sub({ index: 7, language: "ger" })] })
    assert.strictEqual(resolveInitialSubtitleIndex(p2, undefined, "deu"), 7)
  })

  it("falls back to the Jellyfin default non-image track with no memory and pref off", () => {
    const p = makePayload({
      subtitles: [
        sub({ index: 0, language: "eng" }),
        sub({ index: 1, language: "spa", isDefault: true }),
      ],
    })
    assert.strictEqual(resolveInitialSubtitleIndex(p, undefined, "none"), 1)
    assert.strictEqual(resolveInitialSubtitleIndex(p, undefined, "jpn"), 1)
    // Default-flagged but image-based → no auto-selection (previous behavior)
    const imgDefault = makePayload({
      subtitles: [sub({ index: 0, language: "eng", isDefault: true, isImageBased: true, url: null })],
    })
    assert.strictEqual(resolveInitialSubtitleIndex(imgDefault, undefined, "none"), null)
  })

  it("memory beats the preferred language", () => {
    const remembered: RememberedTrack = {
      index: 2,
      key: subtitleTrackKey(sub({ index: 2, language: "spa", codec: "subrip" })),
      lang: "spa",
      updatedAt: 1,
    }
    assert.strictEqual(resolveInitialSubtitleIndex(payload, remembered, "eng"), 2)
  })

  it("a remembered track that vanished falls through to the preference", () => {
    const remembered: RememberedTrack = { index: 9, key: "s:jpn|subrip|0", lang: "jpn", updatedAt: 1 }
    assert.strictEqual(resolveInitialSubtitleIndex(payload, remembered, "eng"), 1)
  })
})

describe("saveTrackSelection / loadTrackMemory", () => {
  beforeEach(() => {
    __resetTrackMemoryCacheForTests()
  })

  it("round-trips selections and merges audio/subtitle patches", () => {
    saveTrackSelection("series:s1", {
      audio: { index: 1, key: "a:jpn|aac|2", lang: "jpn", updatedAt: 10 },
    })
    saveTrackSelection("series:s1", {
      subtitle: { index: null, key: null, updatedAt: 20 },
    })
    const entry = loadTrackMemory()["series:s1"]
    assert.strictEqual(entry?.audio?.index, 1)
    assert.strictEqual(entry?.subtitle?.index, null)
  })

  it("keeps separate entries per memory key", () => {
    saveTrackSelection("item:m1", { subtitle: { index: 3, key: "s:eng|subrip|0", updatedAt: 1 } })
    saveTrackSelection("item:m2", { subtitle: { index: null, key: null, updatedAt: 2 } })
    const map = loadTrackMemory()
    assert.strictEqual(map["item:m1"]?.subtitle?.index, 3)
    assert.strictEqual(map["item:m2"]?.subtitle?.index, null)
  })

  it("evicts the oldest entries beyond the 100-entry cap", () => {
    for (let i = 0; i < 100; i++) {
      saveTrackSelection(`item:old${i}`, { subtitle: { index: i, key: null, updatedAt: i } })
    }
    saveTrackSelection("item:newest", { subtitle: { index: 0, key: null, updatedAt: 1000 } })
    const map = loadTrackMemory()
    assert.strictEqual(Object.keys(map).length, 100)
    assert.strictEqual(map["item:old0"], undefined) // oldest evicted
    assert.ok(map["item:old1"]) // second oldest survives
    assert.ok(map["item:newest"])
  })
})
