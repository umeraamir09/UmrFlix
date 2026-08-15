import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { SubtitleOverlay, DEFAULT_SUBTITLE_STYLE } from "../SubtitleOverlay"
import type { VttCue } from "@/lib/vtt"

const CUES: VttCue[] = [
  { id: "1", start: 0, end: 5, text: "First line" },
  { id: "2", start: 5, end: 10, text: "Second line" },
]

afterEach(() => {
  document.body.innerHTML = ""
})

describe("SubtitleOverlay (issue 5.4 — subtitle region announced)", () => {
  it("exposes the dialogue stack as an aria-live region", () => {
    render(
      <SubtitleOverlay
        cues={CUES}
        currentTime={2}
        style={DEFAULT_SUBTITLE_STYLE}
        controlsVisible={false}
      />,
    )
    expect(screen.getByText("First line").parentElement?.getAttribute("aria-live")).toBe("polite")
  })

  it("renders nothing when no cue is active (live region unmounts)", () => {
    const { container } = render(
      <SubtitleOverlay
        cues={CUES}
        currentTime={50}
        style={DEFAULT_SUBTITLE_STYLE}
        controlsVisible={false}
      />,
    )
    expect(container.firstChild).toBeNull()
  })
})
