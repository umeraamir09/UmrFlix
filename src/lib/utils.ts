import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getImageUrl(path: string | null | undefined, size: "w92" | "w154" | "w185" | "w342" | "w500" | "w780" | "original" = "w500"): string {
  if (!path) return "/placeholder-poster.svg"
  return `https://image.tmdb.org/t/p/${size}${path}`
}

export function formatRating(vote: number): string {
  return (vote / 2).toFixed(1)
}

export function formatDate(date: string): string {
  if (!date) return "Unknown"
  return new Date(date).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
}

export function formatYear(date: string): string {
  if (!date) return ""
  return date.split("-")[0] ?? ""
}

export function formatRuntime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}
