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
    return NextResponse.json({ error: message, torrents: [], transferInfo: null }, { status: 500 })
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

    if (!action || !hashes || !Array.isArray(hashes) || hashes.length === 0) {
      return NextResponse.json({ error: "Missing action or hashes array" }, { status: 400 })
    }

    const qbitHashes: string[] = []
    const radarrIds: number[] = []
    const sonarrIds: number[] = []

    for (const h of hashes) {
      if (typeof h === "string") {
        if (h.startsWith("radarr_")) {
          const id = parseInt(h.replace("radarr_", ""), 10)
          if (!isNaN(id)) radarrIds.push(id)
        } else if (h.startsWith("sonarr_")) {
          const id = parseInt(h.replace("sonarr_", ""), 10)
          if (!isNaN(id)) sonarrIds.push(id)
        } else {
          qbitHashes.push(h)
        }
      }
    }

    let success = true

    if (qbitHashes.length > 0) {
      if (action === "pause") {
        const ok = await pauseTorrents(qbitHashes)
        if (!ok) success = false
      } else if (action === "resume") {
        const ok = await resumeTorrents(qbitHashes)
        if (!ok) success = false
      } else if (action === "delete") {
        const ok = await deleteTorrents(qbitHashes, Boolean(deleteFiles))
        if (!ok) success = false
      } else {
        return NextResponse.json({ error: "Invalid action" }, { status: 400 })
      }
    }

    if (action === "delete") {
      if (radarrIds.length > 0) {
        await Promise.all(radarrIds.map((id) => radarr.removeFromQueue(id).catch(() => null)))
      }
      if (sonarrIds.length > 0) {
        await Promise.all(sonarrIds.map((id) => sonarr.removeFromQueue(id).catch(() => null)))
      }
    }

    if (!success && qbitHashes.length > 0) {
      return NextResponse.json(
        { error: `Failed to ${action} torrent(s) in qBittorrent.` },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "qBittorrent action failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
