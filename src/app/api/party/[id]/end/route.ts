import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"

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

  const { id } = await params
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
