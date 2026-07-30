import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/status -> Report buffering state
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  try {
    const body = await req.json()
    const { buffering, positionSec } = body

    if (typeof buffering !== "boolean") {
      return NextResponse.json({ error: "buffering boolean is required" }, { status: 400 })
    }

    const state = roomManager.setBuffering(id, session.userId, buffering, positionSec)

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error updating status:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
