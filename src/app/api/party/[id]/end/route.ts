import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/end -> End party room (owner-only)
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
    const success = roomManager.endRoom(id, session.userId)
    if (!success) {
      return NextResponse.json(
        { error: "Forbidden or room not found" },
        { status: 403 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[Party API] Error ending room:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
