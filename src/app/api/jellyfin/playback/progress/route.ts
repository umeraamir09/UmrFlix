import { NextResponse } from "next/server"
import { reportPlaybackState, type PlaybackReport } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

/**
 * Client heartbeat relay → Jellyfin /Sessions/Playing[...]
 * Body: PlaybackReport
 */
export async function POST(request: Request) {
  let body: PlaybackReport
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  if (!body.itemId || typeof body.positionTicks !== "number" || !body.event) {
    return NextResponse.json(
      { error: "itemId, positionTicks and event are required" },
      { status: 400 },
    )
  }
  if (!["start", "progress", "stopped"].includes(body.event)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }

  await reportPlaybackState(body)
  return NextResponse.json({ ok: true })
}
