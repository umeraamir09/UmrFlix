import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ authenticated: false, user: null })
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
      avatarUrl: session.avatarUrl,
      dailyRequestsCount: session.dailyRequestsCount ?? 0,
      lastRequestResetDate: session.lastRequestResetDate,
    },
  })
}
