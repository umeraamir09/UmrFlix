"use client"

import { forwardRef } from "react"
import { cn } from "@/lib/utils"

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "play"
  | "request"
  | "moreInfo"
  | "outline"
  | "outlined"
  | "ghost"
  | "danger"
  | "accent"
  | "muted"

export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  asChild?: boolean
}

export const buttonVariants = ({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
} = {}) => {
  const variantStyles: Record<ButtonVariant, string> = {
    // Primary blue action (Penpot #037AEB / #0063E5)
    primary:
      "bg-penpot-primary-400 hover:bg-penpot-primary-300 active:bg-penpot-primary-500 text-white shadow-lg shadow-penpot-primary-400/20 border border-transparent",
    // Accent alias for primary
    accent:
      "bg-penpot-primary-400 hover:bg-penpot-primary-300 active:bg-penpot-primary-500 text-white shadow-lg shadow-penpot-primary-400/20 border border-transparent",
    // Secondary solid white (Penpot #FFFFFF with dark text #1A1D29 for Play / Request CTAs)
    secondary:
      "bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-neutral-600 shadow-xl border border-transparent",
    // Play CTA (white background with dark icon/text)
    play:
      "bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-neutral-600 shadow-xl border border-transparent",
    // Request CTA (white background with dark icon/text)
    request:
      "bg-white hover:bg-penpot-neutral-200 active:bg-penpot-neutral-300 text-penpot-neutral-600 shadow-xl border border-transparent",
    // Outline / Translucent Glass with solid white border (Penpot More Information CTA)
    outline:
      "bg-black/20 hover:bg-white/20 active:bg-white/30 text-white border border-white backdrop-blur-md shadow-lg",
    // Outlined alias
    outlined:
      "bg-black/20 hover:bg-white/20 active:bg-white/30 text-white border border-white backdrop-blur-md shadow-lg",
    // More Information CTA
    moreInfo:
      "bg-black/20 hover:bg-white/20 active:bg-white/30 text-white border border-white backdrop-blur-md shadow-lg",
    // Ghost / Translucent without border
    ghost:
      "bg-transparent text-penpot-text-high hover:bg-penpot-opacity-white-10 active:bg-penpot-opacity-white-20 border border-transparent",
    // Destructive / Danger
    danger:
      "bg-red-600 hover:bg-red-500 active:bg-red-700 text-white shadow-lg shadow-red-600/25 border border-transparent",
    // Muted / Disabled state container
    muted:
      "bg-penpot-surface text-penpot-neutral-200 border border-penpot-border opacity-90",
  }

  const sizeStyles: Record<ButtonSize, string> = {
    sm: "h-9 min-h-[36px] px-3.5 py-1.5 text-xs rounded-[4px] gap-2",
    md: "h-11 min-h-[44px] sm:h-12 sm:min-h-[48px] px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm md:text-base rounded-[4px] gap-2.5",
    lg: "h-14 min-h-[56px] px-7 sm:px-8 py-3.5 text-base sm:text-lg rounded-[4px] gap-3",
    icon: "size-11 min-h-[44px] min-w-[44px] sm:size-12 sm:min-h-[48px] sm:min-w-[48px] p-0 rounded-[4px] flex items-center justify-center",
    "icon-sm": "size-9 min-h-[36px] min-w-[36px] p-0 rounded-[4px] flex items-center justify-center",
  }

  return cn(
    "inline-flex items-center justify-center font-bold tracking-wider uppercase font-sans select-none transition-all duration-150 active:scale-[0.98] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-penpot-primary-300 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
    variantStyles[variant],
    sizeStyles[size],
    className
  )
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={buttonVariants({ variant, size, className })}
        {...props}
      />
    )
  }
)

Button.displayName = "Button"
