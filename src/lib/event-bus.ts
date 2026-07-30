import { EventEmitter } from "events"
import type { RequestItem, UserNotification } from "./requests-store"

type MediaGrabbedPayload = {
  movie?: { title: string }
  series?: { title: string }
  torrentHash?: string
}

type MediaDownloadedPayload = {
  movie?: { title: string }
  series?: { title: string }
}

type MediaRenamedPayload = {
  movie?: { title: string }
  series?: { title: string }
}

export type AppServerEvent =
  | { type: "request:created"; payload: RequestItem }
  | { type: "request:updated"; payload: RequestItem }
  | { type: "notification:created"; payload: UserNotification }
  | { type: "media:grabbed"; payload: MediaGrabbedPayload }
  | { type: "media:downloaded"; payload: MediaDownloadedPayload }
  | { type: "media:renamed"; payload: MediaRenamedPayload }

class AppEventBus extends EventEmitter {
  constructor() {
    super()
    this.setMaxListeners(100)
  }

  public emitEvent(event: AppServerEvent) {
    this.emit("event", event)
  }

  public onEvent(listener: (event: AppServerEvent) => void) {
    this.on("event", listener)
    return () => this.off("event", listener)
  }
}

// Preserve instance across Next.js dev fast reloads
const globalForEventBus = globalThis as unknown as {
  eventBus: AppEventBus | undefined
}

export const eventBus = globalForEventBus.eventBus ?? new AppEventBus()

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.eventBus = eventBus
}
