"use client"

import { cn } from "@/lib/utils"
import { forwardRef } from "react"

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent"

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: "sm" | "md" | "lg"
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover border border-transparent",
  secondary: "bg-card border border-border text-foreground hover:bg-card-hover",
  ghost: "text-foreground hover:bg-card-hover border border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-700 border border-transparent",
  accent: "bg-accent text-white hover:bg-accent-hover border border-transparent",
}

const sizes = {
  sm: "px-3 py-1.5 text-xs font-bold uppercase tracking-wider",
  md: "px-4 py-2 text-xs sm:text-sm font-bold uppercase tracking-wider",
  lg: "px-5 sm:px-6 py-3 text-xs sm:text-sm font-bold uppercase tracking-wider",
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-none font-bold uppercase tracking-wider transition-all active:scale-95 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
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
