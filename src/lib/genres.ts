/**
 * Canonical genre registry.
 *
 * Single source of truth for every genre surfaced across the app (Navbar
 * categories, /search?genre= browse mode, /movie and /tvshows genre filters,
 * and the upcoming dedicated /genre/[slug] pages). Movies and TV have separate
 * TMDB genre ids for overlapping categories, so each GenreDef carries both
 * lists plus the display metadata needed for page blurbs and <meta> tags.
 */

export type GenreDef = {
  slug: string
  name: string
  description: string
  movieGenreIds: number[]
  tvGenreIds: number[]
  aliases?: string[]
}

export const GENRES: GenreDef[] = [
  {
    slug: "action",
    name: "Action",
    description: "High-octane thrills, explosive set pieces, and pulse-pounding heroics.",
    movieGenreIds: [28],
    tvGenreIds: [10759],
    aliases: ["Action & Adventure"],
  },
  {
    slug: "adventure",
    name: "Adventure",
    description: "Epic quests, daring explorers, and journeys into the unknown.",
    movieGenreIds: [12],
    tvGenreIds: [],
  },
  {
    slug: "animation",
    name: "Animation",
    description: "Animated movies and series for every age, from hand-drawn classics to modern CGI.",
    movieGenreIds: [16],
    tvGenreIds: [16],
  },
  {
    slug: "comedy",
    name: "Comedy",
    description: "Laugh-out-loud comedies and feel-good stories to brighten your day.",
    movieGenreIds: [35],
    tvGenreIds: [35],
  },
  {
    slug: "crime",
    name: "Crime",
    description: "Heists, detectives, and the criminal underworld.",
    movieGenreIds: [80],
    tvGenreIds: [80],
  },
  {
    slug: "documentary",
    name: "Documentary",
    description: "Real stories, true crime, and eye-opening non-fiction.",
    movieGenreIds: [99],
    tvGenreIds: [99],
  },
  {
    slug: "drama",
    name: "Drama",
    description: "Emotional, character-driven stories that stay with you.",
    movieGenreIds: [18],
    tvGenreIds: [18],
  },
  {
    slug: "family",
    name: "Family",
    description: "Wholesome entertainment the whole family can enjoy together.",
    movieGenreIds: [10751],
    tvGenreIds: [10751],
  },
  {
    slug: "fantasy",
    name: "Fantasy",
    description: "Magic, mythical worlds, and impossible adventures.",
    movieGenreIds: [14],
    tvGenreIds: [10765],
  },
  {
    slug: "horror",
    name: "Horror",
    description: "Pulse-pounding chills and spine-tingling scares.",
    movieGenreIds: [27],
    tvGenreIds: [],
  },
  {
    slug: "kids",
    name: "Kids",
    description: "Fun, age-appropriate shows and movies for younger viewers.",
    movieGenreIds: [],
    tvGenreIds: [10762],
  },
  {
    slug: "music",
    name: "Music",
    description: "Musicals, concert films, and stories where music takes center stage.",
    movieGenreIds: [10402],
    tvGenreIds: [],
  },
  {
    slug: "mystery",
    name: "Mystery",
    description: "Whodunits, puzzles, and secrets waiting to be unraveled.",
    movieGenreIds: [9648],
    tvGenreIds: [9648],
  },
  {
    slug: "news",
    name: "News",
    description: "Current events, journalism, and live news coverage.",
    movieGenreIds: [],
    tvGenreIds: [10763],
  },
  {
    slug: "reality",
    name: "Reality",
    description: "Unscripted series, competitions, and real-life drama.",
    movieGenreIds: [],
    tvGenreIds: [10764],
  },
  {
    slug: "romance",
    name: "Romance",
    description: "Love stories, heartfelt connections, and swoon-worthy moments.",
    movieGenreIds: [10749],
    tvGenreIds: [],
  },
  {
    slug: "sci-fi",
    name: "Sci-Fi",
    description: "Future worlds, alien encounters, and mind-bending science.",
    movieGenreIds: [878],
    tvGenreIds: [10765],
    aliases: ["Science Fiction"],
  },
  {
    slug: "sci-fi-fantasy",
    name: "Sci-Fi & Fantasy",
    description: "Alien worlds, future realms, and epic magic combined.",
    movieGenreIds: [878, 14],
    tvGenreIds: [10765],
  },
  {
    slug: "soap",
    name: "Soap",
    description: "Serialized dramas and everyday sagas.",
    movieGenreIds: [],
    tvGenreIds: [10766],
  },
  {
    slug: "talk",
    name: "Talk",
    description: "Interviews, chat shows, and late-night conversations.",
    movieGenreIds: [],
    tvGenreIds: [10767],
  },
  {
    slug: "thriller",
    name: "Thriller",
    description: "Suspenseful cat-and-mouse games and edge-of-your-seat tension.",
    movieGenreIds: [53],
    tvGenreIds: [],
  },
  {
    slug: "war",
    name: "War",
    description: "Battleground epics and the human stories behind conflict.",
    movieGenreIds: [10752],
    tvGenreIds: [10768],
    aliases: ["War & Politics"],
  },
  {
    slug: "western",
    name: "Western",
    description: "Cowboys, frontier justice, and the open range.",
    movieGenreIds: [37],
    tvGenreIds: [37],
  },
]

export type GenreCatalogItem = {
  slug: string
  name: string
}

export const GENRE_CATALOG: GenreCatalogItem[] = GENRES.map((genre) => ({
  slug: genre.slug,
  name: genre.name,
}))

export function getAllGenres(): GenreDef[] {
  return GENRES
}

export function getGenreBySlug(slug: string): GenreDef | undefined {
  const normalized = slug.trim().toLowerCase()
  return GENRES.find((genre) => genre.slug.toLowerCase() === normalized)
}

export function getGenreByParam(param: string): GenreDef | undefined {
  const trimmed = param.trim()
  if (!trimmed) return undefined

  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed)
    return GENRES.find(
      (genre) => genre.movieGenreIds.includes(id) || genre.tvGenreIds.includes(id)
    )
  }

  const normalized = trimmed.toLowerCase()
  return GENRES.find(
    (genre) =>
      genre.slug.toLowerCase() === normalized ||
      genre.name.toLowerCase() === normalized ||
      genre.aliases?.some((alias) => alias.toLowerCase() === normalized)
  )
}

export function getGenreIdsForMediaType(
  genre: GenreDef,
  mediaType: "movie" | "tv"
): number[] {
  return mediaType === "tv" ? genre.tvGenreIds : genre.movieGenreIds
}

export type GenreFilterItem = {
  name: string
  id?: number
  slug?: string
}

// Use the genre slug (unique per pill) rather than the first TMDB id. Ids
// overlap between genres (e.g. "Sci-Fi" 878 and "Sci-Fi & Fantasy" 878,14),
// which made the two pills carry an identical id and filter ambiguously.
export function getMovieGenres(): GenreFilterItem[] {
  return GENRES.filter((genre) => genre.movieGenreIds.length > 0).map((genre) => ({
    name: genre.name,
    slug: genre.slug,
  }))
}

export function getTvGenres(): GenreFilterItem[] {
  return GENRES.filter((genre) => genre.tvGenreIds.length > 0).map((genre) => ({
    name: genre.name,
    slug: genre.slug,
  }))
}
