import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import { getActiveSessions, stopSession } from "@/lib/jellyfin"

export async function GET() {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const sessions = await getActiveSessions()
    return NextResponse.json({ sessions })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch active Jellyfin sessions"
    return NextResponse.json({ error: message, sessions: [] }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const body = await request.json()
    const { sessionId } = body

    if (!sessionId) {
      return NextResponse.json({ error: "Missing sessionId" }, { status: 400 })
    }

    const success = await stopSession(sessionId)
    return NextResponse.json({ success })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to terminate Jellyfin session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
