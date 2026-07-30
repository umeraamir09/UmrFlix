import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/ping -> Keep presence alive
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const room = roomManager.getRoom(id)
  if (!room) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 })
  }

  const member = room.members.get(session.userId)
  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403 })
  }

  const now = Date.now()
  member.lastSeenAt = now
  room.lastSeenAt.set(session.userId, now)

  return NextResponse.json({ success: true })
}
