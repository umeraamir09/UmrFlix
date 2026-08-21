"use client"

import type { AudioTrack, PlaybackPayload, SubtitleTrack } from "./playback-types"

/**
 * Per-title audio/subtitle track memory (persisted in localStorage).
 *
 * When the user switches audio or subtitle tracks in the player, the choice
 * is remembered and restored the next time they play the same title. Memory
 * is keyed by series id for episodes (so track choices carry over from
 * episode to episode) and by item id for movies.
 *
 * Restoration precedence (both resolvers):
 *  1. Remembered choice for this title (matched by a stable identity key, so
 *     the correct track is found even when stream indexes shift between
 *     episode files).
 *  2. Global preferred-language setting from the settings page.
 *  3. Jellyfin's default track (previous behavior).
 */

export type RememberedTrack = {
  /** Last-used Jellyfin stream index (null = subtitles explicitly off). */
  index: number | null
  /** Stable identity key (language|codec|...) for cross-episode rematching. */
  key: string | null
  /** Normalized language tag, used to sanity-check the raw-index fallback. */
  lang?: string
  /** Track title, used as a tiebreak when multiple tracks share the same key. */
  title?: string
  updatedAt: number
}

export type TrackMemoryEntry = {
  audio?: RememberedTrack
  subtitle?: RememberedTrack
}

export type TrackMemoryMap = Record<string, TrackMemoryEntry>

const STORAGE_KEY = "umrflix.trackMemory.v1"
const MAX_ENTRIES = 100

let cached: TrackMemoryMap | null = null

/** Memory key for a payload: series-scoped for episodes, item-scoped otherwise. */
export function memoryKeyForPayload(p: PlaybackPayload): string {
  return p.series?.id ? `series:${p.series.id}` : `item:${p.itemId}`
}

export function loadTrackMemory(): TrackMemoryMap {
  if (cached) return cached
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        cached = parsed as TrackMemoryMap
        return cached
      }
    }
  } catch {}
  return {}
}

/** Merge a track choice into the remembered entry for a title and persist. */
export function saveTrackSelection(
  key: string,
  patch: { audio?: RememberedTrack; subtitle?: RememberedTrack },
) {
  const map: TrackMemoryMap = { ...loadTrackMemory() }
  map[key] = { ...map[key], ...patch }

  // LRU eviction so the map can't grow unboundedly in localStorage.
  const keys = Object.keys(map)
  if (keys.length > MAX_ENTRIES) {
    const stamp = (k: string) =>
      Math.max(map[k]?.audio?.updatedAt ?? 0, map[k]?.subtitle?.updatedAt ?? 0)
    keys.sort((a, b) => stamp(a) - stamp(b))
    for (let i = 0; i < keys.length - MAX_ENTRIES; i++) {
      delete map[keys[i]]
    }
  }

  cached = map
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
    } catch {}
  }
}

/** Test-only: drop the module cache so storage is re-read. */
export function __resetTrackMemoryCacheForTests() {
  cached = null
}

// ── Language normalization ──
// Media containers disagree on ISO 639-2 codes (MKV uses bibliographic tags
// like "fre"/"ger", MP4 uses terminologic "fra"/"deu", and the settings page
// mixes both), so map aliases onto one canonical form before comparing.
const LANG_ALIASES: Record<string, string> = {
  fre: "fra",
  deu: "ger",
}

export function normalizeLang(lang: string | null | undefined): string {
  if (!lang) return ""
  const l = lang.trim().toLowerCase()
  return LANG_ALIASES[l] ?? l
}

// ── Stable identity keys ──
// Language + codec + channels (audio) / forced flag (subs) identifies a track
// across episode files of the same series even when stream indexes shift.
// Titles are only a tiebreak — Jellyfin renders flags like " - Default" into
// titles, which can differ between episode files.

export function audioTrackKey(t: AudioTrack): string {
  return `a:${normalizeLang(t.language)}|${(t.codec ?? "").toLowerCase()}|${t.channels ?? 0}`
}

export function subtitleTrackKey(t: SubtitleTrack): string {
  return `s:${normalizeLang(t.language)}|${(t.codec ?? "").toLowerCase()}|${t.isForced ? 1 : 0}`
}

// ── Resolution helpers ──

function restoreTrackIndex<T extends { index: number; language?: string; title?: string }>(
  tracks: T[],
  remembered: RememberedTrack | undefined,
  keyOf: (t: T) => string,
): number | null {
  if (!remembered || remembered.index == null) return null

  // 1. Identity key rematch — robust across files where indexes shifted.
  if (remembered.key) {
    const matches = tracks.filter((t) => keyOf(t) === remembered.key)
    if (matches.length === 1) return matches[0].index
    if (matches.length > 1) {
      const titled = remembered.title ? matches.find((t) => t.title === remembered.title) : undefined
      return (titled ?? matches[0]).index
    }
  }

  // 2. Raw index, only if the language at that index still matches what was
  // remembered (guards against an unrelated track landing on the old index).
  if (remembered.lang) {
    const atIndex = tracks.find((t) => t.index === remembered.index)
    if (atIndex && normalizeLang(atIndex.language) === remembered.lang) {
      return atIndex.index
    }
  }

  return null
}

/**
 * Initial audio track for a payload: remembered choice → preferred audio
 * language ("original" disables the preference) → Jellyfin's default.
 */
export function resolveInitialAudioIndex(
  payload: PlaybackPayload,
  remembered: RememberedTrack | undefined,
  preferredLanguage: string,
): number | null {
  const restored = restoreTrackIndex(payload.audio, remembered, audioTrackKey)
  if (restored != null) return restored

  const pref = normalizeLang(preferredLanguage)
  if (pref && pref !== "original") {
    const match = payload.audio.find((t) => normalizeLang(t.language) === pref)
    if (match) return match.index
  }

  return payload.defaultAudioIndex
}

/**
 * Initial subtitle track for a payload: remembered choice (an explicit "off"
 * is restored as off) → preferred subtitle language ("none" disables the
 * preference) → Jellyfin's default non-image track (previous behavior).
 */
export function resolveInitialSubtitleIndex(
  payload: PlaybackPayload,
  remembered: RememberedTrack | undefined,
  preferredLanguage: string,
): number | null {
  if (remembered) {
    if (remembered.index == null) return null // user turned subs off for this title
    const restored = restoreTrackIndex(payload.subtitles, remembered, subtitleTrackKey)
    if (restored != null) return restored
    // Remembered track no longer exists in this file — fall through.
  }

  const pref = normalizeLang(preferredLanguage)
  if (pref && pref !== "none") {
    const matching = payload.subtitles.filter((t) => normalizeLang(t.language) === pref)
    // Prefer a full, client-renderable text track; image tracks still match
    // as a last resort (the player burns them via the transcode path).
    const best =
      matching.find((t) => !t.isForced && !t.isImageBased && t.url != null) ??
      matching.find((t) => !t.isForced && !t.isImageBased) ??
      matching.find((t) => !t.isForced) ??
      matching[0]
    if (best) return best.index
  }

  const def = payload.subtitles.find((s) => s.isDefault && !s.isImageBased) ?? null
  return def ? def.index : null
}
