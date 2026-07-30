import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"

export const dynamic = "force-dynamic"

// GET /api/party/[id] -> Snapshot + serverNow
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const snapshot = roomManager.getSnapshot(id, session.userId)
  if (!snapshot) {
    return NextResponse.json({ error: "Party room not found" }, { status: 404 })
  }

  return NextResponse.json(snapshot)
}
