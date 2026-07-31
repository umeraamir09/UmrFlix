import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/item -> Change active media item (owner-only)
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  const { id } = await params
  try {
    const body = await req.json()
    const { itemId } = body
    if (!itemId || typeof itemId !== "string") {
      return apiError("itemId string is required", 400, "INVALID_ITEM_PAYLOAD")
    }

    const state = roomManager.applyItem(id, session.userId, itemId)
    if (!state) {
      return apiError("Forbidden or room not found", 403, "FORBIDDEN_OR_ROOM_NOT_FOUND")
    }

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error setting item:", err)
    return apiError("Failed to update active party item", 500, "CHANGE_ITEM_FAILED", String(err))
  }
}
