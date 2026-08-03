import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { sanitizePartyCommand } from "@/lib/party/protocol"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/command -> Apply playback command
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`cmd:${session.userId}`, PARTY_RATE_LIMITS.COMMAND)) {
    return apiError("Command rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  try {
    const cmd = sanitizePartyCommand(await req.json())
    if (!cmd) {
      return apiError("Invalid command payload", 400, "INVALID_COMMAND")
    }

    const state = roomManager.applyCommand(id, session.userId, cmd)
    if (!state) {
      return apiError("Party room not found or user is not a member", 404, "ROOM_OR_MEMBER_NOT_FOUND")
    }

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error applying command:", err)
    return apiError("Failed to apply party command", 500, "COMMAND_FAILED", String(err))
  }
}
