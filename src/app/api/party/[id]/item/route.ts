import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/item -> Change active media item (owner-only)
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
    const { itemId } = body
    if (!itemId || typeof itemId !== "string") {
      return NextResponse.json({ error: "itemId is required" }, { status: 400 })
    }

    const state = roomManager.applyItem(id, session.userId, itemId)
    if (!state) {
      return NextResponse.json(
        { error: "Forbidden or room not found" },
        { status: 403 }
      )
    }

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error setting item:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
