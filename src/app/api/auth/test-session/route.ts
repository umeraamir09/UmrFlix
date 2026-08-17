import { NextResponse } from "next/server"
import { setSessionCookie } from "@/lib/auth"

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_TEST_AUTH !== "1") {
    return NextResponse.json({ error: "Test auth endpoint disabled in production" }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))

  const userSession = {
    userId: body.userId || "playwright-test-user",
    username: body.username || "PlaywrightTester",
    accessToken: body.accessToken || "playwright-test-token",
    isAdmin: body.isAdmin ?? true,
    enableDownloading: body.enableDownloading ?? true,
    maxParentalRating: null,
    serverUrl: body.serverUrl || process.env.JELLYFIN_URL || "http://localhost:8096",
    avatarUrl: body.avatarUrl || "/avatars/avatar-1.png",
  }

  await setSessionCookie(userSession)

  return NextResponse.json({ success: true, user: userSession })
}
