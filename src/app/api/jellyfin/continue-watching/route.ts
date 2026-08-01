import { NextResponse } from "next/server"
import {
  getResumeItems,
  getNextUpItems,
  buildJellyfinImageUrl,
} from "@/lib/jellyfin"
import type { JellyfinResumeItem } from "@/lib/jellyfin"

export const dynamic = "force-dynamic" // never cache – always fresh

function ticksToMinutes(ticks: number): number {
  // 1 tick = 100 nanoseconds → 10,000,000 ticks = 1 second
  return Math.round(ticks / 10_000_000 / 60)
}

function mapItem(item: JellyfinResumeItem, isNextUp: boolean) {
  const totalTicks = item.RunTimeTicks ?? 0
  const positionTicks = item.UserData?.PlaybackPositionTicks ?? 0

  // Compute progress %
  const progressPercent = isNextUp
    ? 0
    : item.UserData?.PlayedPercentage ??
      (totalTicks > 0 ? Math.round((positionTicks / totalTicks) * 100) : 0)

  // Time remaining
  const remainingTicks = Math.max(0, totalTicks - positionTicks)
  const remainingMinutes = ticksToMinutes(remainingTicks)
  const timeLeft =
    !isNextUp && remainingMinutes > 0 ? `${remainingMinutes}m left` : undefined

  // Episode label
  const episodeNumber =
    item.Type === "Episode" && item.IndexNumber != null
      ? `S${item.ParentIndexNumber ?? 1}:E${item.IndexNumber}`
      : undefined

  const title =
    item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name

  const episodeTitle = item.Type === "Episode" ? item.Name : undefined

  // Image – prefer backdrop for the 16:9 card; episodes use their exact thumbnail
  const imageUrl = buildJellyfinImageUrl(item, "Backdrop")

  return {
    jellyfinItemId: item.Id,
    title,
    episodeTitle,
    episodeNumber,
    imageUrl,
    mediaType: item.Type === "Episode" ? "tv" : "movie",
    progressPercent,
    timeLeft,
    providerIds: item.ProviderIds ?? {},
    isNextUp,
  }
}

export async function GET() {
  try {
    const [resumeItems, nextUpItems] = await Promise.all([
      getResumeItems(12),
      getNextUpItems(12),
    ])

    // Continue Watching first (resume), then Next Up. Dedupe by item id in
    // case the same episode somehow appears in both responses.
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

    return NextResponse.json({ items: mapped })
  } catch (err) {
    console.error("Continue watching API error:", err)
    return NextResponse.json({ items: [] }, { status: 500 })
  }
}
