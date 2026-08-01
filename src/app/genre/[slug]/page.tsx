import { Fragment } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { HeroBillboard, BillboardItem } from "@/components/HeroBillboard"
import { MovieRow } from "@/components/MovieRow"
import { SpotlightBanner, SpotlightItem } from "@/components/SpotlightBanner"
import { GenreSwitcher } from "@/components/GenreSwitcher"
import { getGenreBySlug } from "@/lib/genres"
import { getGenrePageData, GenreRow } from "@/lib/genre-catalog"
import { getSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const genre = getGenreBySlug(slug)
  if (!genre) {
    return {
      title: "Genre Not Found | UmrFlix",
    }
  }
  return {
    title: `${genre.name} — Browse Movies & TV Shows | UmrFlix`,
    description: genre.description,
  }
}

function toSpotlight(item: GenreRow["items"][number]): SpotlightItem | null {
  if (!item.backdrop_path) return null
  return {
    id: item.id,
    title: item.title || item.name || "",
    overview: item.overview || "",
    backdrop_path: item.backdrop_path,
    media_type: item.media_type === "tv" ? "tv" : "movie",
  }
}

export default async function GenrePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const genre = getGenreBySlug(slug)
  if (!genre) notFound()

  const session = await getSession()
  const userId = session?.userId ?? "default"

  let heroItems: BillboardItem[] = []
  let rows: GenreRow[] = []

  try {
    const data = await getGenrePageData(slug, userId)
    if (data) {
      heroItems = data.heroItems
      rows = data.rows
    }
  } catch (err) {
    console.error(`Failed to load genre page data for "${slug}":`, err)
  }

  // Spotlight banners interleaved between rows. The trending row is
  // popularity-sorted, so items past the hero's top-5 make for varied
  // mid-page spotlights.
  const trendingRow = rows.find((r) => r.id === "trending") ?? rows[0]
  const trendingItems = trendingRow?.items ?? []
  const spotlightItem1 = trendingItems[6] ? toSpotlight(trendingItems[6]) : null
  const spotlightItem2 = trendingItems[10] ? toSpotlight(trendingItems[10]) : null

  const isEmpty = heroItems.length === 0 && rows.length === 0

  return (
    <div className="space-y-10 pb-16">
      {/* Hero Billboard */}
      {heroItems.length > 0 && <HeroBillboard items={heroItems} />}

      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 md:px-8 space-y-12 relative z-20 -mt-28 sm:-mt-36 md:-mt-44">
        {/* Header & Genre Switcher */}
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-border/50 pb-4">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
                {genre.name}
              </h1>
              <p className="text-sm text-foreground-muted mt-1 font-medium">
                {genre.description}
              </p>
            </div>
          </div>
          <GenreSwitcher activeSlug={slug} />
        </div>

        {isEmpty ? (
          <div className="py-16 text-center">
            <p className="text-lg font-bold text-white">
              Nothing here right now
            </p>
            <p className="text-sm text-foreground-muted mt-1">
              We couldn&apos;t find any {genre.name} titles. Check back soon.
            </p>
          </div>
        ) : (
          <>
            {rows.map((row, index) => (
              <Fragment key={row.id}>
                <MovieRow
                  title={row.title}
                  subtitle={row.subtitle}
                  type={row.type === "tv" ? "tv" : "movie"}
                  customItems={row.items}
                />
                {index === 2 && spotlightItem1 && (
                  <SpotlightBanner item={spotlightItem1} />
                )}
                {index === 5 && spotlightItem2 && (
                  <SpotlightBanner item={spotlightItem2} />
                )}
              </Fragment>
            ))}

            {/* Browse full catalog */}
            <div className="pt-2 border-t border-border/50">
              <Link
                href={`/search?genre=${encodeURIComponent(genre.name)}`}
                className="inline-flex items-center gap-2 rounded-none border border-border bg-surface px-5 py-3 text-xs font-bold uppercase tracking-wider text-gray-300 transition-all hover:border-accent hover:text-white hover:scale-[1.02] active:scale-95"
              >
                Browse full {genre.name} catalog
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
