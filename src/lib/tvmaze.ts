// TVMaze API Client
// Public API: https://api.tvmaze.com (no key required)
// Premium API: https://api.tvmaze.com (requires API key for certain endpoints)

const TVMAZE_BASE = "https://api.tvmaze.com"
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export type TvMazeEpisode = {
  id: number
  name: string
  season: number
  number: number
  airdate: string // ISO date
  airtime: string // HH:mm
  airstamp: string // ISO datetime
  runtime: number
  summary?: string
  show?: {
    id: number
    name: string
    status: string
    premiered?: string
  }
}

export type TvMazeShow = {
  id: number
  name: string
  status: "Running" | "Ended" | "To Be Determined" | "In Development" | string
  premiered?: string
  ended?: string
  schedule?: {
    time: string
    days: string[]
  }
  network?: {
    name: string
    country?: {
      name: string
      timezone: string
    }
  }
  webChannel?: {
    name: string
    country?: {
      name: string
      timezone: string
    }
  }
  externals?: {
    tvrage?: number
    thetvdb?: number
    imdb?: string
  }
  episodes?: TvMazeEpisode[]
}

export type TvMazeScheduleEntry = {
  id: number
  name: string
  season: number
  number: number
  airdate: string
  airstamp: string
  show: TvMazeShow
}

// Simple in-memory cache
const scheduleCache = new Map<string, { data: TvMazeScheduleEntry[]; timestamp: number }>()
const showCache = new Map<number, { data: TvMazeShow; timestamp: number }>()

async function fetchWithTimeout(url: string, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/json",
      },
    })
    return res
  } finally {
    clearTimeout(id)
  }
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_DURATION
}

export async function lookupShowByTvdbId(tvdbId: number): Promise<TvMazeShow | null> {
  try {
    const url = `${TVMAZE_BASE}/lookup/shows?thetvdb=${tvdbId}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`TVMaze lookup error: ${res.status}`)
    }
    const show: TvMazeShow = await res.json()
    return show
  } catch (err) {
    console.error(`Failed to lookup show by TVDB ID ${tvdbId}:`, err)
    return null
  }
}

export async function lookupShowByTmdbId(tmdbId: number, name?: string): Promise<TvMazeShow | null> {
  // TVMaze doesn't have direct TMDB lookup, so we search by name
  if (name) {
    try {
      const searchUrl = `${TVMAZE_BASE}/search/shows?q=${encodeURIComponent(name)}`
      const res = await fetchWithTimeout(searchUrl)
      if (!res.ok) return null
      const results: Array<{ show: TvMazeShow }> = await res.json()
      
      // Find best match (exact name match or first result)
      const found = results.find(r => 
        r.show.name.toLowerCase() === name.toLowerCase() ||
        r.show.externals?.thetvdb
      ) || results[0]
      
      return found?.show ?? null
    } catch (err) {
      console.error(`Failed to search show by name "${name}":`, err)
    }
  }
  return null
}

export async function getSchedule(date?: string): Promise<TvMazeScheduleEntry[]> {
  const dateParam = date ?? new Date().toISOString().split("T")[0]
  const cacheKey = dateParam
  
  const cached = scheduleCache.get(cacheKey)
  if (cached && isCacheValid(cached.timestamp)) {
    return cached.data
  }
  
  try {
    const url = `${TVMAZE_BASE}/schedule?date=${dateParam}`
    const res = await fetchWithTimeout(url)
    if (!res.ok) {
      throw new Error(`TVMaze schedule error: ${res.status}`)
    }
    const schedule: TvMazeScheduleEntry[] = await res.json()
    
    scheduleCache.set(cacheKey, { data: schedule, timestamp: Date.now() })
    return schedule
  } catch (err) {
    console.error(`Failed to fetch TVMaze schedule for ${dateParam}:`, err)
    return []
  }
}

// Get next episode info for a show
export async function getNextEpisode(showId: number): Promise<TvMazeEpisode | null> {
  try {
    const url = `${TVMAZE_BASE}/shows/${showId}?embed[]=nextepisode`
    const res = await fetchWithTimeout(url)
    if (!res.ok) return null
    
    const data = await res.json()
    const nextEpisode = data._embedded?.nextepisode
    return nextEpisode ?? null
  } catch (err) {
    console.error(`Failed to get next episode for show ${showId}:`, err)
    return null
  }
}

// Get upcoming episodes for a specific show
export async function getUpcomingEpisodes(showId: number): Promise<TvMazeEpisode[]> {
  try {
    const url = `${TVMAZE_BASE}/shows/${showId}/episodes`
    const res = await fetchWithTimeout(url)
    if (!res.ok) return []
    
    const episodes: TvMazeEpisode[] = await res.json()
    const now = new Date()
    
    // Filter for future episodes
    return episodes.filter(ep => {
      const airDate = new Date(ep.airstamp)
      return airDate > now
    })
  } catch (err) {
    console.error(`Failed to get episodes for show ${showId}:`, err)
    return []
  }
}

// Check if show is currently airing (has upcoming/recent episodes)
export function isCurrentlyAiring(show: TvMazeShow): boolean {
  if (show.status !== "Running") return false
  return true
}

// Get airing status label for a show
export type AiringLabel = "New Episode" | "New Episode Tomorrow" | "Currently Airing" | `Airing ${string}` | null

export function getAiringLabel(show: TvMazeShow, nextEpisode?: TvMazeEpisode): AiringLabel {
  if (!isCurrentlyAiring(show)) return null
  
  if (!nextEpisode) {
    return "Currently Airing"
  }
  
  const now = new Date()
  const airDate = new Date(nextEpisode.airstamp)
  const diffMs = airDate.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  
  if (diffDays === 0) {
    return "New Episode"
  } else if (diffDays === 1) {
    return "New Episode Tomorrow"
  } else if (diffDays > 1 && diffDays <= 7) {
    // Get day of week
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    return `Airing ${dayNames[airDate.getDay()]}`
  }
  
  return "Currently Airing"
}

export function clearScheduleCache(): void {
  scheduleCache.clear()
  showCache.clear()
}
