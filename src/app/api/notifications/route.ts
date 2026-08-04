import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/requests-store"
import { getDownloadTracker } from "@/lib/download-tracker"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    getDownloadTracker()
    const notifications = await getUserNotifications(session.userId)
    const unreadCount = notifications.filter((n) => !n.read).length
    return NextResponse.json({ notifications, unreadCount })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch notifications"
    console.error(`[Notif][API GET] ERROR:`, e)
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

    if (!markAll && !notificationId) {
      return NextResponse.json(
        { error: "Provide either a notificationId or markAll: true" },
        { status: 400 }
      )
    }

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
    console.error(`[Notif][API PATCH] ERROR:`, e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
