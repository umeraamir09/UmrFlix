import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { isValidPositionSec } from "@/lib/party/protocol"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/status -> Report buffering state
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`status:${session.userId}`, PARTY_RATE_LIMITS.STATUS)) {
    return apiError("Status update rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  try {
    const body = await req.json()
    const { buffering, positionSec } = body

    if (typeof buffering !== "boolean") {
      return apiError("buffering boolean is required", 400, "INVALID_STATUS_PAYLOAD")
    }
    if (positionSec !== undefined && !isValidPositionSec(positionSec)) {
      return apiError("positionSec must be a finite number within bounds", 400, "INVALID_STATUS_PAYLOAD")
    }

    const state = roomManager.setBuffering(id, session.userId, buffering, positionSec)

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error updating status:", err)
    return apiError("Failed to update status", 500, "STATUS_UPDATE_FAILED", String(err))
  }
}
