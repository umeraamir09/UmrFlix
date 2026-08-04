"use client"

import { cn } from "@/lib/utils"
import { forwardRef } from "react"

export type ButtonVariant = "primary" | "secondary" | "play" | "moreInfo" | "outlined" | "ghost" | "danger" | "accent"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: "sm" | "md" | "lg"
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[#E50914] text-white hover:bg-[#C11119] border border-transparent shadow-md active:bg-[#B80710]",
  secondary: "bg-[#262626] border border-[#333333] text-white hover:bg-[#333333]",
  play: "bg-white text-black hover:bg-[#E5E5E5] active:bg-[#DCDCDC] border border-transparent shadow-md",
  moreInfo: "bg-[rgba(109,109,110,0.7)] text-white hover:bg-[rgba(109,109,110,0.4)] border border-transparent backdrop-blur-sm",
  outlined: "bg-transparent border border-[#808080] text-[#808080] hover:border-white hover:text-white",
  ghost: "text-white hover:bg-[rgba(255,255,255,0.15)] border border-transparent",
  danger: "bg-[#E50914] text-white hover:bg-[#C11119] border border-transparent",
  accent: "bg-[#E50914] text-white hover:bg-[#C11119] border border-transparent",
}

const sizes = {
  sm: "px-3 py-1.5 text-xs font-semibold rounded-[4px]",
  md: "px-4 py-2 text-sm font-semibold rounded-[4px]",
  lg: "px-6 py-3 text-base font-semibold rounded-[4px]",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition-all duration-200 active:scale-[0.98] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

