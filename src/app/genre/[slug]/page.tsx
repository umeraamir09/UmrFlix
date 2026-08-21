import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { MovieRow } from "@/components/MovieRow"
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

  let rows: GenreRow[] = []

  try {
    const data = await getGenrePageData(slug, userId)
    if (data) {
      rows = data.rows
    }
  } catch (err) {
    console.error(`Failed to load genre page data for "${slug}":`, err)
  }

  const isEmpty = rows.length === 0

  return (
    <div className="min-h-screen bg-penpot-bg text-penpot-text-high">
      <div className="mx-auto max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 pt-28 sm:pt-32 md:pt-36 lg:pt-40 pb-16 sm:pb-24">
        {/* ── Centered Genre Title (1:1 Penpot Collection/Genre Design) ── */}
        <div className="text-center mb-8 sm:mb-12 md:mb-16">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl 2xl:text-8xl font-black uppercase tracking-tight text-white select-none">
            {genre.name}
          </h1>
        </div>

        {isEmpty ? (
          <div className="py-20 text-center">
            <p className="text-lg font-bold text-white">
              Nothing here right now
            </p>
            <p className="text-sm text-penpot-text-medium mt-1">
              We couldn&apos;t find any {genre.name} titles. Check back soon.
            </p>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8 md:space-y-10">
            {rows.map((row) => (
              <MovieRow
                key={row.id}
                title={row.title}
                subtitle={row.subtitle}
                type={row.type === "tv" ? "tv" : "movie"}
                customItems={row.items}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
