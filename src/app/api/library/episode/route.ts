import { NextRequest, NextResponse } from "next/server"
import { getSession, setSessionCookie } from "@/lib/auth"
import { isAdminUser, canMakeRequest, incrementRequestCount } from "@/lib/rbac"
import { deleteJellyfinItem, getItemDetail } from "@/lib/jellyfin"
import * as sonarr from "@/lib/sonarr"
import { invalidateAll, ensureSonarrSeries } from "@/lib/cache"

/**
 * DELETE /api/library/episode
 * Authorization: Admin access required (403) — deleting media files from disk/Jellyfin
 * and unmonitoring is restricted to system administrators.
 */
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

    // 1. Validate jellyfinId format and ownership/matching episode server-side if provided
    if (jellyfinId) {
      if (typeof jellyfinId !== "string" || !/^[a-fA-F0-9-]{32,36}$/.test(jellyfinId)) {
        return NextResponse.json({ error: "Invalid jellyfinId format" }, { status: 400 })
      }
      const itemDetail = await getItemDetail(jellyfinId).catch(() => null)
      if (
        !itemDetail ||
        itemDetail.Type !== "Episode" ||
        itemDetail.IndexNumber !== episodeNumber ||
        itemDetail.ParentIndexNumber !== seasonNumber
      ) {
        return NextResponse.json({ error: "Provided jellyfinId does not match the target episode" }, { status: 400 })
      }
    }

    // 2. Unmonitor in Sonarr (using cached series lookup to avoid O(N) full fetch)
    const seriesMap = await ensureSonarrSeries(sonarr.getSeries).catch(() => new Map())
    const sonarrShow = seriesMap.get(Number(tvdbId))
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

    // 3. Delete file from Jellyfin if present
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
    console.error("Failed to delete episode:", err)
    return NextResponse.json({ error: "An error occurred while deleting the episode" }, { status: 500 })
  }
}

/**
 * POST /api/library/episode
 * Authorization: Authenticated users (401) subject to download permissions and daily quota (429).
 * Standard users can monitor and request automated search for missing episodes.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const check = canMakeRequest(session)
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: session ? 429 : 401 })
    }

    const body = await request.json()
    const { tvdbId, seasonNumber, episodeNumber } = body

    if (!tvdbId || typeof seasonNumber !== "number" || typeof episodeNumber !== "number") {
      return NextResponse.json({ error: "Missing required parameters: tvdbId, seasonNumber, episodeNumber" }, { status: 400 })
    }

    // Find Series in Sonarr (using cached series lookup)
    const seriesMap = await ensureSonarrSeries(sonarr.getSeries).catch(() => new Map())
    const sonarrShow = seriesMap.get(Number(tvdbId))
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

    // Explicit Search with failure tracking
    let searchTriggered = true
    await sonarr.searchEpisodes([ep.id]).catch((err) => {
      console.error("Failed to trigger Sonarr episode search command:", err)
      searchTriggered = false
    })

    // Increment request count for non-admin users
    if (session && !session.isAdmin) {
      const updatedSession = incrementRequestCount(session)
      await setSessionCookie(updatedSession)
    }

    await invalidateAll()

    return NextResponse.json({
      success: true,
      searchTriggered,
      message: searchTriggered
        ? "Episode is now monitored and search has been triggered"
        : "Episode is now monitored, but failed to trigger search in Sonarr",
    })
  } catch (err) {
    console.error("Failed to request episode:", err)
    return NextResponse.json({ error: "An error occurred while requesting the episode" }, { status: 500 })
  }
}

