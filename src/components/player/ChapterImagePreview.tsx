"use client"

import { useEffect, useState, useMemo } from "react"
import type { ChapterInfo } from "@/lib/playback-types"

/** Displayed preview width — matches trickplay for visual consistency. */
export const CHAPTER_PREVIEW_WIDTH = 224
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

// Module-level cache — mirrors TrickplayPreview's loadedTiles set.
const loadedChapterImages = new Set<string>()

function useLoadedImage(url: string | null): boolean {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(() =>
    url && loadedChapterImages.has(url) ? url : null,
  )
  useEffect(() => {
    if (!url) return
    if (loadedChapterImages.has(url)) {
      queueMicrotask(() => setLoadedUrl(url))
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      loadedChapterImages.add(url)
      if (!cancelled) setLoadedUrl(url)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return url !== null && loadedUrl === url
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
 * Given sorted chapters and a time, find the active chapter index.
 * Returns -1 if no chapter with an imageTag covers this time.
 */
function findChapterIndex(
  chapters: ChapterInfo[],
  time: number,
): number {
  for (let i = chapters.length - 1; i >= 0; i--) {
    if (chapters[i].startSeconds <= time) return i
  }
  return 0
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
  const chaptersWithImages = useMemo(
    () => chapters.filter((c) => c.imageTag),
    [chapters],
  )

  const idx = findChapterIndex(chapters, time)
  const chapter = chapters[idx]
  const hasImage = chapter?.imageTag

  const url = hasImage
    ? chapterImageUrl(itemId, idx, chapter.imageTag)
    : null
  const loaded = useLoadedImage(url)

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
