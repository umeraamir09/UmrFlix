import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PlayerDebugHud } from "../PlayerDebugHud"

/**
 * jsdom's HTMLMediaElement exposes read-only stubs; defineProperty lets us
 * drive the properties the HUD polls/reads.
 */
function stubVideo(overrides: Record<string, unknown>): HTMLVideoElement {
  const video = document.createElement("video")
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(video, key, { configurable: true, get: () => value })
  }
  return video
}

function playingVideo(): HTMLVideoElement {
  return stubVideo({
    readyState: 4, // HAVE_ENOUGH_DATA
    networkState: 2, // LOADING
    currentTime: 12.34,
    buffered: { length: 1, end: () => 40 },
    duration: 100,
    paused: false,
    seeking: false,
    error: null,
  })
}

function renderHud(video: HTMLVideoElement) {
  return render(
    <PlayerDebugHud
      videoRef={{ current: video }}
      payload={null}
      engine="hls"
      qualityId="auto"
      probeReason="test"
      audioIndex={null}
      subtitleIndex={null}
      streamUrl=""
      onClose={() => {}}
    />,
  )
}

describe("PlayerDebugHud polling (issue 4.4 — interval while paused)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
  })

  it("polls live stats while playing", () => {
    const video = playingVideo()
    const { container } = renderHud(video)
    expect(container.textContent).toContain("t=0.00s") // initial, before first tick

    act(() => {
      vi.advanceTimersByTime(500) // 2 interval ticks
    })
    expect(container.textContent).toContain("HAVE_ENOUGH_DATA")
    expect(container.textContent).toContain("t=12.34s / 100.0s")
    expect(container.textContent).toContain("ahead 27.7s")
    expect(container.textContent).toContain("paused=false")
  })

  it("does not re-render stats while the video is paused", () => {
    const video = playingVideo()
    const { container } = renderHud(video)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    const playingText = container.textContent!

    // Pause and move the playhead far ahead — the interval must NOT poll
    for (const [key, value] of Object.entries({
      paused: true,
      currentTime: 99,
      readyState: 1,
    })) {
      Object.defineProperty(video, key, { configurable: true, get: () => value })
    }

    act(() => {
      vi.advanceTimersByTime(1000) // 4 skipped ticks
    })
    expect(container.textContent).toBe(playingText) // zero updates while paused
    expect(container.textContent).toContain("t=12.34s")
  })

  it("syncs once on pause and seeked events so paused stats are not stale", () => {
    const video = playingVideo()
    const { container } = renderHud(video)
    act(() => {
      vi.advanceTimersByTime(250)
    })

    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => true,
    })
    fireEvent(video, new Event("pause"))
    expect(container.textContent).toContain("paused=true")

    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 99,
    })
    fireEvent(video, new Event("seeked"))
    expect(container.textContent).toContain("t=99.00s")
  })

  it("stops polling after unmount", () => {
    const video = playingVideo()
    const { container, unmount } = renderHud(video)
    unmount()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => 123,
    })
    // Listeners must be removed: firing events after unmount must not throw
    // or touch React state.
    expect(() => {
      fireEvent(video, new Event("seeked"))
      fireEvent(video, new Event("pause"))
    }).not.toThrow()
    expect(container.innerHTML).toBe("")
  })
})
