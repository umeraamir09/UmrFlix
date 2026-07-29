import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { setSessionCookie, type UserSession } from "@/lib/auth"

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const username = body.username?.trim()
    const password = body.password ?? ""
    const customServerUrl = body.serverUrl?.trim()

    const serverUrl = (customServerUrl || env("JELLYFIN_URL") || "http://localhost:8096").replace(/\/+$/, "")

    if (!username) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 })
    }

    const res = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Emby-Authorization":
          'MediaBrowser Client="UmrFlix", Device="UmrFlix Web Client", DeviceId="umrflix-web-client-001", Version="1.0.0"',
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error(`Jellyfin auth failed (${res.status}):`, errText)
      return NextResponse.json(
        { error: res.status === 401 ? "Invalid username or password." : "Failed to authenticate with Jellyfin server." },
        { status: res.status }
      )
    }

    const data = await res.json()
    const user = data.User
    const policy = user?.Policy ?? {}

    const session: UserSession = {
      userId: user.Id,
      username: user.Name,
      accessToken: data.AccessToken,
      isAdmin: Boolean(policy.IsAdministrator),
      enableDownloading: policy.EnableContentDownloading !== false,
      maxParentalRating: policy.MaxParentalRating ? String(policy.MaxParentalRating) : null,
      serverUrl,
      avatarUrl: user.PrimaryImageTag
        ? `${serverUrl}/Users/${user.Id}/Images/Primary?tag=${user.PrimaryImageTag}`
        : undefined,
      dailyRequestsCount: 0,
      lastRequestResetDate: new Date().toISOString().split("T")[0],
    }

    await setSessionCookie(session)

    return NextResponse.json({
      success: true,
      user: {
        userId: session.userId,
        username: session.username,
        isAdmin: session.isAdmin,
        avatarUrl: session.avatarUrl,
        serverUrl: session.serverUrl,
      },
    })
  } catch (error) {
    console.error("Login route error:", error)
    return NextResponse.json({ error: "An unexpected error occurred during login." }, { status: 500 })
  }
}
