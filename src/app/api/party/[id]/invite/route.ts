import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { roomManager } from "@/lib/party/room-manager"
import { addPartyInviteNotification, type UserNotification } from "@/lib/requests-store"
import { apiError } from "@/lib/api-response"
import { checkRateLimit, PARTY_RATE_LIMITS } from "@/lib/rate-limit"
import { isValidItemId } from "@/lib/validation"

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

  if (!checkRateLimit(`invite:${session.userId}`, PARTY_RATE_LIMITS.INVITE)) {
    return apiError("Invite rate limit exceeded", 429, "RATE_LIMITED")
  }

  const { id } = await params
  const room = roomManager.getRoom(id)
  if (!room) {
    return apiError("Room not found", 404, "ROOM_NOT_FOUND")
  }
  if (!room.members.has(session.userId)) {
    return apiError("Not a member of this room", 403, "NOT_ROOM_MEMBER")
  }

  try {
    const body = await req.json()
    const { userIds } = body
    if (!Array.isArray(userIds) || userIds.length === 0 || !userIds.every((uid) => isValidItemId(uid))) {
      return apiError("Valid userIds array required", 400, "INVALID_INVITE_PAYLOAD")
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
