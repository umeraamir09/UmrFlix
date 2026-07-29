"use client"

import { useEffect } from "react"
import { mutate } from "swr"
import { useToast } from "@/components/Toast"

export function useEventStream() {
  const { toast } = useToast()

  useEffect(() => {
    let eventSource: EventSource | null = null
    let retryTimeout: NodeJS.Timeout | null = null

    function connect() {
      eventSource = new EventSource("/api/events")

      eventSource.addEventListener("request:created", (e) => {
        try {
          const data = JSON.parse(e.data)
          mutate("/api/requests")
          toast(`New request submitted: "${data.title}"`, "info")
        } catch {
          /* JSON parse error */
        }
      })

      eventSource.addEventListener("request:updated", (e) => {
        try {
          const data = JSON.parse(e.data)
          mutate("/api/requests")
          mutate("/api/notifications")
          mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))

          if (data.status === "approved") {
            toast(`Request approved for "${data.title}"!`, "success")
          } else if (data.status === "denied") {
            toast(`Request denied for "${data.title}".`, "error")
          }
        } catch {
          /* error */
        }
      })

      eventSource.addEventListener("notification:created", () => {
        mutate("/api/notifications")
      })

      eventSource.addEventListener("media:grabbed", (e) => {
        try {
          const data = JSON.parse(e.data)
          const title = data.movie?.title || data.series?.title || "Media item"
          toast(`Torrent grabbed for "${title}"!`, "info")
          mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))
        } catch {
          /* error */
        }
      })

      eventSource.addEventListener("media:downloaded", (e) => {
        try {
          const data = JSON.parse(e.data)
          const title = data.movie?.title || data.series?.title || "Media item"
          toast(`Download completed: "${title}" is ready!`, "success")
          mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))
          mutate("/api/library")
        } catch {
          /* error */
        }
      })

      eventSource.onerror = () => {
        eventSource?.close()
        retryTimeout = setTimeout(connect, 5_000)
      }
    }

    connect()

    return () => {
      if (eventSource) eventSource.close()
      if (retryTimeout) clearTimeout(retryTimeout)
    }
  }, [toast])
}
