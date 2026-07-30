import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { addPartyInviteNotification, type UserNotification } from "@/lib/requests-store"
import { apiError } from "@/lib/api-response"

export const dynamic = "force-dynamic"

// POST /api/party/[id]/invite -> Invite userIds to room
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED")
  }

  const { id } = await params
  try {
    const body = await req.json()
    const { userIds } = body
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return apiError("userIds array required", 400, "INVALID_INVITE_PAYLOAD")
    }

    const inviterName = session.username || "A user"
    const success = roomManager.inviteUsers(id, session.userId, inviterName, userIds)

    if (!success) {
      return apiError("Room not found or invite capacity reached", 404, "ROOM_NOT_FOUND_OR_FULL")
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
    return apiError("Failed to send party invitations", 500, "INVITE_FAILED", String(err))
  }
}
