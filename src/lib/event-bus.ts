import { EventEmitter } from "events"

export type AppServerEvent =
  | { type: "request:created"; payload: Record<string, unknown> }
  | { type: "request:updated"; payload: Record<string, unknown> }
  | { type: "notification:created"; payload: Record<string, unknown> }
  | { type: "media:grabbed"; payload: Record<string, unknown> }
  | { type: "media:downloaded"; payload: Record<string, unknown> }
  | { type: "media:renamed"; payload: Record<string, unknown> }

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
