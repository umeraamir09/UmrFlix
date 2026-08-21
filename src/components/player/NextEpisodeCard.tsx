"use client"

import React from "react"
import Image from "next/image"
import type { NextEpisodeInfo } from "./PlayerOverlays"

export interface NextEpisodeCardProps {
  next: NextEpisodeInfo
  seriesTitle?: string
  onClick?: () => void
  className?: string
}

export function NextEpisodeCard({
  next,
  seriesTitle,
  onClick,
  className = "",
}: NextEpisodeCardProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group flex h-[109px] w-[340px] sm:w-[386px] overflow-hidden rounded-lg border border-white/15 bg-[#121317]/95 shadow-2xl backdrop-blur-xl transition-all duration-200 ${
        onClick ? "cursor-pointer hover:border-cyan/50 hover:bg-[#1a1d26]/95 active:scale-[0.98]" : ""
      } ${className}`}
    >
      {/* Thumbnail */}
      <div className="relative h-full w-[140px] sm:w-[170px] shrink-0 bg-neutral-900 overflow-hidden rounded-l-lg">
        {next.imageUrl ? (
          <Image
            src={next.imageUrl}
            alt={next.title || "Next episode"}
            fill
            sizes="170px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/5 text-xs text-white/40">
            No Preview
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#121317]/40" />
      </div>

      {/* Details */}
      <div className="flex flex-1 flex-col justify-center px-3.5 py-2 text-left">
        <span className="text-[11px] font-bold uppercase tracking-wider text-white/50">
          Next Episode
        </span>
        {seriesTitle && (
          <h4 className="mt-0.5 text-sm sm:text-base font-bold text-white line-clamp-1">
            {seriesTitle}
          </h4>
        )}
        <p className="text-xs sm:text-sm font-medium text-white/80 line-clamp-1">
          {next.label ? `${next.label} — ` : ""}
          {next.title}
        </p>
      </div>
    </div>
  )
}
