import { useCallback, useState, type RefObject } from "react"

export function useVolumeManager(videoRef: RefObject<HTMLVideoElement | null>) {
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 1
    try {
      const v = window.localStorage.getItem("umrflix.volume")
      if (v !== null) return Math.min(1, Math.max(0, Number(v)))
    } catch {}
    return 1
  })
  const [muted, setMuted] = useState<boolean>(false)

  const updateVolume = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, v))
      setVolume(clamped)
      setMuted(clamped === 0)
      if (videoRef.current) {
        videoRef.current.volume = clamped
        if (clamped > 0) videoRef.current.muted = false
      }
      try {
        window.localStorage.setItem("umrflix.volume", String(clamped))
      } catch {}
    },
    [videoRef],
  )

  const toggleMute = useCallback(() => {
    const v = videoRef.current
    const next = !muted
    if (v) v.muted = next
    setMuted(next)
  }, [muted, videoRef])

  return { volume, muted, updateVolume, toggleMute, setMuted }
}
