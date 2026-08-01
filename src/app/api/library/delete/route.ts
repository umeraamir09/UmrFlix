import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import { deleteJellyfinItem } from "@/lib/jellyfin"
import * as radarr from "@/lib/radarr"
import * as sonarr from "@/lib/sonarr"
import { invalidateAll } from "@/lib/cache"

export async function DELETE(request: NextRequest) {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 })
    }

    const body = await request.json()
    const { jellyfinId, type, tmdbId, tvdbId } = body

    if (!jellyfinId || typeof jellyfinId !== "string" || !/^[a-zA-Z0-9._-]+$/.test(jellyfinId)) {
      return NextResponse.json({ error: "Invalid jellyfinId" }, { status: 400 })
    }
    if (type !== "movie" && type !== "tv") {
      return NextResponse.json({ error: "type must be 'movie' or 'tv'" }, { status: 400 })
    }

    // 1. Delete media folder / item from Jellyfin
    const jfDeleted = await deleteJellyfinItem(jellyfinId)
    if (!jfDeleted) {
      return NextResponse.json({ error: "Failed to delete item from Jellyfin" }, { status: 500 })
    }

    // 2. Delete media & show/movie entry from Radarr / Sonarr
    if (type === "movie" && tmdbId) {
      const radarrMovie = await radarr.getMovieByTmdbId(tmdbId).catch(() => null)
      if (radarrMovie) {
        await radarr.deleteMovie(radarrMovie.id, true).catch((err) => {
          console.error("Failed to delete movie from Radarr:", err)
        })
      }
    } else if (type === "tv" && tvdbId) {
      const allSeries = await sonarr.getSeries().catch(() => [])
      const sonarrShow = allSeries.find((s) => s.tvdbId === tvdbId)
      if (sonarrShow) {
        await sonarr.deleteSeries(sonarrShow.id, true).catch((err) => {
          console.error("Failed to delete series from Sonarr:", err)
        })
      }
    }

    // Invalidate local memory caches
    invalidateAll()

    return NextResponse.json({
      success: true,
      jellyfinDeleted: true,
      message: "Item removed from library and media automation",
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete item"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
