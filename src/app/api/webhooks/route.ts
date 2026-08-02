import { NextRequest, NextResponse } from "next/server"
import { eventBus } from "@/lib/event-bus"
import { invalidateAll } from "@/lib/cache"

export async function POST(req: NextRequest) {
  try {
    // Optional secret check if WEBHOOK_SECRET env var is defined
    const webhookSecret = process.env.WEBHOOK_SECRET
    if (webhookSecret) {
      const authHeader = req.headers.get("x-webhook-secret") || req.nextUrl.searchParams.get("secret")
      if (authHeader !== webhookSecret) {
        return NextResponse.json({ error: "Unauthorized webhook request" }, { status: 401 })
      }
    }

    const payload = await req.json()
    const eventType = payload.eventType || payload.event_type || "unknown"

    // Radarr / Sonarr Event Types: Grab, Download, Rename, MovieFileDelete, SeriesAdd, Test, etc.
    let mappedType: "media:grabbed" | "media:downloaded" | "media:renamed" | null = null

    if (/grab/i.test(eventType)) {
      mappedType = "media:grabbed"
    } else if (/download/i.test(eventType)) {
      mappedType = "media:downloaded"
    } else if (/rename/i.test(eventType)) {
      mappedType = "media:renamed"
    }

    if (mappedType) {
      eventBus.emitEvent({
        type: mappedType,
        payload: {
          ...(payload.movie ? { movie: { title: payload.movie.title } } : {}),
          ...(payload.series ? { series: { title: payload.series.title } } : {}),
        },
      })
      // A grab or download changes availability state, so drop the cached
      // "Available Now / In Your Library" rows, genre profiles, etc.
      await invalidateAll()
    } else {
      // General fall-through event broadcast
      eventBus.emitEvent({
        type: "media:downloaded",
        payload: {},
      })
    }

    return NextResponse.json({ success: true, eventType, timestamp: new Date().toISOString() })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Webhook processing failed"
    return NextResponse.json({ error: errorMsg }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: "active",
    endpoint: "/api/webhooks",
    supportedEvents: ["On Grab", "On Download", "On Rename", "On Movie/Series Delete"],
  })
}
