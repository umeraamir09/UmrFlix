import { useEffect } from "react"

export function useReporterCleanup(itemId: string, stop: () => void) {
  useEffect(() => {
    return () => stop()
  }, [itemId, stop])
}
