import { fireEvent, render, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFocusTrap } from "../useFocusTrap"

function TrapInner({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap({ containerRef: ref, onClose })
  return (
    <div ref={ref} data-testid="trap">
      <button data-testid="first">First</button>
      <button data-testid="last">Last</button>
    </div>
  )
}

function MountHarness({ onClose = () => {} }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <TrapInner
          onClose={() => {
            setOpen(false)
            onClose()
          }}
        />
      )}
    </div>
  )
}

afterEach(() => {
  document.body.innerHTML = ""
})

describe("useFocusTrap (issues 5.5/5.6 — modal focus trap + Escape close)", () => {
  it("moves focus into the first focusable element on mount", () => {
    render(<MountHarness />)
    fireEvent.click(screen.getByTestId("trigger"))
    expect(document.activeElement).toBe(screen.getByTestId("first"))
  })

  it("traps Tab: wraps from last to first and Shift+Tab from first to last", () => {
    render(<MountHarness />)
    fireEvent.click(screen.getByTestId("trigger"))
    const first = screen.getByTestId("first")
    const last = screen.getByTestId("last")

    last.focus()
    fireEvent.keyDown(window, { key: "Tab" })
    expect(document.activeElement).toBe(first)

    first.focus()
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it("closes on Escape and calls onClose", () => {
    const onClose = vi.fn()
    render(<MountHarness onClose={onClose} />)
    fireEvent.click(screen.getByTestId("trigger"))
    expect(screen.getByTestId("trap")).toBeTruthy()

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("restores focus to the trigger when the trap unmounts", () => {
    render(<MountHarness />)
    const trigger = screen.getByTestId("trigger")
    trigger.focus()
    fireEvent.click(trigger)

    expect(document.activeElement).not.toBe(trigger)
    fireEvent.keyDown(window, { key: "Escape" }) // close → unmount
    expect(document.activeElement).toBe(trigger)
  })
})
