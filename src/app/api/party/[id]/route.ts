import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"

export const dynamic = "force-dynamic"

// GET /api/party/[id] -> Snapshot + serverNow
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  const { id } = await params
  roomManager.touchPresence(id, session.userId)
  const snapshot = roomManager.getSnapshot(id, session.userId)
  if (!snapshot) {
    return apiError("Party room not found", 404, "ROOM_NOT_FOUND")
  }

  return NextResponse.json(snapshot)
}
