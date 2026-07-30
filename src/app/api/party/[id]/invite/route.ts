import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/invite -> Invite userIds to room
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = await req.json()
    const { userIds } = body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds array required" }, { status: 400 })
    }

    const success = roomManager.inviteUsers(
      id,
      session.userId,
      session.username || "A user",
      userIds
    )

    if (!success) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, invitedCount: userIds.length })
  } catch (err) {
    console.error("[Party API] Error inviting users:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
