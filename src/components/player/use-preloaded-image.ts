"use client"

import { useEffect, useState } from "react"

const MAX_CACHE_SIZE = 100
const loadedImages = new Map<string, true>()

function cacheAdd(url: string) {
  if (loadedImages.has(url)) return
  if (loadedImages.size >= MAX_CACHE_SIZE) {
    const first = loadedImages.keys().next().value
    if (first !== undefined) loadedImages.delete(first)
  }
  loadedImages.set(url, true)
}

/**
 * Fire-and-forget preload that shares usePreloadedImage's module cache, so a
 * completed preload makes the first hover render instantly instead of issuing
 * a second, uncached Image request. Failed loads are not cached — a later
 * hover retries. Callers dedupe per instance to avoid re-issuing in-flight
 * requests on repeated triggers.
 */
export function preloadImages(urls: readonly string[]): void {
  const seen = new Set<string>()
  for (const url of urls) {
    if (seen.has(url) || loadedImages.has(url)) continue
    seen.add(url)
    const img = new Image()
    img.onload = () => cacheAdd(url)
    img.onerror = () => {}
    img.src = url
  }
}

export function usePreloadedImage(url: string | null): boolean {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(() =>
    url && loadedImages.has(url) ? url : null,
  )
  useEffect(() => {
    if (!url) return
    if (loadedImages.has(url)) {
      queueMicrotask(() => setLoadedUrl(url))
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      cacheAdd(url)
      if (!cancelled) setLoadedUrl(url)
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])
  return url !== null && loadedUrl === url
}
