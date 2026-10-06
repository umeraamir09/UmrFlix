import { NextResponse } from "next/server"
import { getSession, setSessionCookie } from "@/lib/auth"
import { getAvailableAvatars, getUserAvatar, setUserAvatar } from "@/lib/avatar-store"

export async function GET() {
  const session = await getSession()
  const avatars = await getAvailableAvatars()

  if (!session) {
    return NextResponse.json({ authenticated: false, avatarUrl: null, avatars })
  }

  let avatarUrl = session.avatarUrl ?? null
  try {
    const customAvatar = await getUserAvatar(session.userId)
    if (customAvatar) {
      avatarUrl = customAvatar
    }
  } catch (err) {
    console.error("Failed to read user avatar:", err)
  }

  return NextResponse.json({
    authenticated: true,
    avatarUrl,
    avatars,
  })
}

export async function POST(req: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const { avatarUrl } = body

    if (!avatarUrl || typeof avatarUrl !== "string") {
      return NextResponse.json({ error: "Invalid avatarUrl provided." }, { status: 400 })
    }

    // Only allow known local avatars to keep the value out of attacker control
    const avatars = await getAvailableAvatars()
    if (!avatars.includes(avatarUrl)) {
      return NextResponse.json({ error: "Invalid avatarUrl provided." }, { status: 400 })
    }

    // Save user avatar in Postgres (with fallback local store)
    await setUserAvatar(session.userId, avatarUrl)

    // Update encrypted session cookie
    session.avatarUrl = avatarUrl
    await setSessionCookie(session)

    return NextResponse.json({
      success: true,
      avatarUrl,
    })
  } catch (err) {
    console.error("Error saving user avatar:", err)
    return NextResponse.json({ error: "Failed to save avatar." }, { status: 500 })
  }
}
