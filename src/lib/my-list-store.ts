import fs from "fs/promises"
import path from "path"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"
import { toggleFavoriteItem } from "@/lib/jellyfin"

export type MyListItem = {
  id: string // deterministic composite key e.g. "tmdb:movie:550", "tmdb:tv:1399", "jellyfin:abc123"
  userId: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType: "movie" | "tv"
  title: string
  posterPath?: string | null
  overview?: string
  releaseYear?: string
  addedAt: string
}

type StorageSchema = Record<string, MyListItem[]>

type ConvexRecord = {
  _id: string
  itemId: string
  userId: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType?: "movie" | "tv"
  title: string
  posterPath?: string | null
  overview?: string
  releaseYear?: string
  addedAt?: string
}

type ConvexAddItemArgs = {
  userId: string
  itemId: string
  tmdbId?: number
  tvdbId?: number
  jellyfinId?: string
  mediaType: string
  title: string
  posterPath?: string | null
  overview?: string
  releaseYear?: string
}

type QueryRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"query", "public", Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"mutation", "public", Args, Ret>

const getUserListRef = "myList:getUserList" as unknown as QueryRef<{ userId: string }, ConvexRecord[]>
const isInListRef = "myList:isInList" as unknown as QueryRef<{ userId: string; itemId: string }, boolean>
const addItemRef = "myList:addItem" as unknown as MutationRef<ConvexAddItemArgs, string>
const removeItemRef = "myList:removeItem" as unknown as MutationRef<{ userId: string; itemId: string }, boolean>

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "my-list.json")

function getConvexClient(userToken?: string): ConvexHttpClient | null {
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

    // Prefer scoped user token (Issue #4); use adminKey only as fallback if configured
    if (userToken) {
      client.setAuth(userToken)
    } else if (adminKey) {
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
    console.error("[Convex] Failed to instantiate ConvexHttpClient:", err)
    return null
  }
}

async function ensureFileExists(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    try {
      await fs.access(FILE_PATH)
    } catch {
      await fs.writeFile(FILE_PATH, JSON.stringify({}), "utf-8")
    }
  } catch (err) {
    console.error("Failed to initialize my-list storage directory:", err)
  }
}

async function readStorage(): Promise<StorageSchema> {
  await ensureFileExists()
  try {
    const raw = await fs.readFile(FILE_PATH, "utf-8")
    return JSON.parse(raw) as StorageSchema
  } catch (err) {
    console.error("Error reading my-list storage file:", err)
    return {}
  }
}

async function writeStorage(data: StorageSchema): Promise<void> {
  await ensureFileExists()
  const tmpPath = `${FILE_PATH}.tmp.${Date.now()}`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  await fs.rename(tmpPath, FILE_PATH)
}

// Unambiguous, deterministic key strategy (Issue #16)
export function getItemKey(target: {
  id?: string
  tmdbId?: number
  jellyfinId?: string
  mediaType?: "movie" | "tv"
}): string {
  const mediaType = target.mediaType || "movie"

  if (target.tmdbId) {
    return `tmdb:${mediaType}:${target.tmdbId}`
  }
  if (target.jellyfinId) {
    return `jellyfin:${target.jellyfinId}`
  }
  if (target.id) {
    if (target.id.startsWith("tmdb:") || target.id.startsWith("jellyfin:")) {
      return target.id
    }
    if (target.id.startsWith("tmdb-")) {
      return target.id.replace(/^tmdb-/, "tmdb:")
    }
    if (target.id.startsWith("jellyfin-")) {
      return target.id.replace(/^jellyfin-/, "jellyfin:")
    }
    if (/^\d+$/.test(target.id)) {
      return `tmdb:${mediaType}:${target.id}`
    }
    return target.id
  }
  return ""
}

export async function getUserMyList(userId: string, userToken?: string): Promise<MyListItem[]> {
  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      const records = await convex.query(getUserListRef, { userId })
      if (Array.isArray(records)) {
        return records.map((r) => ({
          id: r.itemId || r._id,
          userId: r.userId,
          tmdbId: r.tmdbId,
          tvdbId: r.tvdbId,
          jellyfinId: r.jellyfinId,
          mediaType: r.mediaType || "movie",
          title: r.title,
          posterPath: r.posterPath,
          overview: r.overview,
          releaseYear: r.releaseYear,
          addedAt: r.addedAt || new Date().toISOString(),
        }))
      }
    } catch (err) {
      console.error("[Convex Query Error] Failed to query user list:", err)
    }
  }

  const db = await readStorage()
  return db[userId] || []
}

export async function addToMyList(
  userId: string,
  item: Omit<MyListItem, "id" | "userId" | "addedAt"> & { id?: string },
  userToken?: string
): Promise<MyListItem> {
  const key = getItemKey(item)
  const now = new Date().toISOString()

  const newItem: MyListItem = {
    id: key || `item-${Date.now()}`,
    userId,
    tmdbId: item.tmdbId,
    tvdbId: item.tvdbId,
    jellyfinId: item.jellyfinId,
    mediaType: item.mediaType || "movie",
    title: item.title,
    posterPath: item.posterPath,
    overview: item.overview,
    releaseYear: item.releaseYear,
    addedAt: now,
  }

  // Centralized Hybrid Jellyfin Sync (Issue #13)
  if (item.jellyfinId) {
    toggleFavoriteItem(item.jellyfinId, true).catch((err) =>
      console.warn("Failed to sync favorite to Jellyfin server:", err)
    )
  }

  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      await convex.mutation(addItemRef, {
        userId,
        itemId: newItem.id,
        tmdbId: newItem.tmdbId,
        tvdbId: newItem.tvdbId,
        jellyfinId: newItem.jellyfinId,
        mediaType: newItem.mediaType,
        title: newItem.title,
        posterPath: newItem.posterPath,
        overview: newItem.overview,
        releaseYear: newItem.releaseYear,
      })
      return newItem
    } catch (err) {
      console.error("[Convex Mutation Error] Failed to add item:", err)
    }
  }

  const db = await readStorage()
  const list = db[userId] || []

  const existingIndex = list.findIndex((i) => getItemKey(i) === key)

  if (existingIndex >= 0) {
    list[existingIndex] = {
      ...list[existingIndex],
      ...newItem,
      addedAt: list[existingIndex].addedAt,
    }
  } else {
    list.unshift(newItem)
  }

  db[userId] = list
  await writeStorage(db)
  return newItem
}

export async function removeFromMyList(
  userId: string,
  target: { id?: string; tmdbId?: number; jellyfinId?: string; mediaType?: "movie" | "tv" },
  userToken?: string
): Promise<boolean> {
  const key = getItemKey(target)

  // Centralized Hybrid Jellyfin Sync (Issue #13)
  if (target.jellyfinId) {
    toggleFavoriteItem(target.jellyfinId, false).catch((err) =>
      console.warn("Failed to unsync favorite from Jellyfin server:", err)
    )
  }

  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      await convex.mutation(removeItemRef, {
        userId,
        itemId: key || target.jellyfinId || (target.tmdbId ? String(target.tmdbId) : ""),
      })
      return true
    } catch (err) {
      console.error("[Convex Mutation Error] Failed to remove item:", err)
    }
  }

  const db = await readStorage()
  const list = db[userId] || []

  const initialLength = list.length
  const filtered = list.filter((i) => getItemKey(i) !== key)

  if (filtered.length !== initialLength) {
    db[userId] = filtered
    await writeStorage(db)
    return true
  }

  return false
}

// O(1) Index-based item check (Issue #6)
export async function isItemInMyList(
  userId: string,
  target: { id?: string; tmdbId?: number; jellyfinId?: string; mediaType?: "movie" | "tv" },
  userToken?: string
): Promise<boolean> {
  const key = getItemKey(target)
  if (!key) return false

  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      const result = await convex.query(isInListRef, { userId, itemId: key })
      if (typeof result === "boolean") {
        return result
      }
    } catch (err) {
      console.error("[Convex Query Error] Failed to check item in list:", err)
    }
  }

  const db = await readStorage()
  const list = db[userId] || []
  return list.some((i) => getItemKey(i) === key)
}
