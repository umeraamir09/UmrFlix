/**
 * 64-dimensional TF-IDF-style feature vectors for media items and user
 * profiles (Discovery Engine, Module 1.3).
 *
 * Layout:
 *   dims  0–19  Genres            one-hot / weighted TMDB genre ids
 *   dims 20–27  Release decades   soft gaussian-encoded era
 *   dims 28–31  Runtime buckets   <30m / 30–60m / 60–120m / >120m
 *   dims 32–47  Cast & directors  FNV-1a hashed top-billed people
 *   dims 48–63  Keywords          FNV-1a hashed TMDB plot keywords
 *
 * Pure functions only — no IO — so the module is unit-testable with tsx.
 */

export const FEATURE_DIM = 64

export const GENRE_START = 0
export const DECADE_START = 20
export const RUNTIME_START = 28
export const PEOPLE_START = 32
export const KEYWORD_START = 48

export const SHORT_TERM_HALF_LIFE_DAYS = 7
export const LONG_TERM_HALF_LIFE_DAYS = 90

export const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * TMDB genre id → one or more of the 20 genre dimensions. TV-only ids fold
 * into their canonical movie counterparts (10759 → Action & Adventure, etc.);
 * unscripted/serialized TV formats share dim 19.
 */
const GENRE_DIM_MAP: Record<number, number[]> = {
  28: [0], // Action
  10759: [0, 1], // Action & Adventure (TV)
  12: [1], // Adventure
  16: [2], // Animation
  35: [3], // Comedy
  80: [4], // Crime
  99: [5], // Documentary
  18: [6], // Drama
  10751: [7], // Family
  10762: [8], // Kids (TV)
  14: [9], // Fantasy
  36: [10], // History
  27: [11], // Horror
  10402: [12], // Music
  9648: [13], // Mystery
  10749: [14], // Romance
  878: [15], // Science Fiction
  10765: [15, 9], // Sci-Fi & Fantasy (TV)
  53: [16], // Thriller
  10752: [17], // War
  10768: [17], // War & Politics (TV)
  37: [18], // Western
  10764: [19], // Reality (TV)
  10767: [19], // Talk (TV)
  10763: [19], // News (TV)
  10766: [19], // Soap (TV)
}

/** Inverse touch-points: for each genre dimension, the TMDB genre names used for row titles. */
export const GENRE_DIM_LABELS = [
  "Action",
  "Adventure",
  "Animation",
  "Comedy",
  "Crime",
  "Documentary",
  "Drama",
  "Family",
  "Kids",
  "Fantasy",
  "History",
  "Horror",
  "Music",
  "Mystery",
  "Romance",
  "Sci-Fi",
  "Thriller",
  "War",
  "Western",
  "Reality & Talk",
] as const

/** Decade bucket centers (dims 20–27): <1970s … Latest. */
const DECADE_CENTERS = [1960, 1975, 1985, 1995, 2005, 2015, 2022] as const
export const DECADE_LABELS = [
  "Classic Era",
  "70s",
  "80s",
  "90s",
  "2000s",
  "2010s",
  "2020s",
  "Latest Releases",
] as const
const DECADE_SIGMA_YEARS = 4

/** FNV-1a 32-bit hash — stable across processes so Convex-cached vectors match. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function zeroVector(): number[] {
  return new Array(FEATURE_DIM).fill(0)
}

export function l2Normalize(vec: number[]): number[] {
  let sum = 0
  for (const v of vec) sum += v * v
  const norm = Math.sqrt(sum)
  if (norm === 0) return vec.slice()
  return vec.map((v) => v / norm)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Half-life exponential decay kernel: D(Δt) = exp(-ln2 / t½ · Δt_days). */
export function temporalDecay(halfLifeDays: number, deltaMs: number): number {
  const deltaDays = Math.max(0, deltaMs) / MS_PER_DAY
  return Math.exp((-Math.LN2 / halfLifeDays) * deltaDays)
}

const ALPHA_SHORT = 0.6

/**
 * Weighted composite of short-term and long-term vectors (Module 1.2):
 * α = 0.6 fixed blend of short and long profiles.
 */
export function blendUserVectors(
  shortTerm: number[],
  longTerm: number[],
): number[] {
  const s = l2Normalize(shortTerm)
  const l = l2Normalize(longTerm)
  const blended = zeroVector()
  for (let i = 0; i < FEATURE_DIM; i++) {
    blended[i] = ALPHA_SHORT * s[i] + (1 - ALPHA_SHORT) * l[i]
  }
  return blended
}

export type ItemFeatureInput = {
  tmdbId: number
  mediaType: "movie" | "tv"
  genreIds: number[]
  releaseYear?: number | null
  runtimeMinutes?: number | null
  /** Top-billed cast in billing order (strongest first) plus directors. */
  castNames?: string[]
  directorNames?: string[]
  keywordNames?: string[]
}

/**
 * Build a normalized 64-D item vector. Fields that were not fetched (e.g.
 * credits for bulk candidates) simply leave their slice sparse — cosine
 * similarity stays well-defined.
 */
export function buildItemVector(input: ItemFeatureInput): number[] {
  const vec = zeroVector()

  // Genres (0–19): TF-IDF-ish weighting — primary (first) genre weighs more.
  input.genreIds.forEach((genreId, index) => {
    const dims = GENRE_DIM_MAP[genreId]
    if (!dims) return
    const w = index === 0 ? 1 : 0.7
    for (const d of dims) vec[GENRE_START + d] = Math.max(vec[GENRE_START + d], w)
  })

  // Release era (20–27): gaussian soft-encoding around decade centers.
  if (input.releaseYear && Number.isFinite(input.releaseYear)) {
    const currentYear = new Date().getFullYear()
    const centers = [...DECADE_CENTERS, currentYear]
    let norm = 0
    const weights = centers.map((center, index) => {
      // Classic era (center 0) covers all years <= 1960 without decaying for older classics
      const year = index === 0 && input.releaseYear! < 1960 ? 1960 : input.releaseYear!
      const d = year - center
      const w = Math.exp(-(d * d) / (2 * DECADE_SIGMA_YEARS * DECADE_SIGMA_YEARS))
      norm += w * w
      return w
    })
    norm = Math.sqrt(norm) || 1
    weights.forEach((w, i) => {
      vec[DECADE_START + i] = w / norm
    })
  }

  // Runtime buckets (28–31). Unknown runtimes fall back to sensible defaults.
  const runtime = input.runtimeMinutes ?? (input.mediaType === "movie" ? 100 : 45)
  const bucket = runtime < 30 ? 0 : runtime < 60 ? 1 : runtime <= 120 ? 2 : 3
  vec[RUNTIME_START + bucket] = 1

  // Cast & directors (32–47): hashed with billing-order decay.
  input.castNames?.slice(0, 8).forEach((name, order) => {
    const dim = PEOPLE_START + (fnv1a(name.trim().toLowerCase()) % 16)
    vec[dim] = Math.max(vec[dim], 1 / (1 + order))
  })
  input.directorNames?.slice(0, 3).forEach((name) => {
    const dim = PEOPLE_START + (fnv1a(`dir:${name.trim().toLowerCase()}`) % 16)
    vec[dim] = Math.max(vec[dim], 1)
  })

  // Keywords & micro-tags (48–63).
  input.keywordNames?.slice(0, 20).forEach((name) => {
    const dim = KEYWORD_START + (fnv1a(name.trim().toLowerCase()) % 16)
    vec[dim] = Math.max(vec[dim], 0.9)
  })

  return l2Normalize(vec)
}

/**
 * Dominant feature extraction for row synthesis: returns the strongest genre
 * dimension and strongest decade bucket of a user vector, if any signal is
 * present at all.
 */
export function dominantFeatures(vec: number[]): {
  genreDim: number | null
  decadeBucket: number | null
} {
  let genreDim: number | null = null
  let genreMax = 0.15 // ignore negligible tails
  for (let d = 0; d < 20; d++) {
    if (vec[GENRE_START + d] > genreMax) {
      genreMax = vec[GENRE_START + d]
      genreDim = d
    }
  }

  let decadeBucket: number | null = null
  let decadeMax = 0.3
  for (let d = 0; d < 8; d++) {
    if (vec[DECADE_START + d] > decadeMax) {
      decadeMax = vec[DECADE_START + d]
      decadeBucket = d
    }
  }

  return { genreDim, decadeBucket }
}

/** Map a genre dimension back to TMDB discover ids (movie / tv). */
export const GENRE_DIM_TO_TMDB: Record<number, { movie: number[]; tv: number[] }> = {
  0: { movie: [28], tv: [10759] },
  1: { movie: [12], tv: [10759] },
  2: { movie: [16], tv: [16] },
  3: { movie: [35], tv: [35] },
  4: { movie: [80], tv: [80] },
  5: { movie: [99], tv: [99] },
  6: { movie: [18], tv: [18] },
  7: { movie: [10751], tv: [10751] },
  8: { movie: [16], tv: [10762] },
  9: { movie: [14], tv: [10765] },
  10: { movie: [36], tv: [] },
  11: { movie: [27], tv: [] },
  12: { movie: [10402], tv: [] },
  13: { movie: [9648], tv: [9648] },
  14: { movie: [10749], tv: [] },
  15: { movie: [878], tv: [10765] },
  16: { movie: [53], tv: [80] },
  17: { movie: [10752], tv: [10768] },
  18: { movie: [37], tv: [37] },
  19: { movie: [], tv: [10764] },
}

/** Decade bucket → release year range (for TMDB discover filters). */
export function decadeBucketToYearRange(bucket: number): { gte: number; lte: number } | null {
  const currentYear = new Date().getFullYear()
  switch (bucket) {
    case 0: return { gte: 1930, lte: 1969 }
    case 1: return { gte: 1970, lte: 1979 }
    case 2: return { gte: 1980, lte: 1989 }
    case 3: return { gte: 1990, lte: 1999 }
    case 4: return { gte: 2000, lte: 2009 }
    case 5: return { gte: 2010, lte: 2019 }
    case 6: return { gte: 2020, lte: currentYear }
    case 7: return { gte: currentYear - 2, lte: currentYear }
    default: return null
  }
}
