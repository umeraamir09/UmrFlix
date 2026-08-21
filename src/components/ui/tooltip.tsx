"use client"

import React, { useState, useRef, useEffect, useId, ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: "top" | "bottom" | "left" | "right"
  sideOffset?: number
  delayDuration?: number
  className?: string
  disabled?: boolean
}

export function Tooltip({
  content,
  children,
  side = "top",
  sideOffset = 8,
  delayDuration = 150,
  className,
  disabled = false,
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const tooltipId = useId()

  const handleMouseEnter = () => {
    if (disabled || !content) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true)
    }, delayDuration)
  }

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setIsVisible(false)
  }

  const handleFocus = () => {
    if (disabled || !content) return
    setIsVisible(true)
  }

  const handleBlur = () => {
    setIsVisible(false)
  }

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Calculate side position classes
  const sideClasses: Record<string, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }

  // Arrow classes pointing back to trigger
  const arrowClasses: Record<string, string> = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-[#f9f9f9] border-x-transparent border-b-transparent border-t-[5px] border-x-[5px] border-b-0",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-[#f9f9f9] border-x-transparent border-t-transparent border-b-[5px] border-x-[5px] border-t-0",
    left: "left-full top-1/2 -translate-y-1/2 border-l-[#f9f9f9] border-y-transparent border-r-transparent border-l-[5px] border-y-[5px] border-r-0",
    right: "right-full top-1/2 -translate-y-1/2 border-r-[#f9f9f9] border-y-transparent border-l-transparent border-r-[5px] border-y-[5px] border-l-0",
  }

  return (
    <div
      className="relative inline-flex items-center justify-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {children}

      {isVisible && !disabled && content && (
        <div
          id={tooltipId}
          role="tooltip"
          className={cn(
            "absolute z-50 pointer-events-none select-none whitespace-nowrap",
            "bg-penpot-neutral-100 text-penpot-neutral-600 font-sans font-semibold text-xs sm:text-[13px] px-3 py-1.5 rounded-[4px] shadow-2xl",
            "animate-in fade-in-0 zoom-in-95 duration-150",
            sideClasses[side],
            className
          )}
          style={{
            transformOrigin:
              side === "top"
                ? "bottom center"
                : side === "bottom"
                ? "top center"
                : side === "left"
                ? "right center"
                : "left center",
            marginTop: side === "bottom" ? `${sideOffset}px` : undefined,
            marginBottom: side === "top" ? `${sideOffset}px` : undefined,
            marginLeft: side === "right" ? `${sideOffset}px` : undefined,
            marginRight: side === "left" ? `${sideOffset}px` : undefined,
          }}
        >
          {content}
          <span
            className={cn("absolute size-0 border-solid pointer-events-none", arrowClasses[side])}
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  )
}
