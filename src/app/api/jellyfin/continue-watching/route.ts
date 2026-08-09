import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import {
  getResumeItems,
  getNextUpItems,
  buildJellyfinImageUrl,
  JellyfinAuthError,
} from "@/lib/jellyfin"
import type { JellyfinResumeItem } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

type CacheEntry = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[]
  timestamp: number
}

const cwCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 20_000 // 20-second per-user cache

function ticksToMinutes(ticks: number): number {
  return Math.round(ticks / 10_000_000 / 60)
}

function mapItem(item: JellyfinResumeItem, isNextUp: boolean) {
  const totalTicks = item.RunTimeTicks ?? 0
  const positionTicks = item.UserData?.PlaybackPositionTicks ?? 0

  const progressPercent = isNextUp
    ? 0
    : item.UserData?.PlayedPercentage ??
      (totalTicks > 0 ? Math.round((positionTicks / totalTicks) * 100) : 0)

  const remainingTicks = Math.max(0, totalTicks - positionTicks)
  const remainingMinutes = ticksToMinutes(remainingTicks)
  const timeLeft =
    !isNextUp && remainingMinutes > 0 ? `${remainingMinutes}m left` : undefined

  const episodeNumber =
    item.Type === "Episode" && item.IndexNumber != null
      ? `S${item.ParentIndexNumber ?? 1}:E${item.IndexNumber}`
      : undefined

  const title =
    item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name

  const episodeTitle = item.Type === "Episode" ? item.Name : undefined
  const imageUrl = buildJellyfinImageUrl(item, "Backdrop")
  const logoUrl = buildJellyfinImageUrl(item, "Logo")

  return {
    jellyfinItemId: item.Id,
    title,
    episodeTitle,
    episodeNumber,
    overview: item.Overview,
    imageUrl,
    logoUrl,
    mediaType: item.Type === "Episode" ? "tv" : "movie",
    progressPercent,
    timeLeft,
    providerIds: item.ProviderIds ?? {},
    isNextUp,
  }
}

export async function GET() {
  try {
    const session = await getSession()
    const userId = session?.userId ?? "anonymous"

    const now = Date.now()
    const cached = cwCache.get(userId)
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return NextResponse.json({ items: cached.items })
    }

    const [resumeItems, nextUpItems] = await Promise.all([
      getResumeItems(12),
      getNextUpItems(12),
    ])

    const seen = new Set(resumeItems.map((item) => item.Id))
    const mapped = [
      ...resumeItems.map((item) => mapItem(item, false)),
      ...nextUpItems
        .filter((item) => {
          if (seen.has(item.Id)) return false
          seen.add(item.Id)
          return true
        })
        .map((item) => mapItem(item, true)),
    ]

    cwCache.set(userId, { items: mapped, timestamp: now })

    return NextResponse.json({ items: mapped })
  } catch (err) {
    if (err instanceof JellyfinAuthError) {
      return NextResponse.json(
        { error: "Jellyfin authentication expired", jellyfinAuth: "expired" },
        { status: 403 }
      )
    }
    console.error("Continue watching API error:", err)
    return NextResponse.json({ items: [] }, { status: 500 })
  }
}
