import { getItemDetail, ticksToSeconds } from "../jellyfin"
import { searchMovies, searchTv } from "../tmdb"
import { logDiscoveryEvent, getRecentDiscoveryEvents, type DiscoveryEvent } from "./store"
import { invalidateDiscoveryProfile } from "./profile"
import { MS_PER_DAY } from "./vector"

/**
 * Signal ingestion (Discovery Engine, Module 1.1): converts raw playback and
 * explicit actions into weighted discovery events stored in Convex.
 *
 * All exported ingestion functions are fire-and-forget safe — they never
 * throw into the caller's request path.
 */

export type PlaybackClassification = {
  eventType: "play_complete" | "partial_play" | "abandonment"
  weight: number
  completionPct: number
}

/**
 * Weighting matrix (Module 1.1):
 *   ≥ 90%              → complete          +1.00
 *   ≤ 5% and ≤ 3 min   → abandonment       −0.40
 *   10%–89%            → partial           0.10 + 0.70·pct
 *   (5–10% gap)        → noise, no event
 */
export function classifyPlaybackStop(
  positionSec: number,
  runtimeSec: number
): PlaybackClassification | null {
  if (runtimeSec <= 0) return null
  const pct = Math.max(0, Math.min(1, positionSec / runtimeSec))

  if (pct >= 0.9) {
    return { eventType: "play_complete", weight: 1.0, completionPct: pct }
  }
  if (pct <= 0.05 && positionSec <= 180) {
    return { eventType: "abandonment", weight: -0.4, completionPct: pct }
  }
  if (pct >= 0.1) {
    return { eventType: "partial_play", weight: 0.10 + 0.7 * pct, completionPct: pct }
  }
  return null
}

/** Re-watch signal: flat +0.80 for a second completion within 30 days (spec: Module 1). */
export function computeRewatchWeight(_daysSinceLastCompletion?: number): number {
  return 0.8
}

const seriesCache = new Map<string, { itemId: string; tmdbId?: number; title?: string }>()

async function getSeriesMeta(seriesId: string): Promise<{ itemId: string; tmdbId?: number; title?: string }> {
  const cached = seriesCache.get(seriesId)
  if (cached) return cached
  const detail = await getItemDetail(seriesId)
  const tmdbIdRaw = detail?.ProviderIds?.Tmdb ?? detail?.ProviderIds?.tmdb
  const tmdbId = tmdbIdRaw ? Number.parseInt(tmdbIdRaw, 10) : undefined
  const meta = {
    itemId: seriesId,
    tmdbId: Number.isFinite(tmdbId) ? tmdbId : undefined,
    title: detail?.Name ?? detail?.SeriesName,
  }
  seriesCache.set(seriesId, meta)
  return meta
}

export async function ingestPlaybackStopped(params: {
  userId: string
  profileId?: string
  jellyfinItemId: string
  positionTicks: number
  context?: string
}): Promise<void> {
  const { userId, jellyfinItemId, positionTicks, context } = params
  const profileId = params.profileId ?? "default"

  try {
    const detail = await getItemDetail(jellyfinItemId)
    if (!detail) return

    const runtimeSec = ticksToSeconds(detail.RunTimeTicks ?? 0)
    const positionSec = ticksToSeconds(positionTicks)
    const classification = classifyPlaybackStop(positionSec, runtimeSec)
    if (!classification) return

    let eventItemId = jellyfinItemId
    const tmdbIdRaw = detail.ProviderIds?.Tmdb ?? detail.ProviderIds?.tmdb ?? detail.ProviderIds?.TMDB
    let tmdbId = tmdbIdRaw ? Number.parseInt(tmdbIdRaw, 10) : undefined
    let mediaType: "movie" | "tv" | undefined =
      detail.Type === "Movie" ? "movie" : detail.Type === "Episode" || detail.Type === "Series" ? "tv" : undefined
    let title = detail.SeriesName ?? detail.Name

    if (detail.Type === "Episode" && detail.SeriesId) {
      const seriesMeta = await getSeriesMeta(detail.SeriesId)
      eventItemId = seriesMeta.itemId
      if (seriesMeta.tmdbId) tmdbId = seriesMeta.tmdbId
      if (seriesMeta.title) title = seriesMeta.title
      mediaType = "tv"
    }

    // Fallback: If ProviderIds lacked a TMDB ID, resolve by title so seed candidates & recommendations link cleanly
    if (!tmdbId && title && mediaType) {
      try {
        const searchRes = mediaType === "tv" ? await searchTv(title) : await searchMovies(title)
        if (searchRes?.results?.[0]?.id) {
          tmdbId = searchRes.results[0].id
        }
      } catch {
        /* fallback safe */
      }
    }

    let eventType: DiscoveryEvent["eventType"] = classification.eventType
    let weight = classification.weight

    if (context === "party") {
      weight *= 0.25
    }

    // Re-watch detection: a completion preceded by another completion of the
    // same item within 30 days upgrades to the high-signal rewatch weight.
    if (classification.eventType === "play_complete") {
      const now = Date.now()
      const priorEvents = await getRecentDiscoveryEvents(
        userId,
        profileId,
        now - 30 * MS_PER_DAY,
        200
      )
      const lastCompletion = priorEvents.find(
        (e) =>
          e.itemId === eventItemId &&
          (e.eventType === "play_complete" || e.eventType === "rewatch")
      )
      if (lastCompletion) {
        eventType = "rewatch"
        weight = computeRewatchWeight((now - lastCompletion.timestamp) / MS_PER_DAY)
        if (context === "party") weight *= 0.25
      }
    }

    await logDiscoveryEvent({
      userId,
      profileId,
      itemId: eventItemId,
      tmdbId: Number.isFinite(tmdbId) ? tmdbId : undefined,
      mediaType,
      title,
      eventType,
      weight,
      completionPct: classification.completionPct,
      watchDurationSec: Math.round(positionSec),
      context: context ?? undefined,
      timestamp: Date.now(),
    })
    invalidateDiscoveryProfile(userId, profileId)
  } catch (err) {
    console.error("[Discovery] Playback ingestion failed:", err)
  }
}

export async function ingestFavoriteToggle(params: {
  userId: string
  profileId?: string
  itemId: string
  tmdbId?: number
  mediaType?: "movie" | "tv"
  title?: string
  added: boolean
}): Promise<void> {
  const { added, ...rest } = params
  try {
    await logDiscoveryEvent({
      userId: rest.userId,
      profileId: params.profileId ?? "default",
      itemId: rest.itemId,
      tmdbId: rest.tmdbId,
      mediaType: rest.mediaType,
      title: rest.title,
      eventType: added ? "favorite" : "unfavorite",
      weight: added ? 1.0 : -0.6,
      timestamp: Date.now(),
    })
    invalidateDiscoveryProfile(rest.userId, params.profileId ?? "default")
  } catch (err) {
    console.error("[Discovery] Favorite ingestion failed:", err)
  }
}

export async function ingestRequestCreated(params: {
  userId: string
  profileId?: string
  itemId: string
  tmdbId?: number
  mediaType?: "movie" | "tv"
  title?: string
}): Promise<void> {
  try {
    await logDiscoveryEvent({
      userId: params.userId,
      profileId: params.profileId ?? "default",
      itemId: params.itemId,
      tmdbId: params.tmdbId,
      mediaType: params.mediaType,
      title: params.title,
      eventType: "request",
      weight: 1.0,
      timestamp: Date.now(),
    })
    invalidateDiscoveryProfile(params.userId, params.profileId ?? "default")
  } catch (err) {
    console.error("[Discovery] Request ingestion failed:", err)
  }
}
