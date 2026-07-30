"use client"

import type { TrickplayInfo } from "@/lib/playback-types"
import { usePreloadedImage } from "./use-preloaded-image"

/** Displayed preview width (cap — never upscale, tiles are small JPEGs). */
export const TRICKPLAY_PREVIEW_WIDTH = 224

export function trickplayPreviewDisplaySize(trickplay: TrickplayInfo): {
  width: number
  height: number
} {
  const scale = Math.min(1, TRICKPLAY_PREVIEW_WIDTH / trickplay.width)
  return {
    width: Math.round(trickplay.width * scale),
    height: Math.round(trickplay.height * scale),
  }
}



export function trickplayTileUrl(itemId: string, width: number, tileIndex: number): string {
  return `/api/jellyfin/trickplay/${itemId}/${width}/${tileIndex}`
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

  const scale = Math.min(1, TRICKPLAY_PREVIEW_WIDTH / trickplay.width)
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
