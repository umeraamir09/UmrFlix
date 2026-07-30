import { RadarrMovie } from "./radarr"
import { SonarrSeries } from "./sonarr"
import { JellyfinItem } from "./jellyfin"
import { SingleFlight } from "./circuit-breaker"
import { ConvexHttpClient } from "convex/browser"
import type { FunctionReference } from "convex/server"

type CacheEntry<T> = { data: T; timestamp: number }

const TTL_MS = 60_000

// L1 In-Memory Caches
const radarrMoviesCache: CacheEntry<Map<number, RadarrMovie>> = { data: new Map(), timestamp: 0 }
const sonarrSeriesCache: CacheEntry<Map<number, SonarrSeries>> = { data: new Map(), timestamp: 0 }
const tmdbToTvdbCache: CacheEntry<Map<number, number>> = { data: new Map(), timestamp: 0 }
const jellyfinIndexCache: CacheEntry<Map<string, string>> = { data: new Map(), timestamp: 0 }

function isFresh(entry: CacheEntry<unknown>): boolean {
  return Date.now() - entry.timestamp < TTL_MS
}

function isStale(entry: CacheEntry<unknown>): boolean {
  return !isFresh(entry)
}

type QueryRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"query", "public", Args, Ret>
type MutationRef<Args extends Record<string, unknown>, Ret> = FunctionReference<"mutation", "public", Args, Ret>

const getCacheEntryRef = "cache:getCacheEntry" as unknown as QueryRef<{ key: string }, { dataJson: string; updatedAt: number } | null>
const setCacheEntryRef = "cache:setCacheEntry" as unknown as MutationRef<{ key: string; dataJson: string }, string>
const getTmdbToTvdbRef = "cache:getTmdbToTvdb" as unknown as QueryRef<{ tmdbId: number }, number | null>
const setTmdbToTvdbRef = "cache:setTmdbToTvdb" as unknown as MutationRef<{ tmdbId: number; tvdbId: number }, string>

function getConvexClient(): ConvexHttpClient | null {
  const url =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL
  const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY

  if (!url) return null

  try {
    const client = new ConvexHttpClient(url, {
      skipConvexDeploymentUrlCheck: true,
    })
    if (adminKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawClient = client as any
      if (typeof rawClient.setAdminAuth === "function") {
        rawClient.setAdminAuth(adminKey)
      } else {
        client.setAuth(adminKey)
      }
    }
    return client
  } catch {
    return null
  }
}

// ── Radarr movies cache (L1 + L2 + L3) ──

export function setRadarrMovies(movies: RadarrMovie[]) {
  const map = new Map<number, RadarrMovie>()
  for (const m of movies) {
    map.set(m.tmdbId, m)
  }
  radarrMoviesCache.data = map
  radarrMoviesCache.timestamp = Date.now()

  // Save to Convex L2 in background
  const convex = getConvexClient()
  if (convex) {
    try {
      const dataJson = JSON.stringify(movies)
      convex.mutation(setCacheEntryRef, { key: "radarr_movies", dataJson }).catch(() => {})
    } catch {
      /* ignore background L2 error */
    }
  }
}

export function getRadarrMovies(): Map<number, RadarrMovie> | null {
  return isStale(radarrMoviesCache) ? null : radarrMoviesCache.data
}

export async function ensureRadarrMovies(fetchFn: () => Promise<RadarrMovie[]>): Promise<Map<number, RadarrMovie>> {
  if (isFresh(radarrMoviesCache)) return radarrMoviesCache.data

  return SingleFlight.execute("ensureRadarrMovies", async () => {
    // Try L2 Convex store first if fresh
    const convex = getConvexClient()
    if (convex && isStale(radarrMoviesCache)) {
      try {
        const entry = await convex.query(getCacheEntryRef, { key: "radarr_movies" })
        if (entry && Date.now() - entry.updatedAt < TTL_MS) {
          const movies: RadarrMovie[] = JSON.parse(entry.dataJson)
          const map = new Map<number, RadarrMovie>()
          for (const m of movies) map.set(m.tmdbId, m)
          radarrMoviesCache.data = map
          radarrMoviesCache.timestamp = entry.updatedAt
          return radarrMoviesCache.data
        }
      } catch {
        /* fallback to L3 */
      }
    }

    // L3 Upstream Origin fetch
    const movies = await fetchFn()
    setRadarrMovies(movies)
    return radarrMoviesCache.data
  })
}

export function getRadarrMovie(tmdbId: number): RadarrMovie | undefined {
  return radarrMoviesCache.data.get(tmdbId)
}

// ── Sonarr series cache (L1 + L2 + L3) ──

export function setSonarrSeries(series: SonarrSeries[]) {
  const map = new Map<number, SonarrSeries>()
  for (const s of series) {
    map.set(s.tvdbId, s)
  }
  sonarrSeriesCache.data = map
  sonarrSeriesCache.timestamp = Date.now()

  const convex = getConvexClient()
  if (convex) {
    try {
      const dataJson = JSON.stringify(series)
      convex.mutation(setCacheEntryRef, { key: "sonarr_series", dataJson }).catch(() => {})
    } catch {
      /* ignore background L2 error */
    }
  }
}

export function getSonarrSeries(): Map<number, SonarrSeries> | null {
  return isStale(sonarrSeriesCache) ? null : sonarrSeriesCache.data
}

export async function ensureSonarrSeries(fetchFn: () => Promise<SonarrSeries[]>): Promise<Map<number, SonarrSeries>> {
  if (isFresh(sonarrSeriesCache)) return sonarrSeriesCache.data

  return SingleFlight.execute("ensureSonarrSeries", async () => {
    const convex = getConvexClient()
    if (convex && isStale(sonarrSeriesCache)) {
      try {
        const entry = await convex.query(getCacheEntryRef, { key: "sonarr_series" })
        if (entry && Date.now() - entry.updatedAt < TTL_MS) {
          const series: SonarrSeries[] = JSON.parse(entry.dataJson)
          const map = new Map<number, SonarrSeries>()
          for (const s of series) map.set(s.tvdbId, s)
          sonarrSeriesCache.data = map
          sonarrSeriesCache.timestamp = entry.updatedAt
          return sonarrSeriesCache.data
        }
      } catch {
        /* fallback to L3 */
      }
    }

    const series = await fetchFn()
    setSonarrSeries(series)
    return sonarrSeriesCache.data
  })
}

export function getSonarrSeriesByTvdbId(tvdbId: number): SonarrSeries | undefined {
  return sonarrSeriesCache.data.get(tvdbId)
}

// ── TMDB → TVDB bridge cache ──

export function setTmdbToTvdbMapping(tmdbId: number, tvdbId: number) {
  tmdbToTvdbCache.data.set(tmdbId, tvdbId)
  tmdbToTvdbCache.timestamp = Date.now()

  const convex = getConvexClient()
  if (convex) {
    try {
      convex.mutation(setTmdbToTvdbRef, { tmdbId, tvdbId }).catch(() => {})
    } catch {
      /* ignore background L2 error */
    }
  }
}

export function getTmdbToTvdbMapping(tmdbId: number): number | undefined {
  const cachedL1 = tmdbToTvdbCache.data.get(tmdbId)
  if (cachedL1 !== undefined) return cachedL1

  return undefined
}

export async function fetchTmdbToTvdbMappingL2(tmdbId: number): Promise<number | null> {
  const cachedL1 = tmdbToTvdbCache.data.get(tmdbId)
  if (cachedL1 !== undefined) return cachedL1

  const convex = getConvexClient()
  if (convex) {
    try {
      const tvdbId = await convex.query(getTmdbToTvdbRef, { tmdbId })
      if (tvdbId !== null) {
        tmdbToTvdbCache.data.set(tmdbId, tvdbId)
        return tvdbId
      }
    } catch {
      /* miss */
    }
  }

  return null
}

// ── Jellyfin item index cache ──

export function setJellyfinIndex(items: JellyfinItem[]) {
  const map = new Map<string, string>()
  for (const item of items) {
    const p = item.ProviderIds
    if (p?.Tmdb) map.set(`tmdb-${p.Tmdb}`, item.Id)
    if (p?.Tvdb) map.set(`tvdb-${p.Tvdb}`, item.Id)
  }
  jellyfinIndexCache.data = map
  jellyfinIndexCache.timestamp = Date.now()

  const convex = getConvexClient()
  if (convex) {
    try {
      const dataJson = JSON.stringify(Array.from(map.entries()))
      convex.mutation(setCacheEntryRef, { key: "jellyfin_index", dataJson }).catch(() => {})
    } catch {
      /* ignore background L2 error */
    }
  }
}

export function getJellyfinIndex(): Map<string, string> | null {
  return isStale(jellyfinIndexCache) ? null : jellyfinIndexCache.data
}

export async function ensureJellyfinIndex(fetchFn: () => Promise<JellyfinItem[]>): Promise<Map<string, string>> {
  if (isFresh(jellyfinIndexCache)) return jellyfinIndexCache.data

  return SingleFlight.execute("ensureJellyfinIndex", async () => {
    const convex = getConvexClient()
    if (convex && isStale(jellyfinIndexCache)) {
      try {
        const entry = await convex.query(getCacheEntryRef, { key: "jellyfin_index" })
        if (entry && Date.now() - entry.updatedAt < TTL_MS) {
          const entries: [string, string][] = JSON.parse(entry.dataJson)
          jellyfinIndexCache.data = new Map(entries)
          jellyfinIndexCache.timestamp = entry.updatedAt
          return jellyfinIndexCache.data
        }
      } catch {
        /* fallback to L3 */
      }
    }

    const items = await fetchFn()
    setJellyfinIndex(items)
    return jellyfinIndexCache.data
  })
}

export function getJellyfinItemId(providerKey: string): string | undefined {
  return jellyfinIndexCache.data.get(providerKey)
}

// ── Invalidation ──

export function invalidateAll() {
  radarrMoviesCache.timestamp = 0
  sonarrSeriesCache.timestamp = 0
  tmdbToTvdbCache.timestamp = 0
  jellyfinIndexCache.timestamp = 0
}
