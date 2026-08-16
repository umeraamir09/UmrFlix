import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { preloadImages, usePreloadedImage } from "../use-preloaded-image"

let srcs: string[]
let instances: FakeImage[]
let autoFire: boolean

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  private _src = ""
  get src(): string {
    return this._src
  }
  set src(v: string) {
    this._src = v
    srcs.push(v)
    instances.push(this)
    if (autoFire) this.onload?.()
  }
}

function installFakeImage() {
  srcs = []
  instances = []
  autoFire = true
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image)
}

function Probe({ url }: { url: string }) {
  const loaded = usePreloadedImage(url)
  return <div data-loaded={loaded ? "true" : "false"} />
}

describe("preloadImages (issue 4.6 follow-up — shared cache)", () => {
  beforeEach(installFakeImage)
  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it("a completed preload makes usePreloadedImage render loaded instantly, with one request", () => {
    const url = "http://x/instant"
    preloadImages([url])
    expect(srcs).toEqual([url]) // preload issued exactly one request

    const { container } = render(<Probe url={url} />)
    expect(container.querySelector('[data-loaded="true"]')).not.toBeNull()
    expect(srcs).toEqual([url]) // hook reused the cache, no second Image
  })

  it("an in-flight preload lets the hook await its own request", () => {
    autoFire = false
    const url = "http://x/inflight"
    preloadImages([url]) // instance[0] pending
    const { container } = render(<Probe url={url} />)
    expect(container.querySelector('[data-loaded="true"]')).toBeNull()
    expect(instances.length).toBe(2) // hook issued its own Image (preload not shared)

    act(() => {
      instances[1].onload?.()
    })
    expect(container.querySelector('[data-loaded="true"]')).not.toBeNull()
  })

  it("does not duplicate fetches for repeated URLs in one call", () => {
    const url = "http://x/dup"
    preloadImages([url, url, url])
    expect(srcs).toEqual([url])
  })

  it("retries a failed preload from the hook (failures are not cached)", () => {
    autoFire = false
    const url = "http://x/fail"
    preloadImages([url]) // instance[0] pending
    act(() => {
      instances[0].onerror?.() // preload fails → not cached
    })
    render(<Probe url={url} />)
    expect(instances.length).toBe(2) // hook retried on its own
    expect(instances[1].src).toBe(url)
  })
})