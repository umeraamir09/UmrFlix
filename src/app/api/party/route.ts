import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

// POST /api/party -> Create a room
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  if (!checkRateLimit(`create_room:${session.userId}`, PARTY_RATE_LIMITS.CREATE_ROOM)) {
    return apiError("Rate limit exceeded for creating party rooms", 429, "RATE_LIMITED")
  }

  try {
    const body = await req.json().catch(() => ({}))
    const itemId = body.itemId ?? null

    const snapshot = roomManager.createRoom(
      session.userId,
      session.username || "Anonymous",
      undefined,
      itemId
    )

    if (!snapshot) {
      return apiError(
        "Could not create room: Server or user capacity limit reached",
        400,
        "CAPACITY_EXCEEDED"
      )
    }

    return NextResponse.json({ partyId: snapshot.partyId, snapshot })
  } catch (err) {
    console.error("[Party API] Error creating party room:", err)
    return apiError("Failed to create watch party room", 500, "CREATE_ROOM_FAILED", String(err))
  }
}

// GET /api/party -> My active parties & invites
export async function GET() {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  try {
    const parties = roomManager.getUserParties(session.userId)
    return NextResponse.json(parties)
  } catch (err) {
    console.error("[Party API] Error getting user parties:", err)
    return apiError("Failed to retrieve user party rooms", 500, "GET_USER_PARTIES_FAILED", String(err))
  }
}
