"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"

/**
 * Defers mounting heavy children (a MovieRow with its SWR request, poster
 * batch, availability batch and beacons) until the row approaches the
 * viewport. Once revealed it stays mounted so scroll state, images and
 * pagination survive.
 *
 * This is what keeps a 25-rail page cheap: only the rails a user actually
 * scrolls to ever fire network requests.
 */
export function LazyRow({
  children,
  minHeight = 220,
  rootMargin = "800px",
  eager = false,
}: {
  children: ReactNode
  /** Placeholder height before reveal — roughly one row of cards. */
  minHeight?: number
  rootMargin?: string
  /** Render immediately (above-the-fold rows). */
  eager?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [revealed, setRevealed] = useState(eager)

  useEffect(() => {
    if (revealed) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true)
          observer.disconnect()
        }
      },
      { rootMargin }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [revealed, rootMargin])

  return (
    <div ref={ref} style={revealed ? undefined : { minHeight }}>
      {revealed ? children : null}
    </div>
  )
}
