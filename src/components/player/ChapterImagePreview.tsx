"use client"

import type { ChapterInfo } from "@/lib/playback-types"
import Image from "next/image"
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

/** Cap for seek-bar chapter-image preloading (trickplay parity). Chapters
 *  beyond the cap still load on demand when hovered. */
export const MAX_PRELOAD_CHAPTERS = 32

/**
 * 4.6 — URLs of the chapter images to preload when the cursor enters the seek
 * bar (trickplay-less fallback), so the hover bubble never pops in with a
 * network stall. Only chapters with an imageTag produce a thumbnail; the list
 * is capped at MAX_PRELOAD_CHAPTERS to avoid a request burst on
 * chapter-heavy movies.
 */
export function getChapterPreloadUrls(chapters: ChapterInfo[], itemId: string): string[] {
  const urls: string[] = []
  for (const [idx, ch] of chapters.entries()) {
    if (urls.length >= MAX_PRELOAD_CHAPTERS) break
    if (!ch.imageTag) continue
    urls.push(chapterImageUrl(itemId, idx, ch.imageTag))
  }
  return urls
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
        <Image
          src={url}
          alt={chapter.name || "Chapter preview"}
          fill
          unoptimized
          draggable={false}
          className="object-cover"
        />
      )}
    </div>
  )
}
