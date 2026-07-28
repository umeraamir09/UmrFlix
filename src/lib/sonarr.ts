import { env } from "./env"

const BASE = env("SONARR_URL")
const KEY = env("SONARR_API_KEY")
const TIMEOUT = 8_000

async function sonarrFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE}/api/v3${path}`
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "X-Api-Key": KEY,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    })
    if (!res.ok) {
      throw new Error(`Sonarr API error: ${res.status} ${res.statusText}`)
    }
    return res.json()
  } finally {
    clearTimeout(id)
  }
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
}

export function getSeries(): Promise<SonarrSeries[]> {
  return sonarrFetch("/series")
}

export function addSeries(payload: {
  tvdbId: number
  title: string
  qualityProfileId: number
  rootFolderPath: string
  monitored: boolean
  seasonFolder: boolean
  addOptions: { searchForMissingEpisodes: boolean }
  seasons: { seasonNumber: number; monitored: boolean }[]
}): Promise<SonarrSeries> {
  return sonarrFetch("/series", {
    method: "POST",
    body: JSON.stringify(payload),
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
