import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/join -> Join a party room
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const snapshot = roomManager.joinRoom(
      id,
      session.userId,
      session.username || "Anonymous"
    )

    if (!snapshot) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    return NextResponse.json({ success: true, snapshot })
  } catch (err) {
    console.error("[Party API] Error joining room:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
