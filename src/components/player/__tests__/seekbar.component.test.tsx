import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ChapterInfo, TrickplayInfo } from "@/lib/playback-types"
import { SeekBar } from "../PlayerControls"
import { trickplayTileUrl, MAX_PRELOAD_TILES } from "../TrickplayPreview"
import { chapterImageUrl, MAX_PRELOAD_CHAPTERS } from "../ChapterImagePreview"
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

describe("SeekBar keyboard accessibility (issue 5.1 — slider semantics)", () => {
  beforeEach(() => {
    installPointerEvents()
    stubBarGeometry(200, 20)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    cleanup()
  })

  function renderBar(onSeek = vi.fn()) {
    const utils = render(
      <SeekBar
        currentTime={0}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={null}
        onSeek={onSeek}
      />,
    )
    const bar = utils.container.firstChild as HTMLElement
    return { ...utils, bar, onSeek }
  }

  it("exposes slider ARIA attributes", () => {
    const { bar } = renderBar()
    expect(bar.getAttribute("role")).toBe("slider")
    expect(bar.getAttribute("aria-label")).toBe("Seek bar")
    expect(bar.getAttribute("aria-valuemin")).toBe("0")
    expect(bar.getAttribute("aria-valuemax")).toBe("100")
    expect(bar.getAttribute("aria-valuenow")).toBe("0")
    expect(bar.getAttribute("aria-valuetext")).toBe("0:00")
    expect(bar.tabIndex).toBe(0)
  })

  it("arrow keys seek ±10s and prevent the player surface shortcuts", () => {
    const { bar, onSeek } = renderBar()
    expect(fireEvent.keyDown(bar, { key: "ArrowRight" })).toBe(false) // defaultPrevented
    expect(onSeek).toHaveBeenLastCalledWith(10)
    fireEvent.keyDown(bar, { key: "ArrowLeft" })
    expect(onSeek).toHaveBeenLastCalledWith(0)
  })

  it("Home/End jump to the start and end of the media", () => {
    const { bar, onSeek } = renderBar()
    fireEvent.keyDown(bar, { key: "End" })
    expect(onSeek).toHaveBeenLastCalledWith(100)
    fireEvent.keyDown(bar, { key: "Home" })
    expect(onSeek).toHaveBeenLastCalledWith(0)
  })

  it("clamps keyboard seeks to the media bounds", () => {
    const onSeekEnd = vi.fn()
    const nearEnd = render(
      <SeekBar
        currentTime={95}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={null}
        onSeek={onSeekEnd}
      />,
    )
    fireEvent.keyDown(nearEnd.container.firstChild as HTMLElement, { key: "ArrowRight" })
    expect(onSeekEnd).toHaveBeenLastCalledWith(100) // 95+10 clamped to duration

    const onSeekStart = vi.fn()
    const nearStart = render(
      <SeekBar
        currentTime={2}
        duration={100}
        buffered={50}
        chapters={[]}
        itemId="item-1"
        trickplay={null}
        onSeek={onSeekStart}
      />,
    )
    fireEvent.keyDown(nearStart.container.firstChild as HTMLElement, { key: "ArrowLeft" })
    expect(onSeekStart).toHaveBeenLastCalledWith(0) // 2-10 clamped to 0
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

  it("caps chapter image preloading at MAX_PRELOAD_CHAPTERS", () => {
    const srcs = captureImageSrcs()
    const chapters: ChapterInfo[] = Array.from({ length: 40 }, (_, i) => ({
      name: `Ch ${i}`,
      startSeconds: i * 60,
      imageTag: `tag${i}`,
    }))
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

    const preloaded = new Set(srcs)
    expect(preloaded.size).toBe(MAX_PRELOAD_CHAPTERS)
    expect(preloaded.has(chapterImageUrl("item-1", 0, "tag0"))).toBe(true)
    expect(preloaded.has(chapterImageUrl("item-1", MAX_PRELOAD_CHAPTERS - 1, `tag${MAX_PRELOAD_CHAPTERS - 1}`))).toBe(true)
    expect(preloaded.has(chapterImageUrl("item-1", MAX_PRELOAD_CHAPTERS, `tag${MAX_PRELOAD_CHAPTERS}`))).toBe(false)
  })
})
