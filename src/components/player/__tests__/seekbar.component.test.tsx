import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChapterInfo, TrickplayInfo } from "@/lib/playback-types"
import { SeekBar } from "../PlayerControls"
import { trickplayTileUrl, MAX_PRELOAD_TILES } from "../TrickplayPreview"
import { chapterImageUrl } from "../ChapterImagePreview"
import { captureImageSrcs, installPointerEvents, stubBarGeometry } from "./helpers"

const TRICKPLAY: TrickplayInfo = {
  interval: 10_000,
  thumbnailCount: 120,
  width: 320,
  height: 180,
  tileWidth: 5,
  tileHeight: 5,
}

describe("SeekBar scrubbing (issue 4.3 — per-pixel seek spam)", () => {
  beforeEach(() => {
    installPointerEvents()
    stubBarGeometry(200, 20) // clientX 100 = 50%, clientX 150 = 75%
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
  })

  function renderBar(onSeek = vi.fn(), onScrub = vi.fn()) {
    const utils = render(
      <SeekBar
        currentTime={0}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={null}
        onSeek={onSeek}
        onScrubStateChange={onScrub}
      />,
    )
    const bar = utils.container.firstChild as HTMLElement
    const playedFill = () => utils.container.querySelector(".bg-accent") as HTMLElement
    return { ...utils, bar, playedFill, onSeek, onScrub }
  }

  it("tap-to-seek: seeks immediately on press", () => {
    const { bar, onSeek, onScrub } = renderBar()
    fireEvent.pointerDown(bar, { clientX: 100 }) // 50s
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenLastCalledWith(50)
    fireEvent.pointerUp(bar, { clientX: 100 })
    expect(onSeek).toHaveBeenLastCalledWith(50)
    expect(onScrub).toHaveBeenLastCalledWith(false)
  })

  it("drag: previews the position without seeking, then seeks once at release", () => {
    const { bar, playedFill, onSeek, onScrub } = renderBar()

    fireEvent.pointerDown(bar, { clientX: 0 })
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenLastCalledWith(0)

    fireEvent.pointerMove(bar, { clientX: 100 }) // 50s
    fireEvent.pointerMove(bar, { clientX: 150 }) // 75s
    expect(onSeek).toHaveBeenCalledTimes(1) // no video.currentTime writes during drag

    act(() => {
      vi.advanceTimersByTime(16) // flush the rAF-batched preview update
    })
    expect(playedFill().style.width).toBe("75%") // preview followed the cursor

    fireEvent.pointerUp(bar, { clientX: 150 })
    expect(onSeek).toHaveBeenCalledTimes(2) // exactly one seek at release
    expect(onSeek).toHaveBeenLastCalledWith(75)
    expect(onScrub).toHaveBeenLastCalledWith(false)
  })

  it("batches per-pixel pointer moves into a single rAF flush", () => {
    const { bar, playedFill, onSeek } = renderBar()

    fireEvent.pointerDown(bar, { clientX: 0 })
    for (let i = 1; i <= 10; i++) {
      fireEvent.pointerMove(bar, { clientX: i * 18 }) // 9%, 18%, … 90%
    }
    // No rAF flush yet → DOM untouched since pointerdown
    expect(playedFill().style.width).toBe("0%")
    expect(onSeek).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(16) // single flush
    })
    // One flush → final value only (coalesced, no intermediate renders)
    expect(playedFill().style.width).toBe("90%")
    expect(onSeek).toHaveBeenCalledTimes(1)
  })

  it("pointercancel aborts the drag without seeking", () => {
    const { bar, playedFill, onSeek, onScrub } = renderBar()

    fireEvent.pointerDown(bar, { clientX: 0 })
    fireEvent.pointerMove(bar, { clientX: 150 })
    act(() => {
      vi.advanceTimersByTime(16)
    })
    expect(playedFill().style.width).toBe("75%")

    fireEvent.pointerCancel(bar, { clientX: 150 })
    expect(onSeek).toHaveBeenCalledTimes(1) // no seek from the drag
    expect(onScrub).toHaveBeenLastCalledWith(false)
    expect(playedFill().style.width).toBe("0%") // scrub cleared
  })
})

describe("SeekBar trickplay preloading (issue 4.6)", () => {
  beforeEach(() => {
    installPointerEvents()
    stubBarGeometry()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
  })

  it("preloads every trickplay sprite tile on pointer enter", () => {
    const srcs = captureImageSrcs()
    render(
      <SeekBar
        currentTime={0}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={TRICKPLAY}
        onSeek={() => {}}
      />,
    )
    const bar = document.querySelector(".group\\/seek") as HTMLElement
    fireEvent.pointerEnter(bar)

    // 120 thumbs / (5x5 = 25 per tile) = 5 tiles
    const expected = [0, 1, 2, 3, 4].map((i) => trickplayTileUrl("item-1", 320, i))
    for (const url of expected) {
      expect(srcs).toContain(url)
    }
    expect(new Set(srcs).size).toBe(5) // no duplicate fetches
  })

  it("caps preloading at MAX_PRELOAD_TILES for very long content", () => {
    const srcs = captureImageSrcs()
    render(
      <SeekBar
        currentTime={0}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={{ ...TRICKPLAY, thumbnailCount: 10_000, tileWidth: 10, tileHeight: 5 }}
        onSeek={() => {}}
      />,
    )
    const bar = document.querySelector(".group\\/seek") as HTMLElement
    fireEvent.pointerEnter(bar)

    const preloaded = new Set(srcs)
    expect(preloaded.size).toBe(MAX_PRELOAD_TILES)
    expect(preloaded.has(trickplayTileUrl("item-1", 320, 0))).toBe(true)
    expect(preloaded.has(trickplayTileUrl("item-1", 320, MAX_PRELOAD_TILES - 1))).toBe(true)
    expect(preloaded.has(trickplayTileUrl("item-1", 320, MAX_PRELOAD_TILES))).toBe(false)
  })

  it("preloads chapter images as the trickplay-less fallback", () => {
    const srcs = captureImageSrcs()
    const chapters: ChapterInfo[] = [
      { name: "Intro", startSeconds: 0, imageTag: "abc" },
      { name: "No image", startSeconds: 300, imageTag: undefined },
      { name: "Credits", startSeconds: 600, imageTag: "xyz" },
    ]
    render(
      <SeekBar
        currentTime={0}
        duration={100}
        buffered={50}
        chapters={chapters}
        itemId="item-1"
        trickplay={null}
        onSeek={() => {}}
      />,
    )
    const bar = document.querySelector(".group\\/seek") as HTMLElement
    fireEvent.pointerEnter(bar)

    expect(srcs).toContain(chapterImageUrl("item-1", 0, "abc"))
    expect(srcs).toContain(chapterImageUrl("item-1", 2, "xyz"))
    expect(srcs).not.toContain(chapterImageUrl("item-1", 1, ""))
  })
})
