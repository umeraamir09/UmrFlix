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
