import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/leave -> Leave a party room
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
    const result = roomManager.leaveRoom(id, session.userId)
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error("[Party API] Error leaving room:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
