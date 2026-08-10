import { NextResponse } from "next/server"
import { getSession, clearSessionCookie } from "@/lib/auth"
import { getUserAvatar } from "@/lib/avatar-store"

export async function GET() {
  const session = await getSession()
  if (!session) {
    await clearSessionCookie()
    return NextResponse.json({ authenticated: false, user: null }, { status: 401 })
  }

  let avatarUrl = session.avatarUrl
  let timerId: NodeJS.Timeout | undefined
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      timerId = setTimeout(() => resolve(null), 2000)
    })
    const customAvatar = await Promise.race([
      getUserAvatar(session.userId),
      timeoutPromise,
    ])
    if (customAvatar) {
      avatarUrl = customAvatar
    }
  } catch (err) {
    console.error("Failed to load user custom avatar:", err)
  } finally {
    if (timerId) clearTimeout(timerId)
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      userId: session.userId,
      username: session.username,
      isAdmin: session.isAdmin,
      enableDownloading: session.enableDownloading,
      maxParentalRating: session.maxParentalRating,
      serverUrl: session.serverUrl,
      avatarUrl,
      dailyRequestsCount: session.dailyRequestsCount ?? 0,
      lastRequestResetDate: session.lastRequestResetDate,
    },
  })
}

