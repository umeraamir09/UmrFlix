import { useEffect, useRef } from "react"

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
  )
}

/**
 * Traps keyboard focus inside `containerRef` while mounted: moves focus in on
 * activation, wraps Tab / Shift+Tab within the container, and closes on Escape.
 * Focus is restored to the previously-focused element (the trigger) on unmount.
 *
 * The listener runs in the CAPTURE phase on `window` so Tab/Escape are
 * intercepted even when a child handler (e.g. a menu popover that stops
 * propagation to the player surface) would otherwise swallow them.
 */
export function useFocusTrap({
  containerRef,
  onClose,
  restoreFocus = true,
}: {
  containerRef: React.RefObject<HTMLElement | null>
  /** Called when Escape is pressed while focus is inside the container. */
  onClose?: () => void
  /** Restore focus to the previously-focused element on unmount. Default true. */
  restoreFocus?: boolean
}) {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const previouslyFocused = restoreFocus ? document.activeElement : null
    const fallback = restoreFocus
      ? (container.closest<HTMLElement>('[role="application"], [tabindex="0"]') ?? null)
      : null

    // Move focus into the trap: first focusable element, or the container itself.
    const focusables = getFocusable(container)
    ;(focusables[0] ?? container).focus({ preventScroll: true })

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!container.contains(document.activeElement)) return
      if (e.key === "Escape") {
        e.stopPropagation()
        onCloseRef.current?.()
        return
      }
      if (e.key !== "Tab") return
      const els = getFocusable(container)
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || document.activeElement === container)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true })

    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true })
      if (!restoreFocus) return
      if (
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected &&
        previouslyFocused !== document.body
      ) {
        previouslyFocused.focus({ preventScroll: true })
      } else if (fallback && fallback.isConnected && fallback !== container) {
        fallback.focus({ preventScroll: true })
      }
    }
  }, [containerRef, restoreFocus])
}
