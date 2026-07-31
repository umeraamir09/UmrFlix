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

import type { PartyMember, PartyState } from "./party/protocol"

export type AppServerEvent =
  | { type: "request:created"; payload: RequestItem }
  | { type: "request:updated"; payload: RequestItem }
  | { type: "notification:created"; payload: UserNotification & { audience?: string[] } }
  | { type: "media:grabbed"; payload: MediaGrabbedPayload }
  | { type: "media:downloaded"; payload: MediaDownloadedPayload }
  | { type: "media:renamed"; payload: MediaRenamedPayload }
  | { type: "party:state"; payload: { partyId: string; state: PartyState; audience: string[] } }
  | { type: "party:membership"; payload: { partyId: string; action: "join" | "leave" | "owner-changed" | "ended"; ownerId: string; members: PartyMember[]; audience: string[] } }
  | { type: "party:invited"; payload: { partyId: string; inviterId: string; inviterName: string; audience: string[] } }
  | { type: "party:ended"; payload: { partyId: string; audience: string[] } }
  | { type: "party:item"; payload: { partyId: string; itemId: string; state: PartyState; audience: string[] } }

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

// Preserve instance across Next.js route handlers and dev fast reloads
const globalForEventBus = globalThis as unknown as {
  eventBus: AppEventBus | undefined
}

export const eventBus =
  globalForEventBus.eventBus ??
  (globalForEventBus.eventBus = new AppEventBus())
