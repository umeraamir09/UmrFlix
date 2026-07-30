"use client"

import { useEffect, useRef } from "react"
import { mutate } from "swr"
import { useToast } from "@/components/Toast"

let sharedEventSource: EventSource | null = null
let subscriberCount = 0

type ReFetchCallback = () => void
const reFetchCallbacks: Set<ReFetchCallback> = new Set()

export function onReFetch(cb: ReFetchCallback): () => void {
  reFetchCallbacks.add(cb)
  return () => reFetchCallbacks.delete(cb)
}

function notifyReFetch() {
  reFetchCallbacks.forEach((cb) => cb())
}

function getSharedEventSource(): EventSource {
  if (!sharedEventSource) {
    sharedEventSource = new EventSource("/api/events")
  }
  return sharedEventSource
}

function closeSharedEventSource(): void {
  subscriberCount--
  if (subscriberCount <= 0 && sharedEventSource) {
    sharedEventSource.close()
    sharedEventSource = null
  }
}

export function useEventStream() {
  const { toast } = useToast()
  const cleanupRef = useRef<() => void | undefined>(undefined)

  useEffect(() => {
    subscriberCount++
    const es = getSharedEventSource()

    const requestCreated = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        mutate("/api/requests")
        notifyReFetch()
        toast(`New request submitted: "${data.title}"`, "info")
      } catch {
        console.error("[EventStream] Failed to parse request:created event")
      }
    }

    const requestUpdated = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        mutate("/api/requests")
        mutate("/api/notifications")
        notifyReFetch()
        mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))

        if (data.status === "approved") {
          toast(`Request approved for "${data.title}"!`, "success")
        } else if (data.status === "denied") {
          toast(`Request denied for "${data.title}".`, "error")
        }
      } catch {
        console.error("[EventStream] Failed to parse request:updated event")
      }
    }

    const notificationCreated = () => {
      mutate("/api/notifications")
      notifyReFetch()
    }

    const mediaGrabbed = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const title = data.movie?.title || data.series?.title || "Media item"
        toast(`Torrent grabbed for "${title}"!`, "info")
        notifyReFetch()
        mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))
      } catch {
        console.error("[EventStream] Failed to parse media:grabbed event")
      }
    }

    const mediaDownloaded = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        const title = data.movie?.title || data.series?.title || "Media item"
        toast(`Download completed: "${title}" is ready!`, "success")
        notifyReFetch()
        mutate((key) => typeof key === "string" && key.startsWith("/api/availability"))
        mutate("/api/library")
      } catch {
        console.error("[EventStream] Failed to parse media:downloaded event")
      }
    }

    es.addEventListener("request:created", requestCreated)
    es.addEventListener("request:updated", requestUpdated)
    es.addEventListener("notification:created", notificationCreated)
    es.addEventListener("media:grabbed", mediaGrabbed)
    es.addEventListener("media:downloaded", mediaDownloaded)

    es.onerror = () => {
      console.error("[EventStream] Connection error, will auto-reconnect")
    }

    cleanupRef.current = () => {
      es.removeEventListener("request:created", requestCreated)
      es.removeEventListener("request:updated", requestUpdated)
      es.removeEventListener("notification:created", notificationCreated)
      es.removeEventListener("media:grabbed", mediaGrabbed)
      es.removeEventListener("media:downloaded", mediaDownloaded)
      closeSharedEventSource()
    }

    return () => {
      cleanupRef.current?.()
    }
  }, [toast])
}
