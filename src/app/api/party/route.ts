import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party -> Create a room
export async function POST(req: Request) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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

    return NextResponse.json({ partyId: snapshot.partyId, snapshot })
  } catch (err) {
    console.error("[Party API] Error creating party room:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}

// GET /api/party -> My active parties & invites
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const parties = roomManager.getUserParties(session.userId)
    return NextResponse.json(parties)
  } catch (err) {
    console.error("[Party API] Error getting user parties:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
