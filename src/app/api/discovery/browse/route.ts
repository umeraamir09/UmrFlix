import { NextResponse } from "next/server"
import { discoverMovies, discoverTv } from "@/lib/tmdb"
import { filterDisplayableContent } from "@/lib/catalog"
import { qualityFloorParams } from "@/lib/catalog-quality"
import { scriptedTvParams } from "@/lib/content-policy"
import { bayesianRating } from "@/lib/scoring"
import { getGenreBySlug, getGenreDiscoverParams, getGenreIdsForMediaType } from "@/lib/genres"
import { enrichMediaItemsWithPosters } from "@/lib/horizontal-posters"

export const dynamic = "force-dynamic"

const SORTS = new Set(["popularity", "rating", "newest"])

/**
 * Catalog explorer endpoint (audit §2.7 / R1-5): a paginated, filterable
 * grid over discover — the sanctioned home for the down-ranked long tail.
 * Rows stay clean; the explorer stays complete. This is a server-side caller
 * (tmdbFetch directly), so the /api/tmdb proxy's browse clamp does not apply;
 * floors here are deliberately the light "fresh" lane with a rating
 * backstop, and every result still passes the displayability pipeline once.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const mediaType = searchParams.get("mediaType") === "tv" ? "tv" : "movie"
    const genreSlug = searchParams.get("genre")
    const sortParam = searchParams.get("sort") ?? "popularity"
    const sort = SORTS.has(sortParam) ? sortParam : "popularity"
    const page = Math.max(1, Math.min(500, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1))

    const genre = genreSlug ? getGenreBySlug(genreSlug) : undefined
    const genreIds = genre ? getGenreIdsForMediaType(genre, mediaType) : []

    const params: Record<string, string> = {}
    switch (sort) {
      case "rating":
        params.sort_by = "vote_average.desc"
        params["vote_count.gte"] = "20" // enough evidence for a meaningful rating
        break
      case "newest":
        params.sort_by = mediaType === "movie" ? "primary_release_date.desc" : "first_air_date.desc"
        Object.assign(params, qualityFloorParams("fresh", mediaType))
        break
      default:
        params.sort_by = "popularity.desc"
        Object.assign(params, qualityFloorParams("fresh", mediaType))
    }
    if (mediaType === "movie") {
      params["with_runtime.gte"] = "20"
      params.include_adult = "false"
    } else {
      // Scripted bias unless the user explicitly browses an unscripted genre.
      const unscriptedGenre = genre && [10762, 10763, 10764, 10766, 10767].some((id) => genre.tvGenreIds.includes(id))
      if (!unscriptedGenre) Object.assign(params, scriptedTvParams())
    }
    if (genreIds.length > 0) params.with_genres = genreIds.join(",")
    if (genre) Object.assign(params, getGenreDiscoverParams(genre, mediaType))
    params.page = String(page)

    const data =
      mediaType === "movie" ? await discoverMovies(params) : await discoverTv(params)

    const results = (data?.results ?? []) as (
      | (Awaited<ReturnType<typeof discoverMovies>>["results"][number])
      | (Awaited<ReturnType<typeof discoverTv>>["results"][number])
    )[]
    const displayable = filterDisplayableContent(results).map((item) => ({
      id: item.id,
      title: "title" in item ? item.title : undefined,
      name: "name" in item ? item.name : undefined,
      poster_path: item.poster_path ?? null,
      backdrop_path: item.backdrop_path ?? null,
      overview: item.overview ?? "",
      release_date: "release_date" in item ? item.release_date : undefined,
      first_air_date: "first_air_date" in item ? item.first_air_date : undefined,
      vote_average: item.vote_average ?? 0,
      vote_count: item.vote_count ?? 0,
      popularity: item.popularity ?? 0,
      media_type: mediaType,
    }))

    // Rating sort: re-rank by the Bayesian weighted rating so a 10★/42-vote
    // curio does not outrank a 8.4★/12000-vote classic on the same page.
    if (sort === "rating") {
      displayable.sort(
        (a, b) =>
          bayesianRating(b.vote_count, b.vote_average, mediaType) -
          bayesianRating(a.vote_count, a.vote_average, mediaType)
      )
    }

    await enrichMediaItemsWithPosters(displayable)

    return NextResponse.json({
      results: displayable,
      page,
      totalPages: Math.min(data?.total_pages ?? 1, 500),
      totalResults: data?.total_results ?? displayable.length,
    })
  } catch (err) {
    console.error("[Discovery] Browse explorer failed:", err)
    return NextResponse.json({ results: [], page: 1, totalPages: 1, totalResults: 0 })
  }
}
