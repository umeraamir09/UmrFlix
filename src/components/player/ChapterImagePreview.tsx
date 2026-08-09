"use client"

import type { ChapterInfo } from "@/lib/playback-types"
import { usePreloadedImage } from "./use-preloaded-image"

/** Displayed preview width — matches trickplay for visual consistency. */
export const CHAPTER_PREVIEW_WIDTH = 320
/** Fixed aspect ratio (16:9) for chapter images. */
const ASPECT = 9 / 16

export function chapterPreviewDisplaySize(): {
  width: number
  height: number
} {
  return {
    width: CHAPTER_PREVIEW_WIDTH,
    height: Math.round(CHAPTER_PREVIEW_WIDTH * ASPECT),
  }
}



export function chapterImageUrl(
  itemId: string,
  chapterIndex: number,
  imageTag?: string,
): string {
  const tag = imageTag
    ? `?tag=${encodeURIComponent(imageTag)}`
    : ""
  return `/api/jellyfin/chapter-image/${itemId}/${chapterIndex}${tag}`
}

/**
 * Given sorted chapters and a time, find the active chapter index via binary search.
 * Returns the last chapter whose startSeconds <= time, or 0.
 */
function findChapterIndex(
  chapters: ChapterInfo[],
  time: number,
): number {
  let lo = 0
  let hi = chapters.length - 1
  let result = 0
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    if (chapters[mid].startSeconds <= time) {
      result = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return result
}

/**
 * Seek-bar hover thumbnail backed by Jellyfin chapter images.
 * Renders the chapter image for the chapter active at `time`.
 * Only useful when at least one chapter has an imageTag.
 */
export function ChapterImagePreview({
  chapters,
  itemId,
  time,
}: {
  chapters: ChapterInfo[]
  itemId: string
  time: number
}) {
  const idx = findChapterIndex(chapters, time)
  const chapter = chapters[idx]
  const hasImage = chapter?.imageTag

  const url = hasImage
    ? chapterImageUrl(itemId, idx, chapter.imageTag)
    : null
  const loaded = usePreloadedImage(url)

  const { width: displayW, height: displayH } =
    chapterPreviewDisplaySize()

  if (!hasImage) return null

  return (
    <div
      className="relative overflow-hidden bg-black"
      style={{ width: displayW, height: displayH }}
    >
      {loaded && url && (
        <img
          src={url}
          alt={chapter.name || "Chapter preview"}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />
      )}
    </div>
  )
}
