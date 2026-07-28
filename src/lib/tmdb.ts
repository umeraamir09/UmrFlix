import { env } from "./env"

const BASE = env("TMDB_API_BASE")
const KEY = env("TMDB_API_KEY")

export async function tmdbFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set("api_key", KEY)
  url.searchParams.set("language", "en-US")
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  const res = await fetch(url.toString())
  if (!res.ok) {
    throw new Error(`TMDB API error: ${res.status} ${res.statusText}`)
  }
  return res.json()
}

export type TmdbMovie = {
  id: number
  title: string
  poster_path: string | null
  backdrop_path: string | null
  overview: string
  release_date: string
  vote_average: number
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
  genre_ids: number[]
  media_type?: string
}

export type TmdbPaginated<T> = {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

export type TmdbMovieDetail = TmdbMovie & {
  genres: { id: number; name: string }[]
  credits: { cast: { id: number; name: string; character: string; profile_path: string | null }[] }
  videos: { results: { key: string; site: string; type: string }[] }
  runtime: number
  status: string
}

export type TmdbTvDetail = TmdbTvShow & {
  genres: { id: number; name: string }[]
  credits: { cast: { id: number; name: string; character: string; profile_path: string | null }[] }
  videos: { results: { key: string; site: string; type: string }[] }
  external_ids: { tvdb_id: number | null; imdb_id: string | null }
  seasons: { id: number; season_number: number; episode_count: number; name: string }[]
  status: string
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
  return tmdbFetch<TmdbMovieDetail>(`/movie/${id}`, { append_to_response: "credits,videos" })
}

export function tvDetail(id: number) {
  return tmdbFetch<TmdbTvDetail>(`/tv/${id}`, { append_to_response: "credits,videos,external_ids" })
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
