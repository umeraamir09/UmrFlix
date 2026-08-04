import { NextRequest, NextResponse } from "next/server"
import { eventBus } from "@/lib/event-bus"
import { invalidateAll } from "@/lib/cache"
import {
  getAllRequests,
  notifyDownloadStarted,
  notifyItemAvailable,
} from "@/lib/requests-store"
import { getDownloadTracker } from "@/lib/download-tracker"

type WebhookMedia = {
  title?: string
  tmdbId?: number
  tvdbId?: number
  id?: number
}

function pickMedia(payload: Record<string, unknown>): { movie?: WebhookMedia; series?: WebhookMedia } {
  const movie = payload.movie as WebhookMedia | undefined
  const series = payload.series as WebhookMedia | undefined
  return {
    movie: movie
      ? { title: movie.title, tmdbId: movie.tmdbId, id: movie.id }
      : undefined,
    series: series
      ? { title: series.title, tvdbId: series.tvdbId, id: series.id }
      : undefined,
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

async function findMatchingRequests(media: { movie?: WebhookMedia; series?: WebhookMedia }): Promise<
  Awaited<ReturnType<typeof getAllRequests>>
> {
  const all = await getAllRequests().catch(() => [])
  const approved = all.filter((r) => r.status === "approved")

  const movie = media.movie
  const series = media.series
  const title = movie?.title ?? series?.title

  return approved.filter((r) => {
    if (movie && r.mediaType === "movie") {
      if (movie.tmdbId && r.tmdbId === movie.tmdbId) return true
    }
    if (series && r.mediaType === "tv") {
      const targetTvdb = series.tvdbId
      if (targetTvdb && (r.tvdbId === targetTvdb || r.tmdbId === targetTvdb)) return true
    }
    if (title && normalizeTitle(r.title) === normalizeTitle(title)) return true
    return false
  })
}

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
      const media = pickMedia(payload)
      eventBus.emitEvent({
        type: mappedType,
        payload: {
          ...(media.movie ? { movie: media.movie } : {}),
          ...(media.series ? { series: media.series } : {}),
        },
      })

      getDownloadTracker()

      const matches = await findMatchingRequests(media)
      for (const req of matches) {
        if (mappedType === "media:grabbed") {
          await notifyDownloadStarted(req, 0).catch(() => null)
        } else {
          await notifyItemAvailable(req).catch(() => null)
        }
      }

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
