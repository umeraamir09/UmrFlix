import { env } from "./env"

const BASE = env("RADARR_URL")
const KEY = env("RADARR_API_KEY")
const TIMEOUT = 8_000

async function radarrFetch<T>(path: string, options?: RequestInit): Promise<T> {
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
      throw new Error(`Radarr API error: ${res.status} ${res.statusText}`)
    }
    return res.json()
  } finally {
    clearTimeout(id)
  }
}

export type RadarrMovie = {
  id: number
  tmdbId: number
  title: string
  hasFile: boolean
  monitored: boolean
  status: string
  qualityProfileId: number
  rootFolderPath: string
  year: number
  images: { coverType: string; url: string }[]
}

export type RadarrQueueItem = {
  id: number
  movieId: number
  title: string
  status: string
  estimatedCompletionTime: string | null
  timeleft: string | null
  sizeleft: number
  totalSize: number
  progressPercent: number
}

export type QualityProfile = {
  id: number
  name: string
}

export type RootFolder = {
  id: number
  path: string
  accessible: boolean
  freeSpace?: number
}

export type Tag = {
  id: number
  label: string
}

export function getMovies(): Promise<RadarrMovie[]> {
  return radarrFetch("/movie")
}

export function getMovieByTmdbId(tmdbId: number): Promise<RadarrMovie | null> {
  return radarrFetch<RadarrMovie[]>(`/movie?tmdbId=${tmdbId}`).then((r) => r[0] ?? null)
}

export function addMovie(payload: {
  tmdbId: number
  title: string
  year: number
  qualityProfileId: number
  rootFolderPath: string
  monitored?: boolean
  minimumAvailability?: string
  tags?: number[]
  addOptions?: { searchForMovie?: boolean }
}): Promise<RadarrMovie> {
  return radarrFetch("/movie", {
    method: "POST",
    body: JSON.stringify({
      monitored: true,
      minimumAvailability: "announced",
      ...payload,
      addOptions: { searchForMovie: true, ...payload.addOptions },
    }),
  })
}

export function getQueue(): Promise<RadarrQueueItem[]> {
  return radarrFetch("/queue")
}

export function getQualityProfiles(): Promise<QualityProfile[]> {
  return radarrFetch("/qualityprofile")
}

export function getRootFolders(): Promise<RootFolder[]> {
  return radarrFetch("/rootfolder")
}

export function getTags(): Promise<Tag[]> {
  return radarrFetch("/tag")
}

export type DiskSpaceItem = {
  path: string
  label?: string
  freeSpace: number
  totalSpace: number
}

export function getDiskSpace(): Promise<DiskSpaceItem[]> {
  return radarrFetch("/diskspace")
}


