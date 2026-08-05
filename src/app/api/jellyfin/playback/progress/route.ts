import { NextResponse } from "next/server"
import { reportPlaybackState, type PlaybackReport } from "@/lib/jellyfin"
import { getSession } from "@/lib/auth"
import { ingestPlaybackStopped } from "@/lib/discovery/ingest"

export const dynamic = "force-dynamic"

/**
 * Client heartbeat relay → Jellyfin /Sessions/Playing[...]
 * Body: PlaybackReport
 *
 * "stopped" reports additionally feed the discovery engine's implicit-signal
 * log (completion %, abandonment, re-watch detection) — fire-and-forget so
 * ingestion latency never affects playback teardown.
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

  if (body.event === "stopped") {
    const session = await getSession()
    const userId = session?.userId ?? "default-user"
    void ingestPlaybackStopped({
      userId,
      jellyfinItemId: body.itemId,
      positionTicks: body.positionTicks,
      context: body.context,
    }).catch(() => {
      /* ingestion must never break playback reporting */
    })
  }

  return NextResponse.json({ ok: true })
}
