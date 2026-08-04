"use client"

import { cn } from "@/lib/utils"
import { forwardRef } from "react"

export type ButtonVariant = "primary" | "secondary" | "play" | "moreInfo" | "outlined" | "ghost" | "danger" | "accent"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: "sm" | "md" | "lg"
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover border border-transparent rounded-none font-bold uppercase tracking-wider",
  secondary: "bg-card border border-border text-foreground hover:bg-card-hover rounded-none font-bold uppercase tracking-wider",
  ghost: "text-foreground hover:bg-card-hover border border-transparent rounded-none font-bold uppercase tracking-wider",
  danger: "bg-red-600 text-white hover:bg-red-700 border border-transparent rounded-none font-bold uppercase tracking-wider",
  accent: "bg-accent text-white hover:bg-accent-hover border border-transparent rounded-none font-bold uppercase tracking-wider",
  play: "bg-white text-black hover:bg-grey-10 active:bg-grey-20 border border-transparent shadow-md rounded-[4px] font-semibold",
  moreInfo: "bg-grey-300-t70 text-white hover:bg-grey-300-t40 border border-transparent backdrop-blur-sm rounded-[4px] font-semibold",
  outlined: "bg-transparent border border-grey-200 text-grey-200 hover:border-white hover:text-white rounded-[4px] font-semibold",
}

const sizes = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-xs sm:text-sm",
  lg: "px-5 sm:px-6 py-3 text-xs sm:text-sm",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center transition-all active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
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
