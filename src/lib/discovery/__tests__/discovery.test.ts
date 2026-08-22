import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
  FEATURE_DIM,
  buildItemVector,
  cosineSimilarity,
  temporalDecay,
  blendUserVectors,
  l2Normalize,
  dominantFeatures,
  padToFeatureDim,
  GENRE_DIM_TO_TMDB,
  joinGenreIds,
  SHORT_TERM_HALF_LIFE_DAYS,
  MS_PER_DAY,
  zeroVector,
} from "../vector"
import { classifyPlaybackStop, computeRewatchWeight, pickBestSearchMatch } from "../ingest"
import {
  scoreItem,
  serveDemotion,
  fatiguePenalty,
  isRowSuppressed,
  rankRowsMMR,
  explorationBonus,
  FATIGUE_SUPPRESS_THRESHOLD,
  type RankableRow,
} from "../ranking"

// ── Vector construction (Module 1.3, 128-D per R2-3) ──

describe("buildItemVector", () => {
  test("produces a 128-D unit vector", () => {
    const v = buildItemVector({
      tmdbId: 550,
      mediaType: "movie",
      genreIds: [18, 53],
      releaseYear: 1999,
      runtimeMinutes: 139,
      castNames: ["Brad Pitt", "Edward Norton"],
      directorNames: ["David Fincher"],
      keywordNames: ["underground fighting"],
    })
    assert.equal(v.length, FEATURE_DIM)
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
    assert.ok(Math.abs(norm - 1) < 1e-9, `expected unit norm, got ${norm}`)
  })

  test("primary genre lands in the mapped dimension", () => {
    const v = buildItemVector({
      tmdbId: 1,
      mediaType: "movie",
      genreIds: [878], // Science Fiction → dim 15
      releaseYear: 2015,
      runtimeMinutes: 120,
    })
    assert.ok(v[15] > 0, "sci-fi dim should be populated")
    assert.equal(v[16], 0, "thriller dim should be empty")
  })

  test("TV-only genre ids fold into canonical dimensions", () => {
    const v = buildItemVector({
      tmdbId: 2,
      mediaType: "tv",
      genreIds: [10765], // Sci-Fi & Fantasy (TV) → dims 15 (sci-fi) + 9 (fantasy)
      releaseYear: 2020,
      runtimeMinutes: 45,
    })
    assert.ok(v[15] > 0)
    assert.ok(v[9] > 0)
  })

  test("runtime bucket is one-hot (within the slice, pre-normalization)", () => {
    const v = buildItemVector({ tmdbId: 3, mediaType: "movie", genreIds: [], releaseYear: 2000, runtimeMinutes: 25 })
    assert.ok(v[28] > 0, "short bucket populated")
    assert.equal(v[29] + v[30] + v[31], 0)
  })

  test("unknown runtime spreads bucket mass neutrally (R2-1/§4.1)", () => {
    const v = buildItemVector({ tmdbId: 4, mediaType: "movie", genreIds: [28], releaseYear: 2020 })
    // All four runtime buckets carry equal mass pre-normalization.
    assert.ok(Math.abs(v[28] - v[29]) < 1e-9)
    assert.ok(Math.abs(v[29] - v[30]) < 1e-9)
    assert.ok(Math.abs(v[30] - v[31]) < 1e-9)
  })

  test("identical inputs hash to identical vectors (stable hashing)", () => {
    const input = {
      tmdbId: 7,
      mediaType: "movie" as const,
      genreIds: [27],
      releaseYear: 1978,
      runtimeMinutes: 91,
      castNames: ["Donald Pleasence", "Jamie Lee Curtis"],
      directorNames: ["John Carpenter"],
    }
    assert.deepEqual(buildItemVector(input), buildItemVector(input))
  })

  test("distinct people collide less than in the legacy 16-bucket space", () => {
    const a = buildItemVector({ tmdbId: 8, mediaType: "movie", genreIds: [], releaseYear: 2000, castNames: ["Alpha Actor"] })
    const b = buildItemVector({ tmdbId: 9, mediaType: "movie", genreIds: [], releaseYear: 2000, castNames: ["Beta Actor"] })
    const overlaps = [32, 33, 34, 35, 36, 37, 38, 39].filter((d) => a[d] > 0 && b[d] > 0)
    assert.equal(overlaps.length, 0)
  })
})

describe("padToFeatureDim", () => {
  test("pads legacy 64-D vectors with zeros and repairs holes", () => {
    const legacy = new Array(64).fill(0.1)
    legacy[3] = Number.NaN
    const padded = padToFeatureDim(legacy)
    assert.equal(padded.length, FEATURE_DIM)
    assert.equal(padded[3], 0, "NaN repaired to zero")
    assert.equal(padded[70], 0, "tail padded with zeros")
    assert.equal(padToFeatureDim(zeroVector()).length, FEATURE_DIM)
  })
})

describe("GENRE_DIM_TO_TMDB (R0-5/§1.5)", () => {
  test("TV Thriller maps to Crime|Mystery pipe-OR, not the old Crime-only mis-map", () => {
    assert.deepEqual(GENRE_DIM_TO_TMDB[16].tv, [80, 9648])
    assert.equal(joinGenreIds(GENRE_DIM_TO_TMDB[16].tv), "80|9648")
  })

  test("dims without a TV genre id stay empty so row builders skip them", () => {
    for (const dim of [10, 11, 12, 14]) {
      assert.deepEqual(GENRE_DIM_TO_TMDB[dim].tv, [], `dim ${dim} has no TV mapping`)
    }
  })

  test("Reality & Talk is TV-only and covers all unscripted formats", () => {
    assert.deepEqual(GENRE_DIM_TO_TMDB[19].movie, [])
    assert.deepEqual(GENRE_DIM_TO_TMDB[19].tv, [10764, 10766, 10767, 10763])
  })

  test("joinGenreIds uses pipe (OR) semantics", () => {
    assert.equal(joinGenreIds([28, 12]), "28|12")
    assert.equal(joinGenreIds([35]), "35")
  })
})

describe("cosineSimilarity", () => {
  test("identical vectors → 1; orthogonal → 0; zero vector → 0", () => {
    const a = l2Normalize([1, 0, 0])
    assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9)
    assert.equal(cosineSimilarity([1, 0], [0, 1]), 0)
    assert.equal(cosineSimilarity(zeroVector(), a), 0)
  })
})

describe("temporalDecay", () => {
  test("half a weight remains after one half-life", () => {
    const d = temporalDecay(SHORT_TERM_HALF_LIFE_DAYS, SHORT_TERM_HALF_LIFE_DAYS * MS_PER_DAY)
    assert.ok(Math.abs(d - 0.5) < 1e-9)
  })

  test("quarter weight after two half-lives; no decay at t=0", () => {
    const d = temporalDecay(90, 180 * MS_PER_DAY)
    assert.ok(Math.abs(d - 0.25) < 1e-9)
    assert.equal(temporalDecay(7, 0), 1)
  })
})

describe("blendUserVectors", () => {
  test("weights the short-term vector with fixed α=0.6", () => {
    const short = l2Normalize([1, 0, 0])
    const long = l2Normalize([0, 1, 0])
    const blended = blendUserVectors(short, long)
    assert.ok(Math.abs(blended[0] - 0.6) < 1e-9)
    assert.ok(Math.abs(blended[1] - 0.4) < 1e-9)
  })

  test("blending two zero vectors returns a zero vector without NaN", () => {
    const short = zeroVector()
    const long = zeroVector()
    const blended = blendUserVectors(short, long)
    assert.equal(blended.length, FEATURE_DIM)
    assert.ok(blended.every((x) => x === 0 && !Number.isNaN(x)))
  })

  test("legacy short vectors blend without NaN (padded)", () => {
    const short = new Array(64).fill(0.05)
    const long = new Array(64).fill(0.02)
    const blended = blendUserVectors(short, long)
    assert.equal(blended.length, FEATURE_DIM)
    assert.ok(blended.every((x) => Number.isFinite(x)))
  })
})

describe("dominantFeatures", () => {
  test("finds the strongest genre dim", () => {
    const v = zeroVector()
    v[15] = 0.6 // sci-fi
    v[3] = 0.2 // comedy
    const { genreDim } = dominantFeatures(v)
    assert.equal(genreDim, 15)
  })
})

// ── Signal weighting (Module 1.1) ──

describe("classifyPlaybackStop", () => {
  test("≥90% → play_complete at full weight", () => {
    const r = classifyPlaybackStop(95, 100)!
    assert.equal(r.eventType, "play_complete")
    assert.equal(r.weight, 1.0)
  })

  test("exit inside 3min and ≤5% → abandonment at −0.4", () => {
    const r = classifyPlaybackStop(120, 7200)! // 1.7% of a 2h film
    assert.equal(r.eventType, "abandonment")
    assert.equal(r.weight, -0.4)
  })

  test("partial playback scales linearly 0.10 + 0.70·pct", () => {
    const r = classifyPlaybackStop(50, 100)!
    assert.equal(r.eventType, "partial_play")
    assert.ok(Math.abs(r.weight - 0.45) < 1e-9)
  })

  test("5–10% band beyond 3 minutes is ignored as noise", () => {
    assert.equal(classifyPlaybackStop(400, 7200), null) // 5.6%, >3min
  })

  test("unknown runtime yields no event", () => {
    assert.equal(classifyPlaybackStop(50, 0), null)
  })
})

describe("computeRewatchWeight", () => {
  test("returns flat 0.8 weight for re-watch within 30 days", () => {
    assert.equal(computeRewatchWeight(1), 0.8)
    assert.equal(computeRewatchWeight(15), 0.8)
    assert.equal(computeRewatchWeight(30), 0.8)
  })

  test("§6.4: the >30d weaker-rewatch branch is reachable and returns 0.4", () => {
    assert.equal(computeRewatchWeight(45), 0.4)
    assert.equal(computeRewatchWeight(undefined), 0.8)
  })
})

describe("pickBestSearchMatch (§6.7)", () => {
  test("prefers the exact normalized title match over first-hit", () => {
    const best = pickBestSearchMatch(
      [
        { id: 1, title: "The Wrong Movie", popularity: 50 },
        { id: 2, title: "Fight Club", popularity: 120 },
      ],
      "fight club"
    )
    assert.equal(best?.id, 2)
  })

  test("falls back to the first candidate when nothing scores", () => {
    const best = pickBestSearchMatch([{ id: 9, title: "Unrelated", popularity: 0 }], "Nope")
    assert.equal(best?.id, 9)
    assert.equal(pickBestSearchMatch([], "Nope"), null)
  })
})

// ── Tier 1 item scoring (Module 3.1, Bayesian per R0-3) ──

describe("scoreItem", () => {
  const base = {
    userVector: l2Normalize([1, 0, 0]),
    maxPopularity: 100,
    releaseYear: new Date().getFullYear(),
  }

  test("higher similarity ranks higher", () => {
    const hi = scoreItem({ ...base, itemVector: l2Normalize([1, 0, 0]), popularity: 10, voteAverage: 7 })
    const lo = scoreItem({ ...base, itemVector: l2Normalize([0, 1, 0]), popularity: 10, voteAverage: 7 })
    assert.ok(hi > lo)
  })

  test("thin-voted items regress toward the corpus mean (no free 0.5)", () => {
    const v = l2Normalize([1, 0, 0])
    const lowVoteHighAvg = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 10, voteCount: 10 })
    const normalVoteHighAvg = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 10, voteCount: 100 })
    assert.ok(normalVoteHighAvg > lowVoteHighAvg)
  })

  test("a genuinely bad well-voted title scores below a mediocre-good one", () => {
    const v = l2Normalize([1, 0, 0])
    const bad = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 2.0, voteCount: 5000 })
    const meh = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 5.5, voteCount: 5000 })
    assert.ok(meh > bad, "Bayesian quality must bury rated junk")
  })

  test("§1.1: suitability multiplier demotes explicit content near-zero", () => {
    const v = l2Normalize([1, 0, 0])
    const clean = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 7, voteCount: 500 })
    const explicit = scoreItem({ ...base, itemVector: v, popularity: 10, voteAverage: 7, voteCount: 500, suitability: 0.05 })
    assert.ok(clean > explicit * 5, "adult multiplier should sink the score")
  })
})

describe("serveDemotion", () => {
  test("demotes score by 0.85 per serve", () => {
    assert.equal(serveDemotion(0), 1)
    assert.ok(Math.abs(serveDemotion(1) - 0.85) < 1e-9)
    assert.ok(Math.abs(serveDemotion(2) - 0.7225) < 1e-9)
  })
})

// ── Fatigue decay & suppression (Module 4.2) ──

describe("fatigue", () => {
  test("penalty decays by 0.75 per unclicked impression", () => {
    assert.equal(fatiguePenalty(0), 1)
    assert.ok(Math.abs(fatiguePenalty(2) - 0.5625) < 1e-9)
  })

  test("K ≥ 4 within 7 days suppresses the row", () => {
    const now = Date.now()
    assert.equal(
      isRowSuppressed(
        { rowCategoryKey: "r", unclickedImpressions: FATIGUE_SUPPRESS_THRESHOLD, lastSeenTimestamp: now - 1000 },
        now
      ),
      true
    )
    // …but suppression expires after 7 days.
    assert.equal(
      isRowSuppressed(
        { rowCategoryKey: "r", unclickedImpressions: 6, lastSeenTimestamp: now - 8 * 24 * 60 * 60 * 1000 },
        now
      ),
      false
    )
    assert.equal(
      isRowSuppressed({ rowCategoryKey: "r", unclickedImpressions: 2, lastSeenTimestamp: now }, now),
      false
    )
  })
})

// ── Tier 2 MMR diversity (Module 3.2, UCB1 exploration per §5.3) ──

describe("explorationBonus", () => {
  test("zero without stats; positive for unexplored rows", () => {
    assert.equal(explorationBonus(undefined, 1000), 0)
    const low = explorationBonus({ rowCategoryKey: "new", totalImpressions: 2, totalClicks: 0, totalPlays: 0 }, 1000)
    const high = explorationBonus({ rowCategoryKey: "old", totalImpressions: 900, totalClicks: 100, totalPlays: 10 }, 1000)
    assert.ok(low > 0)
    assert.ok(low > high, "unexplored rows get the larger bonus")
  })
})

describe("rankRowsMMR", () => {
  function row(key: string, itemKeys: string[], topItemScore: number): RankableRow {
    return { key, itemKeys, topItemScore, relevance: 0.8 }
  }

  const ctx = { fatigueByKey: new Map() }

  test("duplicate rows are ranked apart by the overlap penalty", () => {
    // A and A-dup share all items; B is distinct but slightly weaker.
    const ordered = rankRowsMMR(
      [row("a", ["m:1", "m:2", "m:3"], 0.9), row("a-dup", ["m:1", "m:2", "m:3"], 0.89), row("b", ["m:7", "m:8", "m:9"], 0.8)],
      ctx
    )
    assert.equal(ordered[0], "a")
    assert.equal(ordered[1], "b", "distinct row should beat the near-duplicate")
    assert.equal(ordered[2], "a-dup")
  })

  test("higher-utility rows lead", () => {
    const ordered = rankRowsMMR(
      [row("weak", ["m:1"], 0.3), row("strong", ["m:2"], 0.9)],
      ctx
    )
    assert.deepEqual(ordered, ["strong", "weak"])
  })

  test("§5.3: a weak-but-unexplored row can outrank a saturated equal", () => {
    const stats = new Map()
    stats.set("unexplored", { rowCategoryKey: "unexplored", totalImpressions: 1, totalClicks: 0, totalPlays: 0 })
    stats.set("saturated", { rowCategoryKey: "saturated", totalImpressions: 5000, totalClicks: 500, totalPlays: 50 })
    const ordered = rankRowsMMR(
      [row("saturated", ["m:1"], 0.51), row("unexplored", ["m:2"], 0.5)],
      { fatigueByKey: new Map(), statsByKey: stats }
    )
    assert.equal(ordered[0], "unexplored")
  })
})
