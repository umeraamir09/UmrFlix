import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"

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

  const { id } = await params
  try {
    const result = roomManager.leaveRoom(id, session.userId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error("[Party API] Error leaving room:", err)
    return apiError("Failed to leave party room", 500, "LEAVE_ROOM_FAILED", String(err))
  }
}
