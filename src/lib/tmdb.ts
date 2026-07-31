import { tmdbProxyFetch } from "./tmdb-proxy"
import { tmdbBreaker } from "./circuit-breaker"

export async function tmdbFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const search = new URLSearchParams()
  search.set("language", "en-US")
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      search.set(k, v)
    }
  }
  const res = await tmdbProxyFetch(`/3${path}?${search.toString()}`, {
    breaker: tmdbBreaker,
    timeoutMs: 6_000,
    retries: 1,
  })
  if (!res.ok) {
    throw new Error(`TMDB proxy responded with ${res.status}`)
  }
  return (await res.json()) as T
}


export type TmdbMovie = {
  id: number
  title: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date: string
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids: number[]
  media_type?: string
}

export type TmdbTvShow = {
  id: number
  name: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  first_air_date: string
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids: number[]
  media_type?: string
}

export type TmdbPaginated<T> = {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

export type TmdbCastMember = {
  id: number
  name: string
  character: string
  profile_path: string | null
}

export type TmdbCrewMember = {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

export type TmdbMovieDetail = TmdbMovie & {
  genres: { id: number; name: string }[]
  credits: {
    cast: TmdbCastMember[]
    crew: TmdbCrewMember[]
  }
  videos: { results: { key: string; site: string; type: string }[] }
  images?: { logos?: { file_path: string; iso_639_1: string }[] }
  recommendations?: TmdbPaginated<TmdbMovie>
  similar?: TmdbPaginated<TmdbMovie>
  runtime: number
  status: string
  tagline?: string
  budget?: number
  revenue?: number
  spoken_languages?: { english_name: string; name: string }[]
  production_companies?: { id: number; name: string; logo_path: string | null }[]
}

export type TmdbTvSeasonSummary = {
  id: number
  season_number: number
  episode_count: number
  name: string
  poster_path: string | null
  overview: string
}

export type TmdbTvDetail = TmdbTvShow & {
  genres: { id: number; name: string }[]
  credits: {
    cast: TmdbCastMember[]
    crew: TmdbCrewMember[]
  }
  created_by?: { id: number; name: string; profile_path: string | null }[]
  videos: { results: { key: string; site: string; type: string }[] }
  images?: { logos?: { file_path: string; iso_639_1: string }[] }
  recommendations?: TmdbPaginated<TmdbTvShow>
  similar?: TmdbPaginated<TmdbTvShow>
  external_ids: { tvdb_id: number | null; imdb_id: string | null }
  seasons: TmdbTvSeasonSummary[]
  status: string
  tagline?: string
  number_of_episodes?: number
  number_of_seasons?: number
  spoken_languages?: { english_name: string; name: string }[]
  networks?: { id: number; name: string; logo_path: string | null }[]
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] }
}

export type TmdbEpisode = {
  id: number
  name: string
  overview: string
  episode_number: number
  season_number: number
  air_date: string | null
  runtime: number | null
  still_path: string | null
  vote_average: number
  vote_count: number
}

export type TmdbSeasonDetail = {
  id: number
  name: string
  overview: string
  season_number: number
  poster_path: string | null
  episodes: TmdbEpisode[]
}

export function trending(type: "movie" | "tv", time: "day" | "week" = "week") {
  return tmdbFetch<TmdbPaginated<TmdbMovie | TmdbTvShow>>(`/trending/${type}/${time}`)
}

export const getTrending = trending

export function searchMovies(query: string, page = 1) {
  return tmdbFetch<TmdbPaginated<TmdbMovie>>("/search/movie", { query, page: String(page) })
}

export function searchTv(query: string, page = 1) {
  return tmdbFetch<TmdbPaginated<TmdbTvShow>>("/search/tv", { query, page: String(page) })
}

export function movieDetail(id: number) {
  return tmdbFetch<TmdbMovieDetail>(`/movie/${id}`, {
    append_to_response: "credits,videos,images,recommendations,similar",
    include_image_language: "en,null",
  })
}

export function tvDetail(id: number) {
  return tmdbFetch<TmdbTvDetail>(`/tv/${id}`, {
    append_to_response: "credits,videos,images,recommendations,similar,external_ids,content_ratings",
    include_image_language: "en,null",
  })
}

export function tvSeasonDetail(id: number, seasonNumber: number) {
  return tmdbFetch<TmdbSeasonDetail>(`/tv/${id}/season/${seasonNumber}`)
}

export function discoverMovies(params?: Record<string, string>) {
  return tmdbFetch<TmdbPaginated<TmdbMovie>>("/discover/movie", params)
}

export function discoverTv(params?: Record<string, string>) {
  return tmdbFetch<TmdbPaginated<TmdbTvShow>>("/discover/tv", params)
}

export async function getItemLogo(type: "movie" | "tv", id: number): Promise<string | null> {
  try {
    const res = await tmdbFetch<{ logos?: { file_path: string; iso_639_1: string }[] }>(
      `/${type}/${id}/images`,
      { include_image_language: "en,null" }
    )
    if (res.logos && res.logos.length > 0) {
      const enLogo = res.logos.find((l) => l.iso_639_1 === "en") || res.logos[0]
      return enLogo?.file_path ? `https://image.tmdb.org/t/p/w500${enLogo.file_path}` : null
    }
  } catch (err) {
    console.error(`Failed to fetch logo for ${type} ${id}:`, err)
  }
  return null
}

