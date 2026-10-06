import fs from "fs/promises"
import path from "path"
import { getPostgresStore } from "@/lib/db/store"
import type { StoreOperation } from "@/lib/db/store"
import { setFavoriteItem } from "@/lib/jellyfin"

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

type PostgresRecord = {
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

type PostgresAddItemArgs = {
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

type QueryRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>

const getUserListRef = "myList:getUserList" as unknown as QueryRef<{ userId: string }, PostgresRecord[]>
const isInListRef = "myList:isInList" as unknown as QueryRef<{ userId: string; itemId: string }, boolean>
const addItemRef = "myList:addItem" as unknown as MutationRef<PostgresAddItemArgs, string>
const removeItemRef = "myList:removeItem" as unknown as MutationRef<{ userId: string; itemId: string }, boolean>

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "my-list.json")

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
  id?: string | number
  tmdbId?: number
  jellyfinId?: string
  mediaType?: "movie" | "tv"
}): string {
  if (!target) return ""
  const mediaType = target.mediaType || "movie"

  if (target.tmdbId) {
    return `tmdb:${mediaType}:${target.tmdbId}`
  }
  if (target.jellyfinId) {
    return `jellyfin:${target.jellyfinId}`
  }
  if (target.id !== undefined && target.id !== null) {
    const idStr = String(target.id)
    if (idStr.startsWith("tmdb:") || idStr.startsWith("jellyfin:")) {
      return idStr
    }
    if (idStr.startsWith("tmdb-")) {
      return idStr.replace(/^tmdb-/, "tmdb:")
    }
    if (idStr.startsWith("jellyfin-")) {
      return idStr.replace(/^jellyfin-/, "jellyfin:")
    }
    if (/^\d+$/.test(idStr)) {
      return `tmdb:${mediaType}:${idStr}`
    }
    return idStr
  }
  return ""
}

export async function getUserMyList(userId: string, userToken?: string): Promise<MyListItem[]> {
  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const records = await postgres.read(getUserListRef, { userId })
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
      console.error("[Postgres Query Error] Failed to query user list:", err)
      throw err
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
    setFavoriteItem(item.jellyfinId, true).catch((err) =>
      console.warn("Failed to sync favorite to Jellyfin server:", err)
    )
  }

  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      await postgres.write(addItemRef, {
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
      console.error("[Postgres Mutation Error] Failed to add item:", err)
      throw err
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
    setFavoriteItem(target.jellyfinId, false).catch((err) =>
      console.warn("Failed to unsync favorite from Jellyfin server:", err)
    )
  }

  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      return await postgres.write(removeItemRef, {
        userId,
        itemId: key || target.jellyfinId || (target.tmdbId ? String(target.tmdbId) : ""),
      })
    } catch (err) {
      console.error("[Postgres Mutation Error] Failed to remove item:", err)
      throw err
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

  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) {
    try {
      const result = await postgres.read(isInListRef, { userId, itemId: key })
      if (typeof result === "boolean") {
        return result
      }
    } catch (err) {
      console.error("[Postgres Query Error] Failed to check item in list:", err)
      throw err
    }
  }

  const db = await readStorage()
  const list = db[userId] || []
  return list.some((i) => getItemKey(i) === key)
}
