import type { Metadata } from "next"
import { BrowseExplorer } from "@/components/BrowseExplorer"

export const metadata: Metadata = {
  title: "Browse the Full Catalog — Explore Every Movie & Series | UmrFlix",
  description:
    "Explore the complete UmrFlix catalog: filter by genre, sort by popularity, rating, or release date, and browse every movie and series with paginated results.",
}

/**
 * Catalog explorer (audit §2.7 / R1-5). The down-rank policy keeps curated
 * rows clean; this page is the sanctioned home of the long tail — everything
 * released and displayable, sortable and paginated.
 */
export default function BrowsePage() {
  return (
    <div className="min-h-screen pb-16">
      <div className="mx-auto max-w-[1600px] 2xl:max-w-[1920px] 3xl:max-w-[2300px] 4xl:max-w-[2700px] px-4 sm:px-6 md:px-8 lg:px-12 2xl:px-16 pt-28 sm:pt-32 space-y-8">
        <div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black uppercase tracking-tight text-white">
            Browse
          </h1>
          <p className="text-sm text-penpot-text-medium font-medium mt-2 max-w-2xl">
            The full catalog — every movie and series, sorted and filtered your way.
          </p>
        </div>

        <BrowseExplorer />
      </div>
    </div>
  )
}
