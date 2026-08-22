import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { logDiscoveryEvent } from "@/lib/discovery/store"
import { invalidateDiscoveryProfile } from "@/lib/discovery/profile"

export const dynamic = "force-dynamic"

/**
 * §7.1 "Not Interested" MVP: explicit negative feedback.
 *
 * Logs a `rating` discovery event with weight −1.0 — the single most
 * valuable negative signal, previously missing entirely — which the profile
 * builder turns into a 90-day item hide (hiddenKeys) plus a negative vector
 * contribution. The item stays findable via search; it only vanishes from
 * personalized/discovery rows.
 */
export async function POST(request: Request) {
  let body: { tmdbId?: number; mediaType?: string; title?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { tmdbId, mediaType, title } = body
  if (
    typeof tmdbId !== "number" ||
    !Number.isInteger(tmdbId) ||
    (mediaType !== "movie" && mediaType !== "tv")
  ) {
    return NextResponse.json({ error: "tmdbId and mediaType (movie|tv) are required" }, { status: 400 })
  }

  const session = await getSession()
  if (!session?.userId) {
    return NextResponse.json({ ok: true })
  }
  const userId = session.userId

  await logDiscoveryEvent({
    userId,
    profileId: "default",
    itemId: `not-interested:${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    title: typeof title === "string" ? title : undefined,
    eventType: "rating",
    weight: -1.0,
    timestamp: Date.now(),
  })
  invalidateDiscoveryProfile(userId, "default")

  return NextResponse.json({ ok: true })
}
