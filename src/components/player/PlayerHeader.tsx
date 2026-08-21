"use client"

import React from "react"
import { IconArrowBackIos } from "@/components/ui/icons"
import { Flag } from "lucide-react"

export interface PlayerHeaderProps {
  title?: string
  subtitle?: string
  onBack: () => void
  onReport?: () => void
  visible?: boolean
  className?: string
}

export function PlayerHeader({
  title,
  subtitle,
  onBack,
  onReport,
  visible = true,
  className = "",
}: PlayerHeaderProps) {
  return (
    <header
      role="banner"
      aria-label="Player top navigation"
      className={`pointer-events-none relative z-30 flex w-full h-28 sm:h-36 items-start justify-between bg-gradient-to-b from-black/95 via-black/60 to-transparent px-4 py-4 sm:px-10 sm:py-6 transition-opacity duration-300 ${
        visible ? "opacity-100" : "opacity-0"
      } ${className}`}
    >
      <div className="pointer-events-auto flex items-center gap-3 sm:gap-5">
        <button
          type="button"
          data-testid="player-back-btn"
          onClick={(e) => {
            e.stopPropagation()
            onBack()
          }}
          aria-label="Go back"
          title="Back"
          className="group flex size-10 sm:size-12 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-md transition-all hover:scale-105 hover:bg-white/20 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan outline-none"
        >
          <IconArrowBackIos className="size-5 sm:size-6 -translate-x-0.5 transition-transform group-hover:-translate-x-1" />
        </button>

        {(title || subtitle) && (
          <div className="flex flex-col justify-center select-none min-w-0">
            {title && (
              <h1 className="text-base sm:text-2xl lg:text-[28px] font-bold text-white tracking-tight leading-snug truncate drop-shadow-md">
                {title}
              </h1>
            )}
            {subtitle && (
              <p className="text-xs sm:text-base lg:text-lg font-normal text-white/80 truncate drop-shadow">
                {subtitle}
              </p>
            )}
          </div>
        )}
      </div>

      {onReport && (
        <div className="pointer-events-auto flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onReport()
            }}
            aria-label="Report playback issue"
            title="Report issue"
            className="flex size-9 sm:size-10 items-center justify-center rounded-full bg-black/40 text-white/70 backdrop-blur-md transition-all hover:bg-white/20 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-cyan outline-none"
          >
            <Flag className="size-4 sm:size-4.5" />
          </button>
        </div>
      )}
    </header>
  )
}
