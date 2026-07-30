import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import type { PartyCommand } from "@/lib/party/protocol"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/command -> Apply playback command
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
    const cmd: PartyCommand = await req.json()
    if (!cmd || !cmd.type || !cmd.clientId || !cmd.commandId) {
      return NextResponse.json({ error: "Invalid command structure" }, { status: 400 })
    }

    const state = roomManager.applyCommand(id, session.userId, cmd)
    if (!state) {
      return NextResponse.json(
        { error: "Party room not found or member not in party" },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, state })
  } catch (err) {
    console.error("[Party API] Error applying command:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
