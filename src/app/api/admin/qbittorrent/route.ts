import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import {
  getTorrents,
  getTransferInfo,
  pauseTorrents,
  resumeTorrents,
  deleteTorrents,
  QBittorrentItem,
} from "@/lib/qbittorrent"
import * as radarr from "@/lib/radarr"
import * as sonarr from "@/lib/sonarr"

export async function GET() {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const [torrents, transferInfo] = await Promise.all([
      getTorrents().catch(() => []),
      getTransferInfo().catch(() => null),
    ])

    // If qBittorrent returned items directly, use them
    if (torrents.length > 0) {
      return NextResponse.json({ torrents, transferInfo })
    }

    // Fallback: Query Radarr & Sonarr queues
    const [radarrQueue, sonarrQueue] = await Promise.all([
      radarr.getQueue().catch(() => []),
      sonarr.getQueue().catch(() => []),
    ])

    const fallbackTorrents: QBittorrentItem[] = [
      ...radarrQueue.map((q) => ({
        hash: `radarr_${q.id}`,
        name: q.title || `Movie Download #${q.movieId}`,
        size: q.totalSize || 0,
        progress: q.totalSize > 0 ? (q.totalSize - q.sizeleft) / q.totalSize : (q.progressPercent ? q.progressPercent / 100 : 0),
        dlspeed: 0,
        upspeed: 0,
        eta: 0,
        state: q.status || "downloading",
        num_seeds: 0,
        num_leechs: 0,
        added_on: Date.now(),
      })),
      ...sonarrQueue.map((q) => ({
        hash: `sonarr_${q.id}`,
        name: q.title || `Series Download #${q.seriesId}`,
        size: q.totalSize || 0,
        progress: q.totalSize > 0 ? (q.totalSize - q.sizeleft) / q.totalSize : (q.progressPercent ? q.progressPercent / 100 : 0),
        dlspeed: 0,
        upspeed: 0,
        eta: 0,
        state: q.status || "downloading",
        num_seeds: 0,
        num_leechs: 0,
        added_on: Date.now(),
      })),
    ]

    return NextResponse.json({ torrents: fallbackTorrents, transferInfo })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch qBittorrent status"
    return NextResponse.json({ error: message, torrents: [], transferInfo: null }, { status: 200 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const body = await request.json()
    const { action, hashes, deleteFiles } = body

    if (!action || !hashes || !Array.isArray(hashes)) {
      return NextResponse.json({ error: "Missing action or hashes array" }, { status: 400 })
    }

    let success = false
    if (action === "pause") {
      success = await pauseTorrents(hashes)
    } else if (action === "resume") {
      success = await resumeTorrents(hashes)
    } else if (action === "delete") {
      success = await deleteTorrents(hashes, Boolean(deleteFiles))
    } else {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 })
    }

    return NextResponse.json({ success })
  } catch (e) {
    const message = e instanceof Error ? e.message : "qBittorrent action failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
