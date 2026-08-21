import { cn } from "@/lib/utils"

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-[8px] bg-penpot-surface/60 border border-penpot-border/40", className)}
    />
  )
}

