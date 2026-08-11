import { useCallback, useEffect, useRef, useState } from "react"

const CONTROLS_HIDE_DELAY = 3_500

export type UsePlayerControlsParams = {
  playing: boolean
  episodeBrowserOpen: boolean
}

export function usePlayerControls({
  playing,
  episodeBrowserOpen,
}: UsePlayerControlsParams) {
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pokeControls = useCallback(() => {
    setControlsVisible(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
    }, CONTROLS_HIDE_DELAY)
  }, [])

  useEffect(() => {
    if (!playing || episodeBrowserOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setControlsVisible(true)
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    } else {
      pokeControls()
    }
  }, [playing, episodeBrowserOpen, pokeControls])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    }
  }, [])

  return {
    controlsVisible,
    setControlsVisible,
    pokeControls,
  }
}
