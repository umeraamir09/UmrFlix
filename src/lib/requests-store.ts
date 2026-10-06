import fs from "fs"
import path from "path"
import { getPostgresStore } from "@/lib/db/store"
import type { StoreOperation } from "@/lib/db/store"
import * as radarr from "./radarr"
import * as sonarr from "./sonarr"
import { ensureSonarrSeries } from "./cache"
import { getJellyfinAdmins } from "./jellyfin"
import { eventBus } from "./event-bus"

// ── Notification debug logger ──
// Opt-in via NOTIF_DEBUG=1 (see .env.example). Logs user IDs, usernames and
// admin IDs, so keep it off in production.
function notifLog(scope: string, msg: string, meta?: Record<string, unknown>) {
  if (process.env.NOTIF_DEBUG !== "1") return
  const ts = new Date().toISOString()
  if (meta && Object.keys(meta).length > 0) {
    console.log(`[Notif][${scope}] ${ts} — ${msg}`, meta)
  } else {
    console.log(`[Notif][${scope}] ${ts} — ${msg}`)
  }
}

// Lazy import breaks the requests-store ↔ download-tracker circular dependency
// (each module only calls the other at runtime).
async function triggerTrackerTick(): Promise<void> {
  const { getDownloadTracker } = await import("./download-tracker")
  getDownloadTracker().tick().catch(() => {})
}

export type RequestStatus = "pending" | "approved" | "denied"

export type RequestItem = {
  id: string
  tmdbId: number
  tvdbId?: number
  title: string
  mediaType: "movie" | "tv"
  year?: number
  posterPath?: string | null
  backdropPath?: string | null
  requestedBy: {
    userId: string
    username: string
  }
  requestedAt: string
  status: RequestStatus
  qualityProfileId: number
  rootFolderPath: string
  minimumAvailability?: string
  seriesType?: string
  tags?: number[]
  seasons?: { seasonNumber: number; monitored: boolean }[]
  denialReason?: string
  approvedAt?: string
  approvedBy?: string
  deniedAt?: string
  deniedBy?: string
}

export type NotificationType =
  | "approved"
  | "denied"
  | "party_invite"
  | "admin_request"
  | "download_update"
  | "available"

export type UserNotification = {
  id: string
  userId: string
  requestId?: string
  partyId?: string
  title: string
  message: string
  type: NotificationType
  read: boolean
  createdAt: string
  jellyfinItemId?: string
  mediaType?: "movie" | "tv"
}

type QueryRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>

// Postgres Store operations
const getAllRequestsRef = "requests:getAllRequests" as unknown as QueryRef<Record<string, never>, unknown[]>
const getUserRequestsRef = "requests:getUserRequests" as unknown as QueryRef<{ userId: string }, unknown[]>
const getRequestByIdRef = "requests:getRequestById" as unknown as QueryRef<{ requestId: string }, unknown | null>
const createRequestRef = "requests:createRequest" as unknown as MutationRef<Record<string, unknown>, string>
const updateRequestStatusRef = "requests:updateRequestStatus" as unknown as MutationRef<Record<string, unknown>, boolean>
const getUserNotificationsRef = "requests:getUserNotifications" as unknown as QueryRef<{ userId: string }, unknown[]>
const addNotificationRef = "requests:addNotification" as unknown as MutationRef<Record<string, unknown>, string>
const markNotificationReadRef = "requests:markNotificationRead" as unknown as MutationRef<{ notifId: string; userId: string }, void>
const markAllNotificationsReadRef = "requests:markAllNotificationsRead" as unknown as MutationRef<{ userId: string }, void>
const markRequestNotifsReadRef = "requests:markRequestNotificationsRead" as unknown as MutationRef<{ requestId: string }, void>
const updateNotificationRef = "requests:updateNotification" as unknown as MutationRef<Record<string, unknown>, void>

// ── Local File System Fallback Store ──

type StoreData = {
  requests: RequestItem[]
  notifications: UserNotification[]
}

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "requests.json")

function ensureFileExists(): StoreData {
  if (!fs.existsSync(DATA_DIR)) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    } catch {
      console.warn("[RequestsStore] Cannot create data directory (read-only filesystem)")
    }
  }
  if (!fs.existsSync(FILE_PATH)) {
    const initial: StoreData = { requests: [], notifications: [] }
    try {
      fs.writeFileSync(FILE_PATH, JSON.stringify(initial, null, 2), "utf-8")
    } catch {
      console.warn("[RequestsStore] Cannot write initial file (read-only filesystem)")
    }
    return initial
  }
  try {
    const content = fs.readFileSync(FILE_PATH, "utf-8")
    return JSON.parse(content) as StoreData
  } catch {
    console.warn("[RequestsStore] Failed to read or parse requests file, returning empty store")
    return { requests: [], notifications: [] }
  }
}

function saveStore(data: StoreData) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true })
    }
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), "utf-8")
  } catch {
    console.warn("[RequestsStore] Cannot save store (read-only filesystem)")
  }
}

// ── Public Store Methods ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPostgresRequest(doc: any): RequestItem {
  return {
    id: doc.requestId,
    tmdbId: doc.tmdbId,
    tvdbId: doc.tvdbId,
    title: doc.title,
    mediaType: doc.mediaType as "movie" | "tv",
    year: doc.year,
    posterPath: doc.posterPath,
    backdropPath: doc.backdropPath,
    requestedBy: {
      userId: doc.requestedByUserId,
      username: doc.requestedByUsername,
    },
    requestedAt: doc.requestedAt,
    status: doc.status as RequestStatus,
    qualityProfileId: doc.qualityProfileId,
    rootFolderPath: doc.rootFolderPath,
    minimumAvailability: doc.minimumAvailability,
    seriesType: doc.seriesType,
    tags: doc.tags,
    seasons: doc.seasonsJson ? JSON.parse(doc.seasonsJson) : undefined,
    denialReason: doc.denialReason,
    approvedAt: doc.approvedAt,
    approvedBy: doc.approvedBy,
    deniedAt: doc.deniedAt,
    deniedBy: doc.deniedBy,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapPostgresNotification(doc: any): UserNotification {
  return {
    id: doc.notifId,
    userId: doc.userId,
    requestId: doc.requestId,
    partyId: doc.partyId,
    title: doc.title,
    message: doc.message,
    type: doc.type as NotificationType,
    read: doc.read,
    createdAt: doc.createdAt,
    jellyfinItemId: doc.jellyfinItemId,
    mediaType: doc.mediaType as "movie" | "tv" | undefined,
  }
}

export async function getAllRequests(): Promise<RequestItem[]> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const docs = await postgres.read(getAllRequestsRef, {})
      return docs.map(mapPostgresRequest).sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Postgres] getAllRequests query failed:", err)
      }
      throw err
    }
  }

  const store = ensureFileExists()
  return store.requests.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
}

export async function getUserRequests(userId: string): Promise<RequestItem[]> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const docs = await postgres.read(getUserRequestsRef, { userId })
      return docs.map(mapPostgresRequest).sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Postgres] getUserRequests query failed:", err)
      }
      throw err
    }
  }

  const requests = await getAllRequests()
  return requests.filter((r) => r.requestedBy.userId === userId)
}

export async function getRequestById(id: string): Promise<RequestItem | null> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const doc = await postgres.read(getRequestByIdRef, { requestId: id })
      return doc ? mapPostgresRequest(doc) : null
    } catch (error) {
      throw error
    }
  }

  const store = ensureFileExists()
  return store.requests.find((r) => r.id === id) ?? null
}

export async function createRequest(payload: {
  tmdbId: number
  tvdbId?: number
  title: string
  mediaType: "movie" | "tv"
  year?: number
  posterPath?: string | null
  backdropPath?: string | null
  qualityProfileId: number
  rootFolderPath: string
  minimumAvailability?: string
  seriesType?: string
  tags?: number[]
  seasons?: { seasonNumber: number; monitored: boolean }[]
  requestedBy: { userId: string; username: string }
  autoApprove?: boolean
}): Promise<RequestItem> {
  const existingRequests = await getAllRequests()
  const existingPending = existingRequests.find((r) => {
    if (r.status !== "pending") return false
    if (r.mediaType !== payload.mediaType) return false
    if (payload.mediaType === "movie") {
      return r.tmdbId === payload.tmdbId
    } else {
      const targetTvdb = payload.tvdbId ?? payload.tmdbId
      return r.tmdbId === payload.tmdbId || (r.tvdbId && r.tvdbId === targetTvdb) || r.tmdbId === targetTvdb
    }
  })

  if (existingPending) {
    throw new Error(
      `This item has already been requested by ${existingPending.requestedBy.username}, please wait for an admin to approve the request`
    )
  }

  const id = `req_${Date.now()}_${crypto.randomUUID?.() ?? Math.random().toString(36).substring(2, 15)}`
  const status: RequestStatus = payload.autoApprove ? "approved" : "pending"

  const newRequest: RequestItem = {
    id,
    tmdbId: payload.tmdbId,
    tvdbId: payload.tvdbId,
    title: payload.title,
    mediaType: payload.mediaType,
    year: payload.year,
    posterPath: payload.posterPath,
    backdropPath: payload.backdropPath,
    requestedBy: payload.requestedBy,
    requestedAt: new Date().toISOString(),
    status,
    qualityProfileId: payload.qualityProfileId,
    rootFolderPath: payload.rootFolderPath,
    minimumAvailability: payload.minimumAvailability,
    seriesType: payload.seriesType,
    tags: payload.tags,
    seasons: payload.seasons,
  }

  if (payload.autoApprove) {
    newRequest.approvedAt = new Date().toISOString()
    newRequest.approvedBy = payload.requestedBy.username

    if (payload.mediaType === "movie") {
      await radarr.addMovie({
        tmdbId: payload.tmdbId,
        title: payload.title,
        year: payload.year ?? new Date().getFullYear(),
        qualityProfileId: payload.qualityProfileId,
        rootFolderPath: payload.rootFolderPath,
        minimumAvailability: payload.minimumAvailability,
        tags: payload.tags,
        monitored: true,
        addOptions: { searchForMovie: true },
      })
    } else {
      const resolvedTvdbId = payload.tvdbId ?? payload.tmdbId
      const seasonsPayload =
        payload.seasons ??
        Array.from({ length: 30 }, (_, i) => ({
          seasonNumber: i + 1,
          monitored: true,
        }))

      const seriesMap = await ensureSonarrSeries(() => sonarr.getSeries()).catch(
        () => new Map<number, sonarr.SonarrSeries>()
      )
      const existingSeries = seriesMap.get(resolvedTvdbId)

      if (existingSeries) {
        const existingSeasonsMap = new Map(
          (existingSeries.seasons || []).map((s) => [s.seasonNumber, s.monitored])
        )
        const updatedSeasons = seasonsPayload.map((s) => ({
          seasonNumber: s.seasonNumber,
          monitored: s.monitored || Boolean(existingSeasonsMap.get(s.seasonNumber)),
        }))

        await sonarr.updateSeries({
          ...existingSeries,
          seasons: updatedSeasons,
          monitored: true,
        })
        await sonarr.searchSeries(existingSeries.id).catch(() => {})
      } else {
        await sonarr.addSeries({
          tvdbId: resolvedTvdbId,
          title: payload.title,
          qualityProfileId: payload.qualityProfileId,
          rootFolderPath: payload.rootFolderPath,
          seriesType: payload.seriesType,
          tags: payload.tags,
          monitored: true,
          seasonFolder: true,
          addOptions: { searchForMissingEpisodes: true },
          seasons: seasonsPayload,
        })
      }
    }
  }

  const postgres = getPostgresStore()
  notifLog("createRequest", `Persisting request via ${postgres ? "Postgres" : "local store"}`, {
    requestId: id,
    title: payload.title,
    status,
    userId: payload.requestedBy.userId,
    username: payload.requestedBy.username,
  })

  if (postgres) {
    try {
      await postgres.write(createRequestRef, {
        requestId: id,
        tmdbId: payload.tmdbId,
        tvdbId: payload.tvdbId,
        title: payload.title,
        mediaType: payload.mediaType,
        year: payload.year,
        posterPath: payload.posterPath,
        backdropPath: payload.backdropPath,
        requestedByUserId: payload.requestedBy.userId,
        requestedByUsername: payload.requestedBy.username,
        status,
        qualityProfileId: payload.qualityProfileId,
        rootFolderPath: payload.rootFolderPath,
        minimumAvailability: payload.minimumAvailability,
        seriesType: payload.seriesType,
        tags: payload.tags,
        seasonsJson: payload.seasons ? JSON.stringify(payload.seasons) : undefined,
      })
      notifLog("createRequest", `Postgres mutation OK — requestId=${id}`)
    } catch (err) {
      console.error("[Postgres] createRequest mutation failed:", err)
      throw new Error("Failed to save request to database")
    }
  } else {
    const store = ensureFileExists()
    store.requests.push(newRequest)
    saveStore(store)
    notifLog("createRequest", `Saved to local store — requestId=${id}`)
  }

  if (status === "pending") {
    notifLog("createRequest", `Scheduling admin notification fan-out`, { requestId: id })
    notifyAdminsOfNewRequest(newRequest).catch((err) => {
      notifLog("createRequest", `notifyAdminsOfNewRequest threw`, { requestId: id, error: String(err) })
    })
  } else if (status === "approved") {
    void triggerTrackerTick()
  }

  void import("@/lib/discovery/ingest").then(({ ingestRequestCreated }) =>
    ingestRequestCreated({
      userId: payload.requestedBy.userId,
      itemId: `${payload.mediaType}:${payload.tmdbId}`,
      tmdbId: payload.tmdbId,
      mediaType: payload.mediaType === "tv" ? "tv" : "movie",
      title: payload.title,
    })
  ).catch(() => { /* ingestion must never break requests */ })

  return newRequest
}

export async function approveRequest(id: string, adminUsername: string): Promise<RequestItem> {
  const req = await getRequestById(id)
  if (!req) throw new Error("Request not found")
  if (req.status === "approved") return req

  // Dispatch to Radarr or Sonarr
  if (req.mediaType === "movie") {
    await radarr.addMovie({
      tmdbId: req.tmdbId,
      title: req.title,
      year: req.year ?? new Date().getFullYear(),
      qualityProfileId: req.qualityProfileId,
      rootFolderPath: req.rootFolderPath,
      minimumAvailability: req.minimumAvailability,
      tags: req.tags,
      monitored: true,
      addOptions: { searchForMovie: true },
    })
  } else {
    const resolvedTvdbId = req.tvdbId ?? req.tmdbId
    const seasonsPayload =
      req.seasons ??
      Array.from({ length: 30 }, (_, i) => ({
        seasonNumber: i + 1,
        monitored: true,
      }))

    const seriesMap = await ensureSonarrSeries(() => sonarr.getSeries()).catch(
      () => new Map<number, sonarr.SonarrSeries>()
    )
    const existingSeries = seriesMap.get(resolvedTvdbId)

    if (existingSeries) {
      const existingSeasonsMap = new Map(
        (existingSeries.seasons || []).map((s) => [s.seasonNumber, s.monitored])
      )
      const updatedSeasons = seasonsPayload.map((s) => ({
        seasonNumber: s.seasonNumber,
        monitored: s.monitored || Boolean(existingSeasonsMap.get(s.seasonNumber)),
      }))

      await sonarr.updateSeries({
        ...existingSeries,
        seasons: updatedSeasons,
        monitored: true,
      })
      await sonarr.searchSeries(existingSeries.id).catch(() => {})
    } else {
      await sonarr.addSeries({
        tvdbId: resolvedTvdbId,
        title: req.title,
        qualityProfileId: req.qualityProfileId,
        rootFolderPath: req.rootFolderPath,
        seriesType: req.seriesType,
        tags: req.tags,
        monitored: true,
        seasonFolder: true,
        addOptions: { searchForMissingEpisodes: true },
        seasons: seasonsPayload,
      })
    }
  }

  const approvedAt = new Date().toISOString()
  req.status = "approved"
  req.approvedAt = approvedAt
  req.approvedBy = adminUsername

  const notifId = `notif_${Date.now()}_${crypto.randomUUID?.()?.slice(0, 8) ?? Math.random().toString(36).substring(2, 9)}`

  const notifPayload = {
    id: notifId,
    userId: req.requestedBy.userId,
    requestId: req.id,
    title: `Request Approved: ${req.title}`,
    message: `Your request for "${req.title}" has been approved by ${adminUsername} and sent to the download client.`,
    type: "approved" as const,
    read: false,
    createdAt: new Date().toISOString(),
  }

  const postgres = getPostgresStore()
  notifLog("approveRequest", `Persisting approval via ${postgres ? "Postgres" : "local store"}`, {
    requestId: id,
    title: req.title,
    notifId,
    targetUserId: req.requestedBy.userId,
    adminUsername,
  })

  if (postgres) {
    try {
      await postgres.write(updateRequestStatusRef, {
        requestId: id,
        status: "approved",
        approvedBy: adminUsername,
        approvedAt,
      })
      notifLog("approveRequest", `Postgres updateRequestStatus OK`, { requestId: id })

      await postgres.write(addNotificationRef, {
        notifId,
        userId: req.requestedBy.userId,
        requestId: req.id,
        title: notifPayload.title,
        message: notifPayload.message,
        type: "approved",
      })
      notifLog("approveRequest", `Postgres addNotification OK`, { notifId, targetUserId: req.requestedBy.userId })
    } catch (err) {
      console.error("[Postgres] approveRequest mutation failed:", err)
      throw new Error("Failed to update request status in database")
    }
  } else {
    const store = ensureFileExists()
    const idx = store.requests.findIndex((r) => r.id === id)
    if (idx !== -1) {
      store.requests[idx] = req
    }
    store.notifications.push(notifPayload)
    saveStore(store)
    notifLog("approveRequest", `Saved approval + notification to local store`, { requestId: id, notifId })
  }

  notifLog("approveRequest", `Emitting SSE events request:updated + notification:created`, {
    requestId: id,
    audience: [req.requestedBy.userId],
  })
  eventBus.emitEvent({ type: "request:updated", payload: req })
  eventBus.emitEvent({ type: "notification:created", payload: { ...notifPayload, audience: [req.requestedBy.userId] } })

  markAdminRequestNotifsRead(req.id).catch(() => {})
  void triggerTrackerTick()

  return req
}

export async function denyRequest(id: string, adminUsername: string, reason?: string): Promise<RequestItem> {
  const req = await getRequestById(id)
  if (!req) throw new Error("Request not found")

  const deniedAt = new Date().toISOString()
  const denialReason = reason || "Request denied by administrator."

  req.status = "denied"
  req.deniedAt = deniedAt
  req.deniedBy = adminUsername
  req.denialReason = denialReason

  const notifId = `notif_${Date.now()}_${crypto.randomUUID?.()?.slice(0, 8) ?? Math.random().toString(36).substring(2, 9)}`
  const message = `Your request for "${req.title}" was denied by ${adminUsername}.${reason ? ` Reason: ${reason}` : ""}`

  const notifPayload = {
    id: notifId,
    userId: req.requestedBy.userId,
    requestId: req.id,
    title: `Request Denied: ${req.title}`,
    message,
    type: "denied" as const,
    read: false,
    createdAt: new Date().toISOString(),
  }

  const postgres = getPostgresStore()
  notifLog("denyRequest", `Persisting denial via ${postgres ? "Postgres" : "local store"}`, {
    requestId: id,
    title: req.title,
    notifId,
    targetUserId: req.requestedBy.userId,
    adminUsername,
    denialReason,
  })

  if (postgres) {
    try {
      await postgres.write(updateRequestStatusRef, {
        requestId: id,
        status: "denied",
        deniedBy: adminUsername,
        deniedAt,
        denialReason,
      })
      notifLog("denyRequest", `Postgres updateRequestStatus OK`, { requestId: id })

      await postgres.write(addNotificationRef, {
        notifId,
        userId: req.requestedBy.userId,
        requestId: req.id,
        title: `Request Denied: ${req.title}`,
        message,
        type: "denied",
      })
      notifLog("denyRequest", `Postgres addNotification OK`, { notifId, targetUserId: req.requestedBy.userId })
    } catch (err) {
      console.error("[Postgres] denyRequest mutation failed:", err)
      throw new Error("Failed to update request status in database")
    }
  } else {
    const store = ensureFileExists()
    const idx = store.requests.findIndex((r) => r.id === id)
    if (idx !== -1) {
      store.requests[idx] = req
    }
    store.notifications.push(notifPayload)
    saveStore(store)
    notifLog("denyRequest", `Saved denial + notification to local store`, { requestId: id, notifId })
  }

  notifLog("denyRequest", `Emitting SSE events request:updated + notification:created`, {
    requestId: id,
    audience: [req.requestedBy.userId],
  })
  eventBus.emitEvent({ type: "request:updated", payload: req })
  eventBus.emitEvent({ type: "notification:created", payload: { ...notifPayload, audience: [req.requestedBy.userId] } })

  markAdminRequestNotifsRead(req.id).catch(() => {})

  return req
}

export async function getUserNotifications(userId: string): Promise<UserNotification[]> {
  const postgres = getPostgresStore()
  notifLog("getUserNotifications", `Fetching notifications via ${postgres ? "Postgres" : "local store"}`, { userId })

  if (postgres) {
    try {
      const docs = await postgres.read(getUserNotificationsRef, { userId })
      const mapped = docs.map(mapPostgresNotification).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      notifLog("getUserNotifications", `Postgres returned ${mapped.length} notification(s)`, {
        userId,
        unread: mapped.filter((n) => !n.read).length,
        types: [...new Set(mapped.map((n) => n.type))],
      })
      return mapped
    } catch (err) {
      notifLog("getUserNotifications", `Postgres query failed`, { userId, error: String(err) })
      throw err
    }
  }

  const store = ensureFileExists()
  const result = store.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  notifLog("getUserNotifications", `Local store returned ${result.length} notification(s)`, { userId })
  return result
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  const postgres = getPostgresStore()
  notifLog("markNotificationRead", `Marking notifId=${notificationId} as read via ${postgres ? "Postgres" : "local store"}`, { userId })

  if (postgres) {
    try {
      await postgres.write(markNotificationReadRef, { notifId: notificationId, userId })
      notifLog("markNotificationRead", `Postgres mutation OK`, { notifId: notificationId, userId })
      return
    } catch (err) {
      notifLog("markNotificationRead", `Postgres mutation failed`, { notifId: notificationId, error: String(err) })
      throw err
    }
  }

  const store = ensureFileExists()
  const notif = store.notifications.find((n) => n.id === notificationId && n.userId === userId)
  if (notif) {
    notif.read = true
    saveStore(store)
    notifLog("markNotificationRead", `Local store updated`, { notifId: notificationId, userId })
  } else {
    notifLog("markNotificationRead", `WARNING: notification not found in local store`, { notifId: notificationId, userId })
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const postgres = getPostgresStore()
  notifLog("markAllNotificationsRead", `Marking all as read via ${postgres ? "Postgres" : "local store"}`, { userId })

  if (postgres) {
    try {
      await postgres.write(markAllNotificationsReadRef, { userId })
      notifLog("markAllNotificationsRead", `Postgres mutation OK`, { userId })
      return
    } catch (err) {
      notifLog("markAllNotificationsRead", `Postgres mutation failed`, { userId, error: String(err) })
      throw err
    }
  }

  const store = ensureFileExists()
  let changed = 0
  for (const n of store.notifications) {
    if (n.userId === userId && !n.read) {
      n.read = true
      changed++
    }
  }
  if (changed > 0) {
    saveStore(store)
  }
  notifLog("markAllNotificationsRead", `Local store updated — ${changed} notification(s) marked read`, { userId })
}

export async function addPartyInviteNotification(notifPayload: UserNotification): Promise<void> {
  const postgres = getPostgresStore()
  let persisted = false
  if (postgres) {
    try {
      await postgres.write(addNotificationRef, {
        notifId: notifPayload.id,
        userId: notifPayload.userId,
        requestId: notifPayload.requestId,
        partyId: notifPayload.partyId,
        title: notifPayload.title,
        message: notifPayload.message,
        type: "party_invite",
      })
      persisted = true
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Postgres] addPartyInviteNotification failed:", err)
      }
      throw err
    }
  }

  if (!persisted) {
    const store = ensureFileExists()
    store.notifications.push(notifPayload)
    saveStore(store)
  }

  eventBus.emitEvent({
    type: "notification:created",
    payload: { ...notifPayload, audience: [notifPayload.userId] },
  })
}

// ── Generic notification persistence ──

function genNotifId(): string {
  return `notif_${Date.now()}_${crypto.randomUUID?.()?.slice(0, 8) ?? Math.random().toString(36).substring(2, 9)}`
}

async function persistNotification(notif: UserNotification): Promise<void> {
  const postgres = getPostgresStore()
  notifLog("persistNotification", `Persisting via ${postgres ? "Postgres" : "local store"}`, {
    notifId: notif.id,
    type: notif.type,
    userId: notif.userId,
    requestId: notif.requestId,
    title: notif.title,
  })

  if (postgres) {
    try {
      await postgres.write(addNotificationRef, {
        notifId: notif.id,
        userId: notif.userId,
        requestId: notif.requestId,
        partyId: notif.partyId,
        title: notif.title,
        message: notif.message,
        type: notif.type,
        jellyfinItemId: notif.jellyfinItemId,
        mediaType: notif.mediaType,
      })
      notifLog("persistNotification", `Postgres mutation OK`, { notifId: notif.id, type: notif.type })
      return
    } catch (err) {
      notifLog("persistNotification", `Postgres mutation failed`, { notifId: notif.id, error: String(err) })
      throw err
    }
  }

  const store = ensureFileExists()
  store.notifications.push(notif)
  saveStore(store)
  notifLog("persistNotification", `Saved to local store`, { notifId: notif.id, type: notif.type })
}

export async function updateNotificationMessage(
  notificationId: string,
  userId: string,
  message: string
): Promise<void> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      await postgres.write(updateNotificationRef, { notifId: notificationId, userId, message })
      return
    } catch (error) {
      throw error
    }
  }

  const store = ensureFileExists()
  const notif = store.notifications.find((n) => n.id === notificationId && n.userId === userId)
  if (notif) {
    notif.message = message
    saveStore(store)
  }
}

async function findNotifications(userId: string, type: NotificationType, requestId: string): Promise<UserNotification[]> {
  const all = await getUserNotifications(userId)
  return all.filter((n) => n.type === type && n.requestId === requestId)
}

function formatDownloadMessage(title: string, progress: number): string {
  return `"${title}" is downloading — ${Math.min(100, Math.max(0, Math.round(progress)))}% complete.`
}

// ── Admin request notifications ──

export async function notifyAdminsOfNewRequest(req: RequestItem): Promise<void> {
  notifLog("notifyAdmins", `Resolving Jellyfin admin IDs for request`, { requestId: req.id, title: req.title })
  const adminIds = await getJellyfinAdmins()
  notifLog("notifyAdmins", `Resolved ${adminIds.length} admin(s)`, { adminIds })
  if (adminIds.length === 0) {
    notifLog("notifyAdmins", `WARNING: no admin IDs resolved — admin notification will NOT be sent`, { requestId: req.id })
    return
  }

  const createdAt = new Date().toISOString()
  const typeLabel = req.mediaType === "movie" ? "movie" : "TV show"
  const details = [
    `Requested by ${req.requestedBy.username}`,
    req.year ? String(req.year) : null,
    req.mediaType === "tv" && req.seasons
      ? `${req.seasons.filter((s) => s.monitored).length} season(s)`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

  for (const adminId of adminIds) {
    const notif: UserNotification = {
      id: genNotifId(),
      userId: adminId,
      requestId: req.id,
      title: `New Request: ${req.title}`,
      message: `${typeLabel} "${req.title}" — ${details}. Review and approve or deny the request.`,
      type: "admin_request",
      read: false,
      createdAt,
      mediaType: req.mediaType,
    }
    notifLog("notifyAdmins", `Persisting admin_request notification for adminId=${adminId}`, {
      notifId: notif.id,
      requestId: req.id,
      title: notif.title,
    })
    await persistNotification(notif)
    notifLog("notifyAdmins", `Emitting SSE notification:created for adminId=${adminId}`, { notifId: notif.id })
    eventBus.emitEvent({
      type: "notification:created",
      payload: { ...notif, audience: [adminId] },
    })
  }
  notifLog("notifyAdmins", `Fan-out complete — notified ${adminIds.length} admin(s)`, { requestId: req.id })
}

// ── Download progress notifications ──

export async function notifyDownloadStarted(req: RequestItem, progress?: number): Promise<string | null> {
  notifLog("notifyDownloadStarted", `Checking for existing download_update notification`, {
    requestId: req.id,
    title: req.title,
    userId: req.requestedBy.userId,
    pct: progress ?? 0,
  })

  const existing = await findNotifications(req.requestedBy.userId, "download_update", req.id)
  if (existing.length > 0) {
    const n = existing[0]
    notifLog("notifyDownloadStarted", `Existing download notification found — updating message`, {
      notifId: n.id,
      read: n.read,
      pct: progress ?? null,
    })
    // Only rewrite the message when a real progress value is supplied; callers
    // without one (e.g. media:grabbed webhooks) must not reset the message.
    if (progress != null && !n.read) {
      await updateNotificationMessage(n.id, n.userId, formatDownloadMessage(req.title, progress))
    }
    return n.id
  }

  notifLog("notifyDownloadStarted", `No existing notification — creating new download_update notification`, {
    requestId: req.id,
    title: req.title,
    userId: req.requestedBy.userId,
    pct: progress ?? 0,
  })

  const notif: UserNotification = {
    id: genNotifId(),
    userId: req.requestedBy.userId,
    requestId: req.id,
    title: `Downloading: ${req.title}`,
    message: formatDownloadMessage(req.title, progress ?? 0),
    type: "download_update",
    read: false,
    createdAt: new Date().toISOString(),
    mediaType: req.mediaType,
  }
  await persistNotification(notif)
  notifLog("notifyDownloadStarted", `Emitting SSE notification:created`, {
    notifId: notif.id,
    audience: [notif.userId],
  })
  eventBus.emitEvent({
    type: "notification:created",
    payload: { ...notif, audience: [notif.userId] },
  })
  return notif.id
}

export async function updateDownloadProgressNotif(req: RequestItem, progress: number): Promise<void> {
  notifLog("updateDownloadProgressNotif", `Updating download progress`, {
    requestId: req.id,
    title: req.title,
    userId: req.requestedBy.userId,
    progress: Math.round(progress),
  })
  const existing = await findNotifications(req.requestedBy.userId, "download_update", req.id)
  if (existing.length > 0) {
    const n = existing[0]
    if (!n.read) {
      const updatedMessage = formatDownloadMessage(req.title, progress)
      await updateNotificationMessage(n.id, n.userId, updatedMessage)
      eventBus.emitEvent({
        type: "notification:created",
        payload: { ...n, message: updatedMessage, audience: [n.userId] },
      })
    } else {
      notifLog("updateDownloadProgressNotif", `Skipping update — notification already marked read`, { notifId: n.id })
    }
    return
  }
  notifLog("updateDownloadProgressNotif", `No existing notification found — creating one`, { requestId: req.id })
  await notifyDownloadStarted(req, progress)
}

// ── "Available to play" notifications ──

export async function notifyItemAvailable(req: RequestItem, jellyfinItemId?: string | null): Promise<boolean> {
  notifLog("notifyItemAvailable", `Checking if already notified for availability`, {
    requestId: req.id,
    title: req.title,
    userId: req.requestedBy.userId,
    jellyfinItemId: jellyfinItemId ?? null,
  })

  const userNotifs = await getUserNotifications(req.requestedBy.userId)
  const alreadyNotified = userNotifs.some((n) => n.type === "available" && n.requestId === req.id)
  if (alreadyNotified) {
    notifLog("notifyItemAvailable", `Already notified — skipping`, { requestId: req.id })
    return false
  }

  const existingDl = userNotifs.find((n) => n.type === "download_update" && n.requestId === req.id)
  if (existingDl && !existingDl.read) {
    notifLog("notifyItemAvailable", `Marking stale download_update notification as read`, { notifId: existingDl.id })
    await markNotificationRead(existingDl.id, existingDl.userId)
  }

  const notif: UserNotification = {
    id: genNotifId(),
    userId: req.requestedBy.userId,
    requestId: req.id,
    title: `Available Now: ${req.title}`,
    message: `"${req.title}" has finished downloading and is now ready to watch.`,
    type: "available",
    read: false,
    createdAt: new Date().toISOString(),
    jellyfinItemId: jellyfinItemId ?? undefined,
    mediaType: req.mediaType,
  }
  notifLog("notifyItemAvailable", `Persisting 'available' notification`, {
    notifId: notif.id,
    title: notif.title,
    jellyfinItemId: jellyfinItemId ?? null,
  })
  await persistNotification(notif)
  notifLog("notifyItemAvailable", `Emitting SSE download:available + notification:created`, {
    notifId: notif.id,
    audience: [notif.userId],
  })
  eventBus.emitEvent({
    type: "notification:created",
    payload: { ...notif, title: req.title, audience: [notif.userId] },
  })
  return true
}

// Backfills `jellyfinItemId` onto an already-created "available" notification
// (e.g. one created by a webhook before the Jellyfin index caught up), so the
// "Watch Now" action can render later.
export async function enrichAvailableNotification(req: RequestItem, jellyfinItemId: string): Promise<void> {
  const userNotifs = await getUserNotifications(req.requestedBy.userId)
  const notif = userNotifs.find((n) => n.type === "available" && n.requestId === req.id)
  if (!notif || notif.jellyfinItemId || !jellyfinItemId) return

  const postgres = getPostgresStore()
  if (postgres) {
    try {
      await postgres.write(updateNotificationRef, {
        notifId: notif.id,
        userId: notif.userId,
        jellyfinItemId,
      })
      return
    } catch (error) {
      throw error
    }
  }

  const store = ensureFileExists()
  const target = store.notifications.find((n) => n.id === notif.id && n.userId === notif.userId)
  if (target) {
    target.jellyfinItemId = jellyfinItemId
    saveStore(store)
  }
}

// Marks the admin_request notifications for a request as read once an admin
// has acted on it (approve/deny), so stale unread items don't accumulate.
export async function markAdminRequestNotifsRead(requestId: string): Promise<void> {
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      await postgres.write(markRequestNotifsReadRef, { requestId })
      return
    } catch (error) {
      throw error
    }
  }

  const store = ensureFileExists()
  let changed = false
  for (const n of store.notifications) {
    if (n.requestId === requestId && n.type === "admin_request" && !n.read) {
      n.read = true
      changed = true
    }
  }
  if (changed) saveStore(store)
}

