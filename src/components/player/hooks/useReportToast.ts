import { useCallback, useEffect, useRef, useState } from "react"

const REPORT_TOAST_DURATION_MS = 3_000

export function useReportToast(onReport?: () => void) {
  const [reportToast, setReportToast] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleReport = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }

    if (onReport) {
      onReport()
      return
    }

    setReportToast(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setReportToast(false)
    }, REPORT_TOAST_DURATION_MS)
  }, [onReport])

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return { reportToast, handleReport }
}
