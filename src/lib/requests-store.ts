import fs from "fs"
import path from "path"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"
import * as radarr from "./radarr"
import * as sonarr from "./sonarr"
import { eventBus } from "./event-bus"

export type RequestStatus = "pending" | "approved" | "denied"


export type RequestItem = {
  id: string
  tmdbId: number
  tvdbId?: number
  title: string
  mediaType: "movie" | "tv"
  year?: number
  posterPath?: string
  backdropPath?: string
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


export type UserNotification = {
  id: string
  userId: string
  requestId: string
  title: string
  message: string
  type: "approved" | "denied"
  read: boolean
  createdAt: string
}

type QueryRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"query", "public", Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"mutation", "public", Args, Ret>

// Convex Function References
const getAllRequestsRef = "requests:getAllRequests" as unknown as QueryRef<Record<string, never>, unknown[]>
const getUserRequestsRef = "requests:getUserRequests" as unknown as QueryRef<{ userId: string }, unknown[]>
const getRequestByIdRef = "requests:getRequestById" as unknown as QueryRef<{ requestId: string }, unknown | null>
const createRequestRef = "requests:createRequest" as unknown as MutationRef<Record<string, unknown>, string>
const updateRequestStatusRef = "requests:updateRequestStatus" as unknown as MutationRef<Record<string, unknown>, boolean>
const getUserNotificationsRef = "requests:getUserNotifications" as unknown as QueryRef<{ userId: string }, unknown[]>
const addNotificationRef = "requests:addNotification" as unknown as MutationRef<Record<string, unknown>, string>
const markNotificationReadRef = "requests:markNotificationRead" as unknown as MutationRef<{ notifId: string; userId: string }, void>
const markAllNotificationsReadRef = "requests:markAllNotificationsRead" as unknown as MutationRef<{ userId: string }, void>

function getConvexClient(): ConvexHttpClient | null {
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY

  if (!url) return null

  try {
    const client = new ConvexHttpClient(url, {
      skipConvexDeploymentUrlCheck: true,
    })
    if (adminKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawClient = client as any
      if (typeof rawClient.setAdminAuth === "function") {
        rawClient.setAdminAuth(adminKey)
      } else {
        client.setAuth(adminKey)
      }
    }
    return client
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Convex] Failed to instantiate ConvexHttpClient:", err)
    }
    return null
  }
}

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
function mapConvexRequest(doc: any): RequestItem {
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
    seasons: doc.seasonsJson ? JSON.parse(doc.seasonsJson) : undefined,
    denialReason: doc.denialReason,
    approvedAt: doc.approvedAt,
    approvedBy: doc.approvedBy,
    deniedAt: doc.deniedAt,
    deniedBy: doc.deniedBy,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapConvexNotification(doc: any): UserNotification {
  return {
    id: doc.notifId,
    userId: doc.userId,
    requestId: doc.requestId,
    title: doc.title,
    message: doc.message,
    type: doc.type as "approved" | "denied",
    read: doc.read,
    createdAt: doc.createdAt,
  }
}

export async function getAllRequests(): Promise<RequestItem[]> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const docs = await convex.query(getAllRequestsRef, {})
      return docs.map(mapConvexRequest).sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Convex] getAllRequests query failed, falling back to local store:", err)
      }
    }
  }

  const store = ensureFileExists()
  return store.requests.sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
}

export async function getUserRequests(userId: string): Promise<RequestItem[]> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const docs = await convex.query(getUserRequestsRef, { userId })
      return docs.map(mapConvexRequest).sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())
    } catch (err) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[Convex] getUserRequests query failed, falling back to local store:", err)
      }
    }
  }

  const requests = await getAllRequests()
  return requests.filter((r) => r.requestedBy.userId === userId)
}

export async function getRequestById(id: string): Promise<RequestItem | null> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const doc = await convex.query(getRequestByIdRef, { requestId: id })
      return doc ? mapConvexRequest(doc) : null
    } catch {
      /* fallback */
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
  posterPath?: string
  backdropPath?: string
  qualityProfileId: number
  rootFolderPath: string
  minimumAvailability?: string
  seriesType?: string
  tags?: number[]
  seasons?: { seasonNumber: number; monitored: boolean }[]
  requestedBy: { userId: string; username: string }
  autoApprove?: boolean
}): Promise<RequestItem> {
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

  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(createRequestRef, {
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
        seasonsJson: payload.seasons ? JSON.stringify(payload.seasons) : undefined,
      })
      return newRequest
    } catch (err) {
      console.error("[Convex] createRequest mutation failed:", err)
      throw new Error("Failed to save request to database")
    }
  } else {
    const store = ensureFileExists()
    store.requests.push(newRequest)
    saveStore(store)
  }

  eventBus.emitEvent({ type: "request:created", payload: newRequest })
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

  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(updateRequestStatusRef, {
        requestId: id,
        status: "approved",
        approvedBy: adminUsername,
        approvedAt,
      })

      await convex.mutation(addNotificationRef, {
        notifId,
        userId: req.requestedBy.userId,
        requestId: req.id,
        title: notifPayload.title,
        message: notifPayload.message,
        type: "approved",
      })
      return req
    } catch (err) {
      console.error("[Convex] approveRequest mutation failed:", err)
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
  }

  eventBus.emitEvent({ type: "request:updated", payload: req })
  eventBus.emitEvent({ type: "notification:created", payload: notifPayload })

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

  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(updateRequestStatusRef, {
        requestId: id,
        status: "denied",
        deniedBy: adminUsername,
        deniedAt,
        denialReason,
      })

      await convex.mutation(addNotificationRef, {
        notifId,
        userId: req.requestedBy.userId,
        requestId: req.id,
        title: `Request Denied: ${req.title}`,
        message,
        type: "denied",
      })
      return req
    } catch (err) {
      console.error("[Convex] denyRequest mutation failed:", err)
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
  }

  eventBus.emitEvent({ type: "request:updated", payload: req })
  eventBus.emitEvent({ type: "notification:created", payload: notifPayload })

  return req
}


export async function getUserNotifications(userId: string): Promise<UserNotification[]> {
  const convex = getConvexClient()
  if (convex) {
    try {
      const docs = await convex.query(getUserNotificationsRef, { userId })
      return docs.map(mapConvexNotification).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } catch {
      /* fallback */
    }
  }

  const store = ensureFileExists()
  return store.notifications
    .filter((n) => n.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

export async function markNotificationRead(notificationId: string, userId: string): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(markNotificationReadRef, { notifId: notificationId, userId })
      return
    } catch {
      /* fallback */
    }
  }

  const store = ensureFileExists()
  const notif = store.notifications.find((n) => n.id === notificationId && n.userId === userId)
  if (notif) {
    notif.read = true
    saveStore(store)
  }
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  const convex = getConvexClient()
  if (convex) {
    try {
      await convex.mutation(markAllNotificationsReadRef, { userId })
      return
    } catch {
      /* fallback */
    }
  }

  const store = ensureFileExists()
  let changed = false
  for (const n of store.notifications) {
    if (n.userId === userId && !n.read) {
      n.read = true
      changed = true
    }
  }
  if (changed) {
    saveStore(store)
  }
}
