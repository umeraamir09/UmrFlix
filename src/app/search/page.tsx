import { SearchResults } from "@/components/SearchResults"
import { Suspense } from "react"

export default function SearchPage() {
  return (
    <main className="min-h-screen bg-background pt-20 pb-16">
      <Suspense fallback={<div className="p-8 text-center text-sm text-gray-400">Loading search...</div>}>
        <SearchResults />
      </Suspense>
    </main>
  )
}
