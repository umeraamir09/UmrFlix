import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { setSessionCookie, type UserSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { logAuditEvent, getClientIp } from "@/lib/audit"

function isServerUrlAllowed(targetUrl: string): boolean {
  const defaultUrl = env("JELLYFIN_URL") || "http://localhost:8096"
  try {
    const targetOrigin = new URL(targetUrl).origin
    const defaultOrigin = new URL(defaultUrl).origin
    if (targetOrigin === defaultOrigin) return true

    const allowlist = (process.env.JELLYFIN_SERVER_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (allowlist.includes(targetOrigin)) return true

    return false
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const clientIp = getClientIp(req)
  const auditIp = clientIp ?? "unknown"

  if (!checkRateLimit(`login:${auditIp}`, { windowMs: 60_000, maxRequests: 5 })) {
    logAuditEvent("login_failed", { ip: auditIp, reason: "rate_limited" })
    return NextResponse.json(
      { error: "Too many login attempts. Please wait 1 minute before trying again." },
      { status: 429 }
    )
  }

  try {
    const body = await req.json().catch(() => ({}))
    const username = body.username?.trim()
    const password = body.password ?? ""
    const customServerUrl = body.serverUrl?.trim()

    const serverUrl = (customServerUrl || env("JELLYFIN_URL") || "http://localhost:8096").replace(/\/+$/, "")

    if (!username) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 })
    }

    if (!isServerUrlAllowed(serverUrl)) {
      logAuditEvent("login_failed", { ip: auditIp, username, reason: "unauthorized_server_url" })
      return NextResponse.json(
        { error: "Connecting to unapproved Jellyfin server URL is restricted." },
        { status: 400 }
      )
    }

    const rawDeviceId = req.headers.get("x-umrflix-deviceid")?.trim()
    const deviceId = (rawDeviceId && /^[A-Za-z0-9_-]{1,64}$/.test(rawDeviceId))
      ? rawDeviceId
      : `umrflix-${crypto.randomUUID()}`

    const res = await fetch(`${serverUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization":
          `MediaBrowser Client="UmrFlix", Device="UmrFlix Web Client", DeviceId="${deviceId}", Version="1.0.0"`,
        "X-Emby-Authorization":
          `MediaBrowser Client="UmrFlix", Device="UmrFlix Web Client", DeviceId="${deviceId}", Version="1.0.0"`,
      },
      body: JSON.stringify({
        Username: username,
        Pw: password,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      console.error(`Jellyfin auth failed (${res.status}):`, errText)
      logAuditEvent("login_failed", { ip: auditIp, username, reason: `jellyfin_${res.status}` })
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
    logAuditEvent("login_ok", { ip: auditIp, userId: session.userId, username: session.username })

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
