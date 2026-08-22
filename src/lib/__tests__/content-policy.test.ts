import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
  bayesianRating,
  bayesianQualityScore,
  meetsEngagementFloor,
  BAYES_PRIOR_VOTES,
  CORPUS_MEAN_RATING,
} from "../scoring"
import {
  suitabilityMultiplier,
  isSpamGradeExplicit,
  curateTrending,
  scriptedTvParams,
  usMovieCertification,
  usTvRating,
  movieMaturityParams,
  tvMaturityCeilingAllows,
} from "../content-policy"
import { isQualityContent, filterDisplayableContent, contentSuitability } from "../catalog"
import { FACET_REGISTRY, getFacetKeysForGenre, getFacetKeysForMediaType } from "../discovery/facets"

// ── Bayesian weighted rating (R0-3 / §1.3) ──

describe("bayesianRating", () => {
  test("zero votes regress fully to the corpus mean", () => {
    assert.ok(Math.abs(bayesianRating(0, 10, "movie") - CORPUS_MEAN_RATING) < 1e-9)
    assert.ok(Math.abs(bayesianRating(null, undefined, "tv") - CORPUS_MEAN_RATING) < 1e-9)
  })

  test("thin votes barely move off the mean — no free 0.5 quality", () => {
    // The audit's canonical junk: 10 votes, 2.2★.
    const junk = bayesianRating(10, 2.2, "tv")
    assert.ok(junk > 6.0, `10-vote 2.2★ should sit near the mean, got ${junk}`)
    assert.ok(junk < CORPUS_MEAN_RATING + 0.01 || junk >= CORPUS_MEAN_RATING)
  })

  test("massive vote counts converge to the observed average", () => {
    const blockbuster = bayesianRating(100_000, 8.4, "movie")
    assert.ok(Math.abs(blockbuster - 8.4) < 0.01, `got ${blockbuster}`)
  })

  test("uses m=300 for movies and m=100 for TV (audit calibration)", () => {
    assert.equal(BAYES_PRIOR_VOTES.movie, 300)
    assert.equal(BAYES_PRIOR_VOTES.tv, 100)
    // Same evidence weighs more for TV than movies (smaller prior).
    assert.ok(bayesianRating(100, 9, "tv") > bayesianRating(100, 9, "movie"))
  })

  test("quality score is the rating divided by 10", () => {
    assert.ok(Math.abs(bayesianQualityScore(10_000, 7, "movie") - 0.7) < 0.01)
  })
})

describe("meetsEngagementFloor", () => {
  test("passes metadata-less items (upstream discover floors handle them)", () => {
    assert.equal(meetsEngagementFloor(null, null, "movie"), true)
  })
  test("fails the daily-soap profile: 4 votes and popularity 2 is fine, 4 votes + 0 popularity is not", () => {
    assert.equal(meetsEngagementFloor(4, 0, "tv"), false)
    assert.equal(meetsEngagementFloor(4, 2, "tv"), true)
    assert.equal(meetsEngagementFloor(15, 0, "movie"), true)
  })
})

// ── Content policy (R0-4 / §1.1) ──

describe("suitabilityMultiplier", () => {
  test("clean content is unaffected", () => {
    assert.equal(suitabilityMultiplier({ title: "The Lord of the Rings" }), 1)
  })

  test("TMDB adult flag sinks the multiplier", () => {
    assert.ok(suitabilityMultiplier({ adult: true, title: "Anything" }) <= 0.05)
  })

  test("strong keywords demote harder than mild ones", () => {
    const strong = suitabilityMultiplier({ title: "X", keywordNames: ["sexploitation"] })
    const mild = suitabilityMultiplier({ title: "X", keywordNames: ["erotic thriller"] })
    assert.ok(strong < mild)
    assert.ok(mild < 1)
  })

  test("title denylist catches explicit marketing names", () => {
    assert.ok(suitabilityMultiplier({ title: "Some Erotic Nights" }) < 1)
    // Substring-only matches must NOT trigger (word boundaries).
    assert.equal(suitabilityMultiplier({ title: "Eroticism aside, a documentary" }), 1)
  })

  test("NC-17 / TV-MA certifications demote", () => {
    assert.ok(suitabilityMultiplier({ title: "X", certification: "NC-17" }) < 1)
    assert.ok(suitabilityMultiplier({ title: "X", certification: "TV-MA" }) < 1)
    assert.equal(suitabilityMultiplier({ title: "X", certification: "PG" }), 1)
  })

  test("multipliers multiply", () => {
    const both = suitabilityMultiplier({ adult: true, title: "Erotic", keywordNames: ["softcore"] })
    assert.ok(both < 0.01)
  })
})

describe("isSpamGradeExplicit", () => {
  test("only combined hard signals count as spam-grade (hide), single mild ones demote", () => {
    assert.equal(isSpamGradeExplicit({ adult: true, keywordNames: ["softcore"] }), true)
    assert.equal(isSpamGradeExplicit({ keywordNames: ["erotic thriller"] }), false)
    assert.equal(isSpamGradeExplicit({ adult: true }), false, "adult alone demotes, does not hide")
  })
})

describe("curateTrending (§1.7)", () => {
  const base = { popularity: 100, voteCount: 50 }
  test("drops poster-less and adult items", () => {
    const out = curateTrending([
      { id: 1, ...base, voteAverage: 7, posterPath: "/a.jpg" },
      { id: 2, ...base, voteAverage: 7, posterPath: null },
      { id: 3, ...base, voteAverage: 7, posterPath: "/b.jpg", adult: true },
    ])
    assert.deepEqual(out.map((i) => i.id), [1])
  })
  test("drops zero-traction entries and orders by demoted quality", () => {
    const out = curateTrending([
      { id: 1, popularity: 100, voteCount: 100, voteAverage: 8, posterPath: "/a.jpg", title: "Great" },
      { id: 2, popularity: 100, voteCount: 100, voteAverage: 5, posterPath: "/b.jpg", title: "Meh" },
      { id: 3, popularity: 1, voteCount: 0, voteAverage: 0, posterPath: "/c.jpg", title: "Noise" },
    ])
    assert.deepEqual(out.map((i) => i.id), [1, 2])
  })
})

describe("TV format policy (§1.6)", () => {
  test("general TV rows request scripted/miniseries content", () => {
    assert.deepEqual(scriptedTvParams(), { with_type: "2|4" })
  })
})

describe("certification extraction", () => {
  test("prefers the US theatrical release certification", () => {
    const payload = {
      results: [
        { iso_3166_1: "US", release_dates: [{ certification: "", type: 1 }, { certification: "R", type: 3 }] },
      ],
    }
    assert.equal(usMovieCertification(payload), "R")
    assert.equal(usMovieCertification({ results: [] }), null)
  })
  test("reads the US TV content rating", () => {
    assert.equal(usTvRating({ results: [{ iso_3166_1: "US", rating: "TV-MA" }] }), "TV-MA")
    assert.equal(usTvRating(null), null)
  })
})

describe("maturity ceilings (§7.9)", () => {
  test("movie ceilings map to certification.lte params", () => {
    assert.deepEqual(movieMaturityParams("unrestricted"), {})
    assert.deepEqual(movieMaturityParams("teen"), { certification_country: "US", "certification.lte": "PG-13" })
    assert.deepEqual(movieMaturityParams("all-ages"), { certification_country: "US", "certification.lte": "PG" })
  })
  test("TV ceilings filter by rating at scoring time", () => {
    assert.equal(tvMaturityCeilingAllows("teen", "TV-14"), true)
    assert.equal(tvMaturityCeilingAllows("teen", "TV-MA"), false)
    assert.equal(tvMaturityCeilingAllows("unrestricted", "TV-MA"), true)
  })
})

// ── Catalog quality gate (§1.4 rewrite) ──

describe("isQualityContent", () => {
  const movie = (over: Record<string, unknown>) => ({
    title: "T",
    poster_path: "/p",
    overview: "o",
    release_date: "2020-01-01",
    ...over,
  })

  test("passes a healthy blockbuster", () => {
    assert.equal(isQualityContent(movie({ vote_average: 7.4, vote_count: 2400, popularity: 88 })), true)
  })

  test("adult-flagged items pass the gate but sink in ranking (down-rank policy)", () => {
    const adult = movie({ vote_average: 5, vote_count: 90, adult: true })
    // §1.1 policy: adult content is demoted to near-zero by the ranking
    // layer and stays findable via search — only spam-grade is hidden.
    assert.equal(isQualityContent(adult), true)
    assert.ok(contentSuitability(adult) < 0.1)
  })

  test("drops a well-voted genuinely bad title via the Bayesian bar", () => {
    assert.equal(isQualityContent(movie({ vote_average: 2.0, vote_count: 5000, popularity: 12 })), false)
  })

  test("keeps a thin-voted 2.0★ title only when it has traction (demote-not-delete)", () => {
    // 4 votes, 2.0★: too thin for the Bayesian bar to condemn, but no
    // engagement either → filtered.
    assert.equal(isQualityContent(movie({ vote_average: 2.0, vote_count: 4, popularity: 0.2 })), false)
  })

  test("metadata-less RowItems pass through", () => {
    assert.equal(isQualityContent({ id: 1, title: "x", poster_path: "/p", overview: "o" }), true)
  })

  test("in-library items always pass", () => {
    assert.equal(
      isQualityContent(
        movie({ vote_average: 1.0, vote_count: 9000, availabilityStatus: { status: "in_library" } })
      ),
      true
    )
  })
})

describe("filterDisplayableContent allowMissingOverview (§1.9)", () => {
  const items = [
    { id: 1, title: "A", poster_path: "/p", overview: "yes", release_date: "2020-01-01", vote_average: 7, vote_count: 500, popularity: 10 },
    { id: 2, title: "B", poster_path: "/p", overview: "", release_date: "2020-01-01", vote_average: 7, vote_count: 500, popularity: 10 },
  ]
  test("default drops overview-less; opt-in keeps them for language rails", () => {
    assert.deepEqual(filterDisplayableContent(items).map((i) => i.id), [1])
    assert.deepEqual(filterDisplayableContent(items, { allowMissingOverview: true }).map((i) => i.id), [1, 2])
  })
})

describe("contentSuitability (§1.1 demotion hook)", () => {
  test("exposes the multiplier for ranking layers", () => {
    assert.ok(contentSuitability({ title: "Fine Film" }) === 1)
    assert.ok(contentSuitability({ title: "Fine Film", adult: true }) < 0.1)
  })
})

// ── Data-driven facet registry (R1-3 / §2.3) ──

describe("FACET_REGISTRY", () => {
  test("contains 40+ facets generated from the genre registry", () => {
    assert.ok(Object.keys(FACET_REGISTRY).length >= 40, `only ${Object.keys(FACET_REGISTRY).length} facets`)
  })

  test("every genre with movie ids has a popular/top-rated/new triple", () => {
    for (const kind of ["popular", "top-rated", "new"] as const) {
      assert.ok(FACET_REGISTRY[`genre-action-movie-${kind}`], `missing action movie ${kind}`)
      assert.ok(FACET_REGISTRY[`genre-comedy-tv-${kind}`], `missing comedy tv ${kind}`)
    }
  })

  test("the airing facet uses the real /tv/on_the_air endpoint (R1-6)", () => {
    assert.equal(FACET_REGISTRY["on-the-air-shows"].source, "on-the-air")
  })

  test("top-10 facets are flagged for ordinal badges", () => {
    assert.equal(FACET_REGISTRY["top-10-movies"].isTop10, true)
    assert.equal(FACET_REGISTRY["top-10-shows"].isTop10, true)
  })

  test("network/language/speciality rails exist (R2-4)", () => {
    for (const key of ["hbo-series", "netflix-originals", "k-dramas", "anime-series", "studio-ghibli", "bollywood", "airing-this-week", "coming-soon"]) {
      assert.ok(FACET_REGISTRY[key], `missing ${key}`)
    }
  })

  test("§7.8: the Coming Soon rail opts into the future-release window", () => {
    const spec = FACET_REGISTRY["coming-soon"]
    assert.ok(spec.includeFutureReleases)
    assert.ok(spec.params["primary_release_date.gte"]! <= new Date().toISOString().split("T")[0])
  })

  test("collection/franchise rails exist (§7.5)", () => {
    for (const key of ["star-wars-saga", "middle-earth", "harry-potter", "dark-knight-trilogy"]) {
      assert.ok(FACET_REGISTRY[key], `missing ${key}`)
    }
    assert.equal(FACET_REGISTRY["star-wars-saga"].source, "collection:10")
  })

  test("discover facets carry the central quality floors (R0-2)", () => {
    assert.equal(FACET_REGISTRY["popular-movies"].params["vote_count.gte"], "75")
    assert.equal(FACET_REGISTRY["popular-movies"].params["popularity.gte"], "3")
    assert.equal(FACET_REGISTRY["popular-shows"].params["vote_count.gte"], "30")
    assert.equal(FACET_REGISTRY["top-rated-shows"].params["popularity.gte"], "8")
  })

  test("unscripted genre facets bypass the scripted-TV bias (§1.6)", () => {
    assert.equal(FACET_REGISTRY["genre-reality-tv-popular"].allowUnscriptedTv, true)
    assert.equal(FACET_REGISTRY["genre-drama-tv-popular"].allowUnscriptedTv, undefined)
  })

  test("genre-mode family returns the filtered triple (R1-3)", () => {
    const keys = getFacetKeysForGenre("action", "movie")
    assert.deepEqual(keys.sort(), ["genre-action-movie-new", "genre-action-movie-popular", "genre-action-movie-top-rated"].sort())
  })

  test("media-type listing excludes genre facets and includes the core set", () => {
    const movieKeys = getFacetKeysForMediaType("movie")
    assert.ok(movieKeys.includes("popular-movies"))
    assert.ok(movieKeys.includes("top-10-movies"))
    assert.ok(movieKeys.every((k) => !FACET_REGISTRY[k].genreSlug))
  })
})
