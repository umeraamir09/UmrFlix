import { RadarrMovie } from "./radarr"
import { SonarrSeries } from "./sonarr"
import { JellyfinItem } from "./jellyfin"

type CacheEntry<T> = { data: T; timestamp: number }

const TTL_MS = 60_000

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

// ── Radarr movies cache ──

export function setRadarrMovies(movies: RadarrMovie[]) {
  const map = new Map<number, RadarrMovie>()
  for (const m of movies) {
    map.set(m.tmdbId, m)
  }
  radarrMoviesCache.data = map
  radarrMoviesCache.timestamp = Date.now()
}

export function getRadarrMovies(): Map<number, RadarrMovie> | null {
  return isStale(radarrMoviesCache) ? null : radarrMoviesCache.data
}

export async function ensureRadarrMovies(fetchFn: () => Promise<RadarrMovie[]>): Promise<Map<number, RadarrMovie>> {
  if (isFresh(radarrMoviesCache)) return radarrMoviesCache.data
  const movies = await fetchFn()
  setRadarrMovies(movies)
  return radarrMoviesCache.data
}

export function getRadarrMovie(tmdbId: number): RadarrMovie | undefined {
  return radarrMoviesCache.data.get(tmdbId)
}

// ── Sonarr series cache ──

export function setSonarrSeries(series: SonarrSeries[]) {
  const map = new Map<number, SonarrSeries>()
  for (const s of series) {
    map.set(s.tvdbId, s)
  }
  sonarrSeriesCache.data = map
  sonarrSeriesCache.timestamp = Date.now()
}

export function getSonarrSeries(): Map<number, SonarrSeries> | null {
  return isStale(sonarrSeriesCache) ? null : sonarrSeriesCache.data
}

export async function ensureSonarrSeries(fetchFn: () => Promise<SonarrSeries[]>): Promise<Map<number, SonarrSeries>> {
  if (isFresh(sonarrSeriesCache)) return sonarrSeriesCache.data
  const series = await fetchFn()
  setSonarrSeries(series)
  return sonarrSeriesCache.data
}

export function getSonarrSeriesByTvdbId(tvdbId: number): SonarrSeries | undefined {
  return sonarrSeriesCache.data.get(tvdbId)
}

// ── TMDB → TVDB bridge cache ──

export function setTmdbToTvdbMapping(tmdbId: number, tvdbId: number) {
  tmdbToTvdbCache.data.set(tmdbId, tvdbId)
  tmdbToTvdbCache.timestamp = Date.now()
}

export function getTmdbToTvdbMapping(tmdbId: number): number | undefined {
  return tmdbToTvdbCache.data.get(tmdbId)
}

// ── Jellyfin item index cache ──
// key format: "tmdb-{id}" or "tvdb-{id}" → Jellyfin item ID

export function setJellyfinIndex(items: JellyfinItem[]) {
  const map = new Map<string, string>()
  for (const item of items) {
    const p = item.ProviderIds
    if (p?.Tmdb) map.set(`tmdb-${p.Tmdb}`, item.Id)
    if (p?.Tvdb) map.set(`tvdb-${p.Tvdb}`, item.Id)
  }
  jellyfinIndexCache.data = map
  jellyfinIndexCache.timestamp = Date.now()
}

export function getJellyfinIndex(): Map<string, string> | null {
  return isStale(jellyfinIndexCache) ? null : jellyfinIndexCache.data
}

export async function ensureJellyfinIndex(fetchFn: () => Promise<JellyfinItem[]>): Promise<Map<string, string>> {
  if (isFresh(jellyfinIndexCache)) return jellyfinIndexCache.data
  const items = await fetchFn()
  setJellyfinIndex(items)
  return jellyfinIndexCache.data
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
