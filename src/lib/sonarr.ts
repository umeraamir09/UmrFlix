import { env } from "./env"
import { resilientFetch } from "./resilient-fetch"
import { sonarrBreaker } from "./circuit-breaker"

const BASE = env("SONARR_URL")
const KEY = env("SONARR_API_KEY")
const TIMEOUT = 8_000

function sonarrFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE}/api/v3${path}`
  return resilientFetch<T>(url, {
    ...options,
    timeoutMs: TIMEOUT,
    breaker: sonarrBreaker,
    headers: {
      "X-Api-Key": KEY,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  })
}


export type SonarrSeries = {
  id: number
  tvdbId: number
  title: string
  monitored: boolean
  status: string
  qualityProfileId: number
  rootFolderPath: string
  year: number
  seasonCount: number
  seasons?: { seasonNumber: number; monitored: boolean }[]
  images: { coverType: string; url: string }[]
}

export type SonarrQueueItem = {
  id: number
  seriesId: number
  episodeId?: number
  title: string
  status: string
  estimatedCompletionTime: string | null
  timeleft: string | null
  sizeleft: number
  totalSize: number
  progressPercent: number
}

export type SonarrEpisode = {
  id: number
  seriesId: number
  seasonNumber: number
  episodeNumber: number
  title: string
  hasFile: boolean
  monitored: boolean
  airDateUtc?: string
  episodeFileId?: number
}

export type SonarrQualityProfile = {
  id: number
  name: string
}

export type SonarrRootFolder = {
  id: number
  path: string
  accessible: boolean
  freeSpace?: number
}

export type SonarrTag = {
  id: number
  label: string
}

export function getSeries(): Promise<SonarrSeries[]> {
  return sonarrFetch("/series")
}

export function addSeries(payload: {
  tvdbId: number
  title: string
  qualityProfileId: number
  rootFolderPath: string
  monitored?: boolean
  seriesType?: string
  tags?: number[]
  seasonFolder?: boolean
  addOptions?: { searchForMissingEpisodes?: boolean }
  seasons?: { seasonNumber: number; monitored: boolean }[]
}): Promise<SonarrSeries> {
  return sonarrFetch("/series", {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      monitored: payload.monitored ?? true,
      seasonFolder: payload.seasonFolder ?? true,
      seriesType: payload.seriesType ?? "standard",
      addOptions: { searchForMissingEpisodes: true, ...payload.addOptions },
    }),
  })
}

export function getQueue(): Promise<SonarrQueueItem[]> {
  return sonarrFetch("/queue")
}

export function getEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
  return sonarrFetch(`/episode?seriesId=${seriesId}`)
}

export function getQualityProfiles(): Promise<SonarrQualityProfile[]> {
  return sonarrFetch("/qualityprofile")
}

export function getRootFolders(): Promise<SonarrRootFolder[]> {
  return sonarrFetch("/rootfolder")
}

export function getTags(): Promise<SonarrTag[]> {
  return sonarrFetch("/tag")
}

export type SonarrDiskSpaceItem = {
  path: string
  label?: string
  freeSpace: number
  totalSpace: number
}

export function updateSeries(payload: SonarrSeries & Record<string, unknown>): Promise<SonarrSeries> {
  return sonarrFetch(`/series/${payload.id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  })
}

export function searchSeries(seriesId: number): Promise<unknown> {
  return sonarrFetch("/command", {
    method: "POST",
    body: JSON.stringify({
      name: "SeriesSearch",
      seriesId,
    }),
  })
}

export function getDiskSpace(): Promise<SonarrDiskSpaceItem[]> {
  return sonarrFetch("/diskspace")
}



