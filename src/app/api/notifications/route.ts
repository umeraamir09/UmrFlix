import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/requests-store"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const notifications = await getUserNotifications(session.userId)
    const unreadCount = notifications.filter((n) => !n.read).length
    return NextResponse.json({ notifications, unreadCount })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch notifications"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { notificationId, markAll } = body

    if (markAll) {
      await markAllNotificationsRead(session.userId)
    } else if (notificationId) {
      await markNotificationRead(notificationId, session.userId)
    }

    const notifications = await getUserNotifications(session.userId)
    const unreadCount = notifications.filter((n) => !n.read).length
    return NextResponse.json({ success: true, notifications, unreadCount })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to update notification"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
