import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getDownloadTracker } from "@/lib/download-tracker"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const tracker = getDownloadTracker()
    const items = tracker.getSnapshotForUser(session.userId)
    return NextResponse.json({ items, fetchedAt: Date.now() })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch download progress"
    return NextResponse.json({ error: message, items: [] }, { status: 500 })
  }
}
