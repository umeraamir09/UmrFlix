import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import { deleteJellyfinItem } from "@/lib/jellyfin"
import * as sonarr from "@/lib/sonarr"
import { invalidateAll } from "@/lib/cache"

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
    }

    const body = await request.json()
    const { jellyfinId, tvdbId, seasonNumber, episodeNumber } = body

    if (!tvdbId || typeof seasonNumber !== "number" || typeof episodeNumber !== "number") {
      return NextResponse.json({ error: "Missing required parameters: tvdbId, seasonNumber, episodeNumber" }, { status: 400 })
    }

    // 1. Unmonitor in Sonarr
    const allSeries = await sonarr.getSeries().catch(() => [])
    const sonarrShow = allSeries.find((s) => s.tvdbId === tvdbId)
    if (sonarrShow) {
      const sonarrEpisodes = await sonarr.getEpisodes(sonarrShow.id).catch(() => [])
      const ep = sonarrEpisodes.find(
        (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
      )
      if (ep) {
        await sonarr.updateEpisode(ep.id, {
          ...ep,
          monitored: false,
        }).catch((err) => {
          console.error("Failed to unmonitor episode in Sonarr:", err)
        })
      }
    }

    // 2. Delete file from Jellyfin if present
    let jfDeleted = false
    if (jellyfinId) {
      jfDeleted = await deleteJellyfinItem(jellyfinId)
      if (!jfDeleted) {
        return NextResponse.json({ error: "Failed to delete item from Jellyfin" }, { status: 500 })
      }
    }

    await invalidateAll()

    return NextResponse.json({
      success: true,
      jellyfinDeleted: jfDeleted,
      message: "Episode removed from library and unmonitored in Sonarr",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete episode"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { tvdbId, seasonNumber, episodeNumber } = body

    if (!tvdbId || typeof seasonNumber !== "number" || typeof episodeNumber !== "number") {
      return NextResponse.json({ error: "Missing required parameters: tvdbId, seasonNumber, episodeNumber" }, { status: 400 })
    }

    // Find Series in Sonarr
    const allSeries = await sonarr.getSeries().catch(() => [])
    const sonarrShow = allSeries.find((s) => s.tvdbId === tvdbId)
    if (!sonarrShow) {
      return NextResponse.json({
        error: "This TV show is not currently in Sonarr/Jellyfin. Please request the full TV Show first.",
      }, { status: 400 })
    }

    // Find Episode in Sonarr
    const sonarrEpisodes = await sonarr.getEpisodes(sonarrShow.id).catch(() => [])
    const ep = sonarrEpisodes.find(
      (e) => e.seasonNumber === seasonNumber && e.episodeNumber === episodeNumber
    )

    if (!ep) {
      return NextResponse.json({ error: "Episode not found in Sonarr catalog" }, { status: 404 })
    }

    // Monitor Episode
    await sonarr.updateEpisode(ep.id, {
      ...ep,
      monitored: true,
    })

    // Explicit Search
    await sonarr.searchEpisodes([ep.id]).catch((err) => {
      console.error("Failed to trigger Sonarr episode search command:", err)
    })

    await invalidateAll()

    return NextResponse.json({
      success: true,
      message: "Episode is now monitored and search has been triggered",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to request episode"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
