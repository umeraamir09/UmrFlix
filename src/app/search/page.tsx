import { SearchResults } from "@/components/SearchResults"
import { Suspense } from "react"

export default function SearchPage() {
  return (
    <div className="p-6">
      <Suspense fallback={<p className="text-muted">Loading...</p>}>
        <SearchResults />
      </Suspense>
    </div>
  )
}
