"use client"

import type { AvailabilityResult } from "@/app/api/availability/route"
import { Check, Download, BookmarkPlus } from "lucide-react"

export function AvailabilityBadge({ state }: { state?: AvailabilityResult }) {
  if (!state) return null

  switch (state.status) {
    case "in_library":
      return (
        <div className="flex items-center gap-1 rounded bg-green-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
          <Check className="size-3 stroke-[3]" />
          <span>IN LIBRARY</span>
        </div>
      )
    case "downloading":
      return (
        <div className="flex items-center gap-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black shadow backdrop-blur">
          <Download className="size-3 stroke-[3] animate-pulse" />
          <span>{state.progress && state.progress > 0 ? `${Math.round(state.progress)}%` : "QUEUED"}</span>
        </div>
      )
    case "in_radarr":
    case "in_sonarr":
      return (
        <div className="flex items-center gap-1 rounded bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
          <BookmarkPlus className="size-3 stroke-[3]" />
          <span>REQUESTED</span>
        </div>
      )
    case "not_requested":
    default:
      return (
        <div className="flex items-center gap-1 rounded bg-[#E50914]/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
          <span>+ REQUEST</span>
        </div>
      )
  }
}
