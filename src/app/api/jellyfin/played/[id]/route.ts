import { NextResponse } from "next/server"
import { markItemPlayed, markItemUnplayed } from "@/lib/jellyfin"
import { isValidItemId } from "@/lib/validation"
import { getSession } from "@/lib/auth"
import { checkRateLimit, PLAYBACK_RATE_LIMITS } from "@/lib/rate-limit"
import { getClientIp } from "@/lib/audit"
import { invalidatePlaybackCache } from "@/app/api/jellyfin/playback/[id]/route"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 })
    }

    const session = await getSession()
    const clientIp = getClientIp(request)
    if (!session?.userId && !clientIp) {
      return NextResponse.json(
        { error: "Authentication or a trusted client IP is required" },
        { status: 401 },
      )
    }

    const rateLimitKey = session?.userId
      ? `played:${session.userId}`
      : `played:${clientIp}`

    if (!checkRateLimit(rateLimitKey, PLAYBACK_RATE_LIMITS.PLAYED)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 },
      )
    }

    await markItemPlayed(id)
    invalidatePlaybackCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to mark item as played"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 })
    }

    const session = await getSession()
    const clientIp = getClientIp(request)
    if (!session?.userId && !clientIp) {
      return NextResponse.json(
        { error: "Authentication or a trusted client IP is required" },
        { status: 401 },
      )
    }

    const rateLimitKey = session?.userId
      ? `played:${session.userId}`
      : `played:${clientIp}`

    if (!checkRateLimit(rateLimitKey, PLAYBACK_RATE_LIMITS.PLAYED)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a moment." },
        { status: 429 },
      )
    }

    await markItemUnplayed(id)
    invalidatePlaybackCache(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to mark item as unplayed"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

