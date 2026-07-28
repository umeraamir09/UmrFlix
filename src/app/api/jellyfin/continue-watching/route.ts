import { NextResponse } from "next/server"
import {
  getResumeItems,
  buildJellyfinImageUrl,
} from "@/lib/jellyfin"

export const dynamic = "force-dynamic" // never cache – always fresh

function ticksToMinutes(ticks: number): number {
  // 1 tick = 100 nanoseconds → 10,000,000 ticks = 1 second
  return Math.round(ticks / 10_000_000 / 60)
}

export async function GET() {
  try {
    const items = await getResumeItems(12)

    const mapped = items.map((item) => {
      const totalTicks = item.RunTimeTicks ?? 0
      const positionTicks = item.UserData?.PlaybackPositionTicks ?? 0

      // Compute progress %
      const progressPercent =
        item.UserData?.PlayedPercentage ??
        (totalTicks > 0 ? Math.round((positionTicks / totalTicks) * 100) : 0)

      // Time remaining
      const remainingTicks = Math.max(0, totalTicks - positionTicks)
      const remainingMinutes = ticksToMinutes(remainingTicks)
      const timeLeft =
        remainingMinutes > 0 ? `${remainingMinutes}m left` : undefined

      // Episode label
      const episodeNumber =
        item.Type === "Episode" && item.IndexNumber != null
          ? `S${item.ParentIndexNumber ?? 1}:E${item.IndexNumber}`
          : undefined

      const title =
        item.Type === "Episode" ? (item.SeriesName ?? item.Name) : item.Name

      const episodeTitle = item.Type === "Episode" ? item.Name : undefined

      // Image – prefer backdrop for the 16:9 card
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
      }
    })

    return NextResponse.json({ items: mapped })
  } catch (err) {
    console.error("Continue watching API error:", err)
    return NextResponse.json({ items: [] }, { status: 500 })
  }
}
