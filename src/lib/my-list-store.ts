import fs from "fs/promises"
import path from "path"
import { ConvexHttpClient } from "convex/browser"
import { toggleFavoriteItem } from "@/lib/jellyfin"

export type MyListItem = {
  id: string // deterministic composite key e.g. "tmdb-movie-550", "tmdb-tv-1399", "jellyfin-abc123"
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

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "my-list.json")

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
      ;(client as any).setAdminAuth(adminKey)
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

export function getItemKey(target: {
  id?: string
  tmdbId?: number
  jellyfinId?: string
  mediaType?: "movie" | "tv"
}): string {
  if (target.tmdbId) {
    const type = target.mediaType || "movie"
    return `tmdb-${type}-${target.tmdbId}`
  }
  if (target.jellyfinId) {
    return `jellyfin-${target.jellyfinId}`
  }
  if (target.id) {
    if (target.id.startsWith("tmdb-") || target.id.startsWith("jellyfin-")) {
      return target.id
    }
    if (/^\d+$/.test(target.id)) {
      const type = target.mediaType || "movie"
      return `tmdb-${type}-${target.id}`
    }
    return target.id
  }
  return ""
}

export async function getUserMyList(userId: string): Promise<MyListItem[]> {
  const convex = getConvexClient()
  if (convex) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const records = (await convex.query("myList:getUserList" as any, { userId })) as ConvexRecord[]
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
  item: Omit<MyListItem, "id" | "userId" | "addedAt"> & { id?: string }
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

  // Centralized Hybrid Jellyfin Sync (Issue 13)
  if (item.jellyfinId) {
    toggleFavoriteItem(item.jellyfinId, true).catch((err) =>
      console.warn("Failed to sync favorite to Jellyfin server:", err)
    )
  }

  const convex = getConvexClient()
  if (convex) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await convex.mutation("myList:addItem" as any, {
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

  const existingIndex = list.findIndex((i) => {
    if (key && i.id === key) return true
    if (item.tmdbId && i.tmdbId === item.tmdbId && i.mediaType === item.mediaType) return true
    if (item.jellyfinId && i.jellyfinId === item.jellyfinId) return true
    return false
  })

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
  target: { id?: string; tmdbId?: number; jellyfinId?: string; mediaType?: "movie" | "tv" }
): Promise<boolean> {
  const key = getItemKey(target)

  // Centralized Hybrid Jellyfin Sync (Issue 13)
  if (target.jellyfinId) {
    toggleFavoriteItem(target.jellyfinId, false).catch((err) =>
      console.warn("Failed to unsync favorite from Jellyfin server:", err)
    )
  }

  const convex = getConvexClient()
  if (convex) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await convex.mutation("myList:removeItem" as any, {
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
  const filtered = list.filter((i) => {
    if (key && i.id === key) return false
    if (target.tmdbId && i.tmdbId === Number(target.tmdbId) && (!target.mediaType || i.mediaType === target.mediaType)) return false
    if (target.jellyfinId && i.jellyfinId === target.jellyfinId) return false
    return true
  })

  if (filtered.length !== initialLength) {
    db[userId] = filtered
    await writeStorage(db)
    return true
  }

  return false
}

export async function isItemInMyList(
  userId: string,
  target: { id?: string; tmdbId?: number; jellyfinId?: string; mediaType?: "movie" | "tv" }
): Promise<boolean> {
  const list = await getUserMyList(userId)
  const key = getItemKey(target)

  return list.some((i) => {
    if (key && i.id === key) return true
    if (target.tmdbId && i.tmdbId === Number(target.tmdbId) && (!target.mediaType || i.mediaType === target.mediaType)) return true
    if (target.jellyfinId && i.jellyfinId === target.jellyfinId) return true
    return false
  })
}
