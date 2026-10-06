import fs from "fs/promises"
import path from "path"
import { getPostgresStore } from "@/lib/db/store"
import type { StoreOperation } from "@/lib/db/store"

type QueryRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = StoreOperation<Args, Ret>

const getUserAvatarRef = "userProfiles:getUserAvatar" as unknown as QueryRef<{ userId: string }, string | null>
const setUserAvatarRef = "userProfiles:setUserAvatar" as unknown as MutationRef<{ userId: string; avatarUrl: string }, string>

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "avatars.json")

async function ensureFileExists(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true })
    try {
      await fs.access(FILE_PATH)
    } catch {
      await fs.writeFile(FILE_PATH, JSON.stringify({}), "utf-8")
    }
  } catch (err) {
    console.error("Failed to initialize avatars storage directory:", err)
  }
}

async function readStorage(): Promise<Record<string, string>> {
  await ensureFileExists()
  try {
    const raw = await fs.readFile(FILE_PATH, "utf-8")
    return JSON.parse(raw) as Record<string, string>
  } catch (err) {
    console.error("Error reading avatars storage file:", err)
    return {}
  }
}

async function writeStorage(data: Record<string, string>): Promise<void> {
  await ensureFileExists()
  const tmpPath = `${FILE_PATH}.tmp.${Date.now()}`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8")
  await fs.rename(tmpPath, FILE_PATH)
}

export async function getUserAvatar(userId: string, userToken?: string): Promise<string | null> {
  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) return postgres.read(getUserAvatarRef, { userId })

  const db = await readStorage()
  return db[userId] || null
}

export async function setUserAvatar(
  userId: string,
  avatarUrl: string,
  userToken?: string
): Promise<void> {
  void userToken // Authentication is enforced by the calling server route.
  const postgres = getPostgresStore()
  if (postgres) {
    await postgres.write(setUserAvatarRef, { userId, avatarUrl })
    return
  }

  const db = await readStorage()
  db[userId] = avatarUrl
  await writeStorage(db)
}

export async function getAvailableAvatars(): Promise<string[]> {
  try {
    const avatarsDir = path.join(process.cwd(), "public", "avatars")
    const files = await fs.readdir(avatarsDir)
    const filtered = files
      .filter((file) => /\.(png|jpe?g|svg|webp)$/i.test(file))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ""), 10) || 0
        const numB = parseInt(b.replace(/\D/g, ""), 10) || 0
        return numA - numB
      })
    return filtered.map((file) => `/avatars/${file}`)
  } catch (err) {
    console.error("Error listing available avatars:", err)
    return []
  }
}
