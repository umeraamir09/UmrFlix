"use client"

import { useMemo } from "react"
import { findActiveCues, type VttCue } from "@/lib/vtt"

export type SubtitleShadowStyle = "uniform" | "drop-shadow" | "raised" | "depressed" | "none"

export type SubtitleStyle = {
  /** Size multiplier: 0.7 S / 1 M / 1.4 L */
  size: number
  color: string
  /** Background opacity 0–1 */
  bgOpacity: number
  /** Drop shadow / text edge style */
  shadowStyle: SubtitleShadowStyle
  /** Sync offset in seconds, -5 .. +5 (positive = subs later) */
  offset: number
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = {
  size: 1,
  color: "#ffffff",
  bgOpacity: 0,
  shadowStyle: "uniform",
  offset: 0,
}

const SUBSTYLE_STORAGE_KEY = "umrflix.substyle"

export function getShadowCss(shadowStyle: SubtitleShadowStyle): string {
  switch (shadowStyle) {
    case "uniform":
      return "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 4px rgba(0,0,0,0.8)"
    case "drop-shadow":
      return "2px 2px 4px rgba(0, 0, 0, 0.9), 1px 1px 2px rgba(0, 0, 0, 0.8)"
    case "raised":
      return "1px 1px 0 #000, 2px 2px 0 #000, 0 -1px 0 #555"
    case "depressed":
      return "-1px -1px 0 #000, 1px 1px 0 #444"
    case "none":
      return "none"
    default:
      return "-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 4px rgba(0,0,0,0.8)"
  }
}

export function loadSubtitleStyle(): SubtitleStyle {
  if (typeof window === "undefined") return DEFAULT_SUBTITLE_STYLE
  try {
    const raw = window.localStorage.getItem(SUBSTYLE_STORAGE_KEY)
    if (!raw) return DEFAULT_SUBTITLE_STYLE
    const parsed = JSON.parse(raw)
    return {
      ...DEFAULT_SUBTITLE_STYLE,
      ...parsed,
      shadowStyle: parsed.shadowStyle ?? DEFAULT_SUBTITLE_STYLE.shadowStyle,
    }
  } catch {
    return DEFAULT_SUBTITLE_STYLE
  }
}

export function saveSubtitleStyle(style: SubtitleStyle) {
  try {
    window.localStorage.setItem(SUBSTYLE_STORAGE_KEY, JSON.stringify(style))
  } catch {}
}

/**
 * Custom VTT cue renderer — gives full styling control (size, colour,
 * background, sync offset) which native <track> cues don't offer.
 */
export function SubtitleOverlay({
  cues,
  currentTime,
  style,
  controlsVisible,
}: {
  cues: VttCue[]
  currentTime: number
  style: SubtitleStyle
  controlsVisible: boolean
}) {
  const activeCues = useMemo(
    () => (cues.length > 0 ? findActiveCues(cues, currentTime - style.offset) : []),
    [cues, currentTime, style.offset],
  )

  if (activeCues.length === 0) return null

  const bottomCues = activeCues.filter(
    (c) =>
      !c.position ||
      (c.position.alignment === "bot-center" &&
        c.position.xPct === undefined &&
        c.position.yPct === undefined),
  )
  const positionedCues = activeCues.filter(
    (c) =>
      c.position &&
      (c.position.alignment !== "bot-center" ||
        c.position.xPct !== undefined ||
        c.position.yPct !== undefined),
  )

  return (
    <>
      {/* Standard bottom dialogue stack */}
      {bottomCues.length > 0 && (
        <div
          className={`pointer-events-none absolute inset-x-0 flex flex-col items-center gap-1.5 px-8 text-center transition-[bottom] duration-300 ${
            controlsVisible ? "bottom-[14cqh]" : "bottom-[5cqh]"
          }`}
        >
          {bottomCues.map((cue, idx) => (
            <span
              key={cue.id ? `${cue.id}-${idx}` : `${cue.start}-${cue.end}-${idx}`}
              className="inline-block rounded font-semibold leading-snug whitespace-pre-wrap max-w-full"
              style={{
                fontSize: `calc(3.4cqw * ${style.size})`,
                color: style.color,
                backgroundColor: `rgba(0, 0, 0, ${style.bgOpacity})`,
                padding: "0.12em 0.4em",
                textShadow: getShadowCss(style.shadowStyle ?? "uniform"),
              }}
              dangerouslySetInnerHTML={{ __html: cue.text }}
            />
          ))}
        </div>
      )}

      {/* Positioned / Pinned sign overlays */}
      {positionedCues.map((cue, idx) => {
        const pos = cue.position!
        const align = pos.alignment
        const xPct =
          pos.xPct ?? (align.endsWith("left") ? 5 : align.endsWith("right") ? 95 : 50)
        const yPct =
          pos.yPct ?? (align.startsWith("top") ? 5 : align.startsWith("mid") ? 50 : 90)

        let translateX = "-50%"
        let translateY = "-50%"

        if (align.endsWith("left")) translateX = "0%"
        else if (align.endsWith("right")) translateX = "-100%"

        if (align.startsWith("top")) translateY = "0%"
        else if (align.startsWith("bot")) translateY = "-100%"

        return (
          <div
            key={cue.id ? `pos-${cue.id}-${idx}` : `pos-${cue.start}-${cue.end}-${idx}`}
            className="pointer-events-none absolute whitespace-pre-wrap text-center max-w-[90%] font-semibold leading-snug rounded"
            style={{
              left: `${xPct}%`,
              top: `${yPct}%`,
              transform: `translate(${translateX}, ${translateY})`,
              fontSize: `calc(3.4cqw * ${style.size})`,
              color: style.color,
              backgroundColor: `rgba(0, 0, 0, ${style.bgOpacity})`,
              padding: "0.12em 0.4em",
              textShadow: getShadowCss(style.shadowStyle ?? "uniform"),
            }}
            dangerouslySetInnerHTML={{ __html: cue.text }}
          />
        )
      })}
    </>
  )
}
