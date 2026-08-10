import fs from "fs/promises"
import path from "path"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"

type QueryRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"query", "public", Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"mutation", "public", Args, Ret>

const getUserAvatarRef = "userProfiles:getUserAvatar" as unknown as QueryRef<{ userId: string }, string | null>
const setUserAvatarRef = "userProfiles:setUserAvatar" as unknown as MutationRef<{ userId: string; avatarUrl: string }, string>

const DATA_DIR = path.join(process.cwd(), "data")
const FILE_PATH = path.join(DATA_DIR, "avatars.json")

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
  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      let timerId: NodeJS.Timeout | undefined
      const timeout = new Promise<null>((resolve) => {
        timerId = setTimeout(() => resolve(null), 1500)
      })
      const avatarUrl = await Promise.race([
        convex.query(getUserAvatarRef, { userId }),
        timeout,
      ])
      if (timerId) clearTimeout(timerId)
      if (avatarUrl) return avatarUrl
    } catch (err) {
      console.error("[Convex Query Error] Failed to query user avatar:", err)
    }
  }

  const db = await readStorage()
  return db[userId] || null
}

export async function setUserAvatar(
  userId: string,
  avatarUrl: string,
  userToken?: string
): Promise<void> {
  const convex = getConvexClient(userToken)
  if (convex) {
    try {
      await convex.mutation(setUserAvatarRef, { userId, avatarUrl })
    } catch (err) {
      console.error("[Convex Mutation Error] Failed to set user avatar:", err)
    }
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
