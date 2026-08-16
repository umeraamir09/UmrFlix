import { NextResponse } from "next/server"
import { isValidItemId } from "@/lib/validation"
import {
  authenticate,
  getSeasons,
  getEpisodes,
  buildItemImageUrl,
  ticksToSeconds,
} from "@/lib/jellyfin"
import * as sonarr from "@/lib/sonarr"
import { ensureSonarrSeries } from "@/lib/cache"

export const dynamic = "force-dynamic"

export type EpisodeStatus =
  | "in_library"
  | "downloading"
  | "missing"
  | "unaired"

/**
 * GET /api/jellyfin/series/[id]/episodes?tvdbId=123
 *
 * Returns every season (posters + counts) and all episodes with thumbnails,
 * air dates, runtimes, overview, Jellyfin resume state and an availability
 * status merged from the Sonarr queue when a tvdbId is supplied.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid series ID" }, { status: 400 })
    }
    const tvdbId = Number(new URL(request.url).searchParams.get("tvdbId")) || null

    const { token } = await authenticate()
    const [seasons, episodes] = await Promise.all([
      getSeasons(id),
      getEpisodes(id),
    ])

    // ── Sonarr download status (best-effort) ──
    // Map: "S{season}E{episode}" -> queue progress (0-100)
    const downloadingMap = new Map<string, number>()
    if (tvdbId) {
      try {
        const seriesMap = await ensureSonarrSeries(() => sonarr.getSeries())
        const sonarrSeries = seriesMap.get(tvdbId)
        if (sonarrSeries) {
          const [sonarrEpisodes, queue] = await Promise.all([
            sonarr.getEpisodes(sonarrSeries.id).catch(() => [] as sonarr.SonarrEpisode[]),
            sonarr.getQueue().catch(() => [] as sonarr.SonarrQueueItem[]),
          ])
          const downloadingEpisodeIds = new Set(
            queue
              .filter((q) => q.seriesId === sonarrSeries.id && q.episodeId)
              .map((q) => q.episodeId as number),
          )
          const queueProgress = new Map(
            queue
              .filter((q) => q.seriesId === sonarrSeries.id && q.episodeId)
              .map((q) => [q.episodeId as number, q.progressPercent]),
          )
          for (const ep of sonarrEpisodes) {
            if (downloadingEpisodeIds.has(ep.id)) {
              downloadingMap.set(
                `S${ep.seasonNumber}E${ep.episodeNumber}`,
                queueProgress.get(ep.id) ?? 0,
              )
            }
          }
        }
      } catch {
        /* Sonarr offline — status falls back to Jellyfin data only */
      }
    }

    const mappedEpisodes = episodes.map((ep) => {
      const seasonNumber = ep.ParentIndexNumber ?? 0
      const episodeNumber = ep.IndexNumber ?? 0
      const key = `S${seasonNumber}E${episodeNumber}`

      const hasFile = ep.LocationType !== "Virtual"
      const aired = !ep.PremiereDate || new Date(ep.PremiereDate) <= new Date()

      let status: EpisodeStatus
      let downloadProgress: number | undefined
      if (hasFile) {
        status = "in_library"
      } else if (downloadingMap.has(key)) {
        status = "downloading"
        downloadProgress = downloadingMap.get(key)
      } else if (!aired) {
        status = "unaired"
      } else {
        status = "missing"
      }

      const positionTicks = ep.UserData?.PlaybackPositionTicks ?? 0
      const runtimeTicks = ep.RunTimeTicks ?? 0

      return {
        id: ep.Id,
        title: ep.Name,
        seasonNumber,
        episodeNumber,
        seasonId: ep.SeasonId,
        overview: ep.Overview ?? "",
        airDate: ep.PremiereDate ?? null,
        runtimeMinutes: runtimeTicks > 0 ? Math.round(ticksToSeconds(runtimeTicks) / 60) : null,
        runtimeTicks,
        status,
        downloadProgress,
        played: ep.UserData?.Played ?? false,
        playedPercentage:
          ep.UserData?.PlayedPercentage ??
          (runtimeTicks > 0 ? Math.round((positionTicks / runtimeTicks) * 100) : 0),
        resumeTicks: positionTicks,
        thumbUrl: buildItemImageUrl(ep.Id, token, "Primary", 640),
      }
    })

    const mappedSeasons = seasons
      .map((s) => ({
        id: s.Id,
        name: s.Name,
        seasonNumber: s.IndexNumber ?? 0,
        episodeCount: mappedEpisodes.filter((e) => e.seasonId === s.Id).length || s.ChildCount || 0,
        imageUrl: s.ImageTags?.Primary ? buildItemImageUrl(s.Id, token, "Primary", 300) : null,
      }))
      // Hide special/extras season unless it's the only one
      .filter((s, _, all) => s.seasonNumber !== 0 || all.length === 1)
      .sort((a, b) => a.seasonNumber - b.seasonNumber)

    return NextResponse.json({
      seriesId: id,
      seasons: mappedSeasons,
      episodes: mappedEpisodes,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load episodes"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
