import { cn } from "@/lib/utils"

type BadgeVariant = "default" | "success" | "warning" | "accent"

const variants: Record<BadgeVariant, string> = {
  default: "bg-muted text-foreground",
  success: "bg-success text-black",
  warning: "bg-warning text-black",
  accent: "bg-accent text-white",
}

export function Badge({
  className,
  variant = "default",
  children,
}: {
  className?: string
  variant?: BadgeVariant
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-none px-2 py-0.5 text-xs font-medium",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  )
}
