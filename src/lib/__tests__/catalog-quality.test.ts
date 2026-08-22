import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  CATALOG_QUALITY_FLOORS,
  qualityFloorParams,
  withQualityFloors,
  clampToBrowseMinimums,
} from "../catalog-quality"

describe("Central Catalog Quality Floors (R0-2)", () => {
  describe("CATALOG_QUALITY_FLOORS constant", () => {
    it("contains expected lanes and media types", () => {
      assert.strictEqual(CATALOG_QUALITY_FLOORS.browse.movie.voteCountGte, 75)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.browse.tv.voteCountGte, 30)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.curated.movie.voteCountGte, 300)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.curated.tv.voteCountGte, 150)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.fresh.movie.voteCountGte, 5)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.fresh.tv.voteCountGte, 3)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.niche.movie.voteCountGte, 50)
      assert.strictEqual(CATALOG_QUALITY_FLOORS.niche.tv.voteCountGte, 25)
    })
  })

  describe("qualityFloorParams - exact calibration pins", () => {
    it("returns exact browse floors for movie and tv", () => {
      assert.deepStrictEqual(qualityFloorParams("browse", "movie"), {
        "vote_count.gte": "75",
        "popularity.gte": "3",
      })
      assert.deepStrictEqual(qualityFloorParams("browse", "tv"), {
        "vote_count.gte": "30",
        "popularity.gte": "3",
      })
    })

    it("returns exact curated floors for movie and tv", () => {
      assert.deepStrictEqual(qualityFloorParams("curated", "movie"), {
        "vote_count.gte": "300",
        "popularity.gte": "8",
      })
      assert.deepStrictEqual(qualityFloorParams("curated", "tv"), {
        "vote_count.gte": "150",
        "popularity.gte": "8",
      })
    })

    it("returns exact fresh floors with vote_average.gte and no popularity.gte", () => {
      const freshMovie = qualityFloorParams("fresh", "movie")
      assert.deepStrictEqual(freshMovie, {
        "vote_count.gte": "5",
        "vote_average.gte": "5",
      })
      assert.strictEqual("popularity.gte" in freshMovie, false)

      const freshTv = qualityFloorParams("fresh", "tv")
      assert.deepStrictEqual(freshTv, {
        "vote_count.gte": "3",
        "vote_average.gte": "5",
      })
      assert.strictEqual("popularity.gte" in freshTv, false)
    })

    it("returns exact niche floors with no popularity.gte", () => {
      const nicheMovie = qualityFloorParams("niche", "movie")
      assert.deepStrictEqual(nicheMovie, {
        "vote_count.gte": "50",
      })
      assert.strictEqual("popularity.gte" in nicheMovie, false)

      const nicheTv = qualityFloorParams("niche", "tv")
      assert.deepStrictEqual(nicheTv, {
        "vote_count.gte": "25",
      })
      assert.strictEqual("popularity.gte" in nicheTv, false)
    })
  })

  describe("withQualityFloors - max semantics & key preservation", () => {
    it("preserves unrelated query parameters", () => {
      const initial = {
        sort_by: "popularity.desc",
        with_genres: "28,12",
        "primary_release_date.gte": "2020-01-01",
      }
      const result = withQualityFloors(initial, "browse", "movie")
      assert.strictEqual(result.sort_by, "popularity.desc")
      assert.strictEqual(result.with_genres, "28,12")
      assert.strictEqual(result["primary_release_date.gte"], "2020-01-01")
      assert.strictEqual(result["vote_count.gte"], "75")
      assert.strictEqual(result["popularity.gte"], "3")
    })

    it("raises lower pre-existing floor values", () => {
      const initial = {
        "vote_count.gte": "10",
        "popularity.gte": "1.5",
      }
      const result = withQualityFloors(initial, "browse", "movie")
      assert.strictEqual(result["vote_count.gte"], "75")
      assert.strictEqual(result["popularity.gte"], "3")
    })

    it("never weakens stricter pre-existing floors (max semantics)", () => {
      const initial = {
        "vote_count.gte": "500",
        "popularity.gte": "12.5",
        "vote_average.gte": "7.5",
      }
      const result = withQualityFloors(initial, "browse", "movie")
      assert.strictEqual(result["vote_count.gte"], "500")
      assert.strictEqual(result["popularity.gte"], "12.5")
      assert.strictEqual(result["vote_average.gte"], "7.5")
    })

    it("does not emit popularity.gte when lane popularity floor is null", () => {
      const initial = { sort_by: "vote_average.desc" }
      const nicheRes = withQualityFloors(initial, "niche", "movie")
      assert.strictEqual(nicheRes["popularity.gte"], undefined)
      assert.strictEqual(nicheRes["vote_count.gte"], "50")

      const freshRes = withQualityFloors(initial, "fresh", "movie")
      assert.strictEqual(freshRes["popularity.gte"], undefined)
      assert.strictEqual(freshRes["vote_count.gte"], "5")
      assert.strictEqual(freshRes["vote_average.gte"], "5")
    })
  })

  describe("clampToBrowseMinimums", () => {
    it("sets missing floors to browse baseline", () => {
      const clamped = clampToBrowseMinimums({}, "movie")
      assert.strictEqual(clamped["vote_count.gte"], "75")
      assert.strictEqual(clamped["popularity.gte"], "3")

      const clampedTv = clampToBrowseMinimums({}, "tv")
      assert.strictEqual(clampedTv["vote_count.gte"], "30")
      assert.strictEqual(clampedTv["popularity.gte"], "3")
    })

    it("raises sub-browse values to browse minimums", () => {
      const clamped = clampToBrowseMinimums({ "vote_count.gte": "5", "popularity.gte": "1.0" }, "movie")
      assert.strictEqual(clamped["vote_count.gte"], "75")
      assert.strictEqual(clamped["popularity.gte"], "3")
    })

    it("keeps stricter values", () => {
      const clamped = clampToBrowseMinimums({ "vote_count.gte": "200", "popularity.gte": "10" }, "movie")
      assert.strictEqual(clamped["vote_count.gte"], "200")
      assert.strictEqual(clamped["popularity.gte"], "10")
    })
  })

  describe("Regression pins for closed pollution holes", () => {
    it("micro-genre fallback and safeTrending shapes receive at least 75 (movie) and 30 (tv) votes", () => {
      const movieBrowse = withQualityFloors({ sort_by: "popularity.desc", with_genres: "28" }, "browse", "movie")
      assert.strictEqual(Number(movieBrowse["vote_count.gte"]) >= 75, true)
      assert.strictEqual(Number(movieBrowse["popularity.gte"]) >= 3, true)

      const tvBrowse = withQualityFloors({ sort_by: "popularity.desc", with_genres: "10765" }, "browse", "tv")
      assert.strictEqual(Number(tvBrowse["vote_count.gte"]) >= 30, true)
      assert.strictEqual(Number(tvBrowse["popularity.gte"]) >= 3, true)
    })
  })
})
