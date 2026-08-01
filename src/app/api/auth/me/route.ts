import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserAvatar } from "@/lib/avatar-store"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null })
  }

  let avatarUrl = session.avatarUrl
  try {
    const customAvatar = await getUserAvatar(session.userId)
    if (customAvatar) {
      avatarUrl = customAvatar
    }
  } catch (err) {
    console.error("Failed to load user custom avatar:", err)
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

