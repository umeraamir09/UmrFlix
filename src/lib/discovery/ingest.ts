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

/** Re-watch signal: flat +0.80 for a second completion within 30 days; a
 *  later repeat (31–60d) earns the weaker +0.40 (spec: Module 1). */
export function computeRewatchWeight(daysSinceLastCompletion?: number): number {
  if (daysSinceLastCompletion != null && daysSinceLastCompletion > 30) {
    return 0.4
  }
  return 0.8
}

/**
 * §6.7: score TMDB search candidates for title resolution — year proximity,
 * popularity, and title similarity (case/diacritic-insensitive token match)
 * instead of blindly taking results[0], which injected wrong-ID garbage
 * vectors whenever names collided.
 */
export function pickBestSearchMatch(
  candidates: { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string; popularity?: number }[],
  queryTitle: string
): { id: number } | null {
  if (candidates.length === 0) return null

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()

  const q = normalize(queryTitle)
  let best: { id: number; score: number } | null = null

  for (const candidate of candidates) {
    const candidateTitle = candidate.title ?? candidate.name ?? ""
    const t = normalize(candidateTitle)
    if (!t) continue

    let score = 0
    if (t === q) score += 6
    else if (t.includes(q) || q.includes(t)) score += 3

    if (candidate.popularity && candidate.popularity > 0) {
      score += Math.min(3, Math.log10(1 + candidate.popularity))
    }

    if (!best || score > best.score) best = { id: candidate.id, score }
  }

  return best && best.score >= 3 ? { id: best.id } : candidates[0] ? { id: candidates[0].id } : null
}

const MAX_SERIES_CACHE_SIZE = 500
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
  if (seriesCache.size >= MAX_SERIES_CACHE_SIZE) {
    const oldestKey = seriesCache.keys().next().value
    if (oldestKey) seriesCache.delete(oldestKey)
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

    // Fallback: If ProviderIds lacked a TMDB ID, resolve by title so seed
    // candidates & recommendations link cleanly (§6.7: disambiguate by
    // popularity + title similarity instead of first-hit-wins).
    if (!tmdbId && title && mediaType) {
      try {
        const searchRes = mediaType === "tv" ? await searchTv(title) : await searchMovies(title)
        const best = searchRes?.results?.length
          ? pickBestSearchMatch(searchRes.results.slice(0, 5), title)
          : null
        if (best?.id) {
          tmdbId = best.id
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
    // same item within 60 days upgrades to a rewatch weight (the lookup
    // window is 60d so the >30d weaker-rewatch branch is actually reachable —
    // previously the 30d window made it dead code, §6.4).
    if (classification.eventType === "play_complete") {
      const now = Date.now()
      const priorEvents = await getRecentDiscoveryEvents(
        userId,
        profileId,
        now - 60 * MS_PER_DAY,
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
