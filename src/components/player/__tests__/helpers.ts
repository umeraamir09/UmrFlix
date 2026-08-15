import { vi } from "vitest"

/** jsdom lacks PointerEvent; RTL falls back to a plain Event which drops
 *  clientX — polyfill with a MouseEvent subclass so pointer coordinates work. */
export function installPointerEvents() {
  if (typeof window.PointerEvent !== "undefined") return
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number
    pointerType: string
    constructor(
      type: string,
      params?: MouseEventInit & { pointerId?: number; pointerType?: string },
    ) {
      super(type, params)
      this.pointerId = params?.pointerId ?? 1
      this.pointerType = params?.pointerType ?? "mouse"
    }
  }
  Object.defineProperty(window, "PointerEvent", {
    value: PointerEventPolyfill,
    configurable: true,
  })
}

/** jsdom getBoundingClientRect returns all zeros — give the seek bar a real
 *  width so fraction()/clientX math works, and no-op pointer capture. */
export function stubBarGeometry(width = 200, height = 20) {
  const rect = {
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect)
  if (typeof HTMLElement.prototype.setPointerCapture !== "function") {
    // jsdom doesn't implement pointer capture — define a no-op
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
      configurable: true,
      value: () => {},
    })
  }
}

/** Replace window.Image with a spy that records every src assignment
 *  (trickplay tile / chapter image preloads). */
export function captureImageSrcs(): string[] {
  const srcs: string[] = []
  class FakeImage {
    onload: (() => void) | null = null
    private _src = ""
    get src(): string {
      return this._src
    }
    set src(v: string) {
      this._src = v
      srcs.push(v)
    }
  }
  vi.stubGlobal("Image", FakeImage as unknown as typeof Image)
  return srcs
}
