import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/join -> Join a party room
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`join:${session.userId}`, PARTY_RATE_LIMITS.JOIN_ROOM)) {
    return apiError("Join rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  try {
    const snapshot = roomManager.joinRoom(
      id,
      session.userId,
      session.username || "Anonymous"
    )

    if (!snapshot) {
      return apiError("Room not found or room maximum capacity reached", 404, "ROOM_NOT_FOUND_OR_FULL")
    }

    return NextResponse.json({ success: true, snapshot })
  } catch (err) {
    console.error("[Party API] Error joining room:", err)
    return apiError("Failed to join party room", 500, "JOIN_ROOM_FAILED", String(err))
  }
}
