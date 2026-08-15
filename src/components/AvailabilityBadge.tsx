"use client"

import type { AvailabilityResult } from "@/app/api/availability/route"
import { Download, BookmarkPlus, Bookmark, Clock } from "lucide-react"

export function AvailabilityBadge({ state }: { state?: AvailabilityResult }) {
  if (!state) return null

  switch (state.status) {
    case "in_library":
      return (
          <div className="bg-green-600 text-white p-1 shadow-md opacity-90">
            <Bookmark className="size-3.5 fill-white text-white" />
          </div>
      )
    case "downloading":
      return (
        <div className="flex items-center gap-1 rounded-none bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black shadow backdrop-blur">
          <Download className="size-3 stroke-[3] animate-pulse" />
          <span>{state.progress && state.progress > 0 ? `${Math.round(state.progress)}%` : "QUEUED"}</span>
        </div>
      )
    case "in_radarr":
    case "in_sonarr":
      return (
        <div className="flex items-center gap-1 rounded-none bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
          <BookmarkPlus className="size-3 stroke-[3]" />
          <span>REQUESTED</span>
        </div>
      )
    case "pending":
      return (
        <div
          className="flex items-center gap-1 rounded-none bg-amber-600/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur"
          title={state.requestedByUsername ? `Requested by ${state.requestedByUsername}` : "Pending admin approval"}
        >
          <Clock className="size-3 stroke-[3]" />
          <span>PENDING</span>
        </div>
      )
    case "not_requested":
    default:
      return (
        <div className="flex items-center gap-1 rounded-none bg-accent/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow backdrop-blur">
          <span>+ REQUEST</span>
        </div>
      )
  }
}
