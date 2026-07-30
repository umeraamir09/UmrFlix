import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { eventBus } from "@/lib/event-bus"
import { addPartyInviteNotification, type UserNotification } from "@/lib/requests-store"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/invite -> Invite userIds to room
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
    const { userIds } = body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: "userIds array required" }, { status: 400 })
    }

    const inviterName = session.username || "A user"
    const success = roomManager.inviteUsers(id, session.userId, inviterName, userIds)

    if (!success) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    // Create notifications for each invited user
    const now = new Date().toISOString()
    for (const targetUserId of userIds) {
      const notif: UserNotification = {
        id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        userId: targetUserId,
        partyId: id,
        title: "Watch Party Invitation",
        message: `${inviterName} invited you to join a Watch Party!`,
        type: "party_invite",
        read: false,
        createdAt: now,
      }
      await addPartyInviteNotification(notif)
    }

    return NextResponse.json({ success: true, invitedCount: userIds.length })
  } catch (err) {
    console.error("[Party API] Error inviting users:", err)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
