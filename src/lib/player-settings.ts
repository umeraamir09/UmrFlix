"use client"

import { useSyncExternalStore } from "react"

/**
 * Client-side player preferences (persisted in localStorage).
 *
 * subtitleMode:
 *  - "client" (default) — text subtitle tracks (SRT/VTT/ASS) are fetched and
 *    rendered by the custom overlay, so switching tracks is instant and
 *    styling controls (size / colour / background) apply.
 *  - "burn" — every selected subtitle track is burnt into the video by the
 *    Jellyfin transcoder (requires a transcoded HLS stream rebuild).
 */
export type SubtitleMode = "client" | "burn"

export type PlayerSettings = {
  subtitleMode: SubtitleMode
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  subtitleMode: "client",
}

const STORAGE_KEY = "umrflix.playerSettings"
const CHANGE_EVENT = "umrflix:player-settings-changed"

let cached: PlayerSettings | null = null

export function loadPlayerSettings(): PlayerSettings {
  if (cached) return cached
  if (typeof window === "undefined") return DEFAULT_PLAYER_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS, ...JSON.parse(raw) }
      cached = parsed
      return parsed
    }
  } catch {}
  return DEFAULT_PLAYER_SETTINGS
}

export function savePlayerSettings(settings: PlayerSettings) {
  cached = settings
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  }
}

export function updatePlayerSettings(patch: Partial<PlayerSettings>) {
  savePlayerSettings({ ...loadPlayerSettings(), ...patch })
}

function subscribe(onChange: () => void): () => void {
  const handler = () => {
    cached = null // re-read from storage
    onChange()
  }
  window.addEventListener(CHANGE_EVENT, handler)
  // Cross-tab sync
  window.addEventListener("storage", handler)
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler)
    window.removeEventListener("storage", handler)
  }
}

/** Reactive access to the persisted player settings. */
export function usePlayerSettings(): [
  PlayerSettings,
  (patch: Partial<PlayerSettings>) => void,
] {
  const settings = useSyncExternalStore(
    subscribe,
    loadPlayerSettings,
    () => DEFAULT_PLAYER_SETTINGS,
  )
  return [settings, updatePlayerSettings]
}
