import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/end -> End party room (owner-only)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`end:${session.userId}`, PARTY_RATE_LIMITS.END_ROOM)) {
    return apiError("End room rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  const room = roomManager.getRoom(id)
  if (!room) {
    return apiError("Room not found", 404, "ROOM_NOT_FOUND")
  }
  if (room.ownerId !== session.userId) {
    return apiError("Only the room owner can end the party room", 403, "FORBIDDEN")
  }

  try {
    const success = roomManager.endRoom(id, session.userId)
    if (!success) {
      return apiError("Forbidden or room not found", 403, "FORBIDDEN_OR_ROOM_NOT_FOUND")
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[Party API] Error ending room:", err)
    return apiError("Failed to end room", 500, "END_ROOM_FAILED", String(err))
  }
}
