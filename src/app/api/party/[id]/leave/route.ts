import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/leave -> Leave a party room
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`leave:${session.userId}`, PARTY_RATE_LIMITS.LEAVE_ROOM)) {
    return apiError("Leave rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  const room = roomManager.getRoom(id)
  if (!room) {
    return apiError("Room not found", 404, "ROOM_NOT_FOUND")
  }
  if (!room.members.has(session.userId)) {
    return apiError("Not a member of this room", 403, "NOT_ROOM_MEMBER")
  }

  try {
    const result = roomManager.leaveRoom(id, session.userId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error("[Party API] Error leaving room:", err)
    return apiError("Failed to leave party room", 500, "LEAVE_ROOM_FAILED", String(err))
  }
}
