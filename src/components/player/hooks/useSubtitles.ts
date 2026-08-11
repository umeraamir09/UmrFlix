import { useCallback, useEffect, useMemo, useState } from "react"
import type { PlaybackPayload } from "@/lib/playback-types"
import { parseVtt, type VttCue } from "@/lib/vtt"
import {
  loadSubtitleStyle,
  saveSubtitleStyle,
  type SubtitleStyle,
} from "../SubtitleOverlay"

export type UseSubtitlesParams = {
  payload: PlaybackPayload | null
  subtitleIndex: number | null
  burnSubtitles: boolean
}

export function useSubtitles({
  payload,
  subtitleIndex,
  burnSubtitles,
}: UseSubtitlesParams) {
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(() => loadSubtitleStyle())
  const [cueState, setCueState] = useState<{ url: string; cues: VttCue[] } | null>(null)

  const selectedSubtitle = useMemo(() => {
    if (subtitleIndex == null || !payload) return null
    return payload.subtitles.find((s) => s.index === subtitleIndex) ?? null
  }, [payload, subtitleIndex])

  const burnSelectedSubtitle =
    burnSubtitles || (selectedSubtitle != null && selectedSubtitle.isImageBased)

  const clientSideSubtitle =
    selectedSubtitle != null && selectedSubtitle.url != null && !burnSelectedSubtitle

  useEffect(() => {
    if (!clientSideSubtitle || !selectedSubtitle?.url) return
    const url = selectedSubtitle.url
    let cancelled = false
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((text) => {
        if (!cancelled) setCueState({ url, cues: parseVtt(text) })
      })
      .catch(() => {
        if (!cancelled) setCueState({ url, cues: [] })
      })
    return () => {
      cancelled = true
    }
  }, [clientSideSubtitle, selectedSubtitle])

  const cues = useMemo(() => {
    if (!selectedSubtitle || !selectedSubtitle.url) return []
    if (cueState && cueState.url === selectedSubtitle.url) {
      return cueState.cues
    }
    return []
  }, [selectedSubtitle, cueState])

  const updateSubStyle = useCallback((style: SubtitleStyle) => {
    setSubStyle(style)
    saveSubtitleStyle(style)
  }, [])

  return {
    subStyle,
    updateSubStyle,
    selectedSubtitle,
    burnSelectedSubtitle,
    clientSideSubtitle,
    cues,
  }
}
