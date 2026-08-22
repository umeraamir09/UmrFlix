import { MovieRow } from "@/components/MovieRow"
import { getFacetSpec } from "@/lib/discovery/facets"

/**
 * Server-rendered rails from the shared facet registry (audit §2.6/R1-3):
 * home, /movies and /tvshows all reference the same definitions instead of
 * hand-rolled per-page discover query strings.
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
      {keys.map((key) => {
        const spec = getFacetSpec(key)
        if (!spec) return null
        return (
          <MovieRow
            key={key}
            title={spec.title}
            subtitle={spec.subtitle}
            type={spec.mediaType}
            endpoint={`/api/discovery/row?facet=${key}`}
            rowKey={`facet:${key}`}
            isTop10={spec.isTop10}
            cardVariant={cardVariant}
          />
        )
      })}
    </>
  )
}
