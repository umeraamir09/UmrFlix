import { MovieRow } from "@/components/MovieRow"
import { LazyRow } from "@/components/LazyRow"
import { getFacetSpec } from "@/lib/discovery/facets"

/**
 * Server-rendered rails from the shared facet registry (audit §2.6/R1-3):
 * home, /movies and /tvshows all reference the same definitions instead of
 * hand-rolled per-page discover query strings. Rows mount lazily (LazyRow)
 * so a 25-rail page only fetches what actually scrolls into view.
 */
export function FacetRails({
  keys,
  cardVariant = "default",
}: {
  keys: string[]
  cardVariant?: "default" | "large"
}) {
  return (
    <>
      {keys.map((key, index) => {
        const spec = getFacetSpec(key)
        if (!spec) return null
        return (
          <LazyRow key={key} eager={index === 0}>
            <MovieRow
              title={spec.title}
              subtitle={spec.subtitle}
              type={spec.mediaType}
              endpoint={`/api/discovery/row?facet=${key}`}
              rowKey={`facet:${key}`}
              isTop10={spec.isTop10}
              cardVariant={cardVariant}
            />
          </LazyRow>
        )
      })}
    </>
  )
}
