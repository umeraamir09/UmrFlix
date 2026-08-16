"use client"

import type { TrickplayInfo } from "@/lib/playback-types"
import { usePreloadedImage } from "./use-preloaded-image"

/** Displayed preview width. */
export const TRICKPLAY_PREVIEW_WIDTH = 320

export function trickplayPreviewDisplaySize(trickplay: TrickplayInfo): {
  width: number
  height: number
} {
  const scale = TRICKPLAY_PREVIEW_WIDTH / trickplay.width
  return {
    width: Math.round(trickplay.width * scale),
    height: Math.round(trickplay.height * scale),
  }
}



export function trickplayTileUrl(itemId: string, width: number, tileIndex: number): string {
  return `/api/jellyfin/trickplay/${itemId}/${width}/${tileIndex}`
}

/** Cap for seek-bar sprite preloading (≈4.4h of content at 10s intervals). */
export const MAX_PRELOAD_TILES = 32

/**
 * 4.6 — URLs of the trickplay sprite tiles to preload when the cursor enters
 * the seek bar, so the hover bubble never pops in with a network stall.
 */
export function getTrickplayPreloadUrls(trickplay: TrickplayInfo, itemId: string): string[] {
  const perTile = trickplay.tileWidth * trickplay.tileHeight
  const tileCount = Math.min(
    MAX_PRELOAD_TILES,
    Math.max(1, Math.ceil(trickplay.thumbnailCount / perTile)),
  )
  return Array.from({ length: tileCount }, (_, i) => trickplayTileUrl(itemId, trickplay.width, i))
}

/**
 * Seek-bar hover thumbnail backed by Jellyfin trickplay sprite tiles.
 * Renders the single thumbnail at `time` by cropping it out of its tile via
 * background-position; the frame is kept at a stable size while the tile
 * loads so the bubble never visibly jumps.
 */
export function TrickplayPreview({
  trickplay,
  itemId,
  time,
}: {
  trickplay: TrickplayInfo
  itemId: string
  time: number
}) {
  const perTile = trickplay.tileWidth * trickplay.tileHeight
  const thumbIndex = Math.min(
    Math.max(0, trickplay.thumbnailCount - 1),
    Math.max(0, Math.floor((time * 1000) / trickplay.interval)),
  )
  const tileIndex = Math.floor(thumbIndex / perTile)
  const inTile = thumbIndex % perTile
  const col = inTile % trickplay.tileWidth
  const row = Math.floor(inTile / trickplay.tileWidth)

  const tileUrl = trickplayTileUrl(itemId, trickplay.width, tileIndex)
  const loaded = usePreloadedImage(tileUrl)

  const scale = TRICKPLAY_PREVIEW_WIDTH / trickplay.width
  const { width: displayW, height: displayH } = trickplayPreviewDisplaySize(trickplay)

  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width: displayW, height: displayH }}
    >
      {loaded && (
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${tileUrl})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${trickplay.tileWidth * trickplay.width * scale}px ${trickplay.tileHeight * trickplay.height * scale}px`,
            backgroundPosition: `-${col * trickplay.width * scale}px -${row * trickplay.height * scale}px`,
          }}
        />
      )}
    </div>
  )
}
