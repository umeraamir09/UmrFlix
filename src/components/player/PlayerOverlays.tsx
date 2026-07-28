"use client"

import Image from "next/image"
import { History, Loader2, Play, SkipForward, TriangleAlert, X } from "lucide-react"

export function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m)
  const ss = String(sec).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// ── Resume playback modal ──

export function ResumeModal({
  positionSeconds,
  onResume,
  onStartFromBeginning,
}: {
  positionSeconds: number
  onResume: () => void
  onStartFromBeginning: () => void
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-xl border border-[#282c37] bg-[#141519] p-6 shadow-2xl">
        <div className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-accent">
          <History className="size-4" />
          Continue Watching
        </div>
        <h3 className="text-xl font-bold text-white">
          Resume from {formatTimecode(positionSeconds)}?
        </h3>
        <p className="mt-1 text-sm text-gray-400">
          You stopped watching here last time.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={onResume}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
          >
            <Play className="size-4 fill-white" />
            Resume {formatTimecode(positionSeconds)}
          </button>
          <button
            onClick={onStartFromBeginning}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-[#282c37] bg-[#1a1c23] px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
          >
            Start from Beginning
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Skip intro / recap floating button ──

const SKIP_LABELS: Record<string, string> = {
  intro: "Skip Intro",
  recap: "Skip Recap",
  credits: "Skip Credits",
  preview: "Skip Preview",
}

export function SkipSegmentButton({
  type,
  onSkip,
  raised = false,
}: {
  type: string
  onSkip: () => void
  raised?: boolean
}) {
  return (
    <button
      onClick={onSkip}
      className={`absolute right-6 z-30 flex items-center gap-2 rounded-none bg-white px-5 py-2.5 text-sm font-bold tracking-widest text-black backdrop-blur transition-all hover:border-accent hover:bg-accent ${
        raised ? "bottom-40" : "bottom-28"
      }`}
    >
      {SKIP_LABELS[type] ?? "Skip"}
      <SkipForward className="size-5" />
    </button>
  )
}

// ── Next episode auto-play countdown ──

export type NextEpisodeInfo = {
  id: string
  title: string
  label: string // e.g. "S1:E3"
  imageUrl?: string
}

export function NextEpisodeOverlay({
  next,
  countdownSeconds,
  onPlayNow,
  onCancel,
}: {
  next: NextEpisodeInfo
  countdownSeconds: number
  onPlayNow: () => void
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-gradient-to-t from-black/95 via-black/60 to-black/40">
      <div className="flex flex-col items-center gap-4 px-4 text-center">
        <span className="text-xs font-bold uppercase tracking-[0.3em] text-accent">
          Up Next
        </span>
        {next.imageUrl && (
          <span className="relative block aspect-video w-72 overflow-hidden rounded-lg border border-[#282c37] shadow-2xl">
            <Image
              src={next.imageUrl}
              alt={next.title}
              fill
              sizes="288px"
              className="object-cover"
              unoptimized
            />
          </span>
        )}
        <div>
          <p className="text-sm font-semibold text-gray-400">{next.label}</p>
          <h3 className="mt-0.5 max-w-md text-2xl font-black text-white line-clamp-2">
            {next.title}
          </h3>
        </div>
        <p className="text-sm text-gray-400">
          Auto-playing in{" "}
          <span className="font-black tabular-nums text-white">{countdownSeconds}s</span>
        </p>
        <div className="mt-1 flex items-center gap-3">
          <button
            onClick={onPlayNow}
            className="flex items-center gap-2 rounded-md bg-accent px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
          >
            <Play className="size-4 fill-white" />
            Play Now
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-2 rounded-md border border-[#282c37] bg-[#1a1c23]/80 px-6 py-2.5 text-sm font-bold uppercase tracking-wider text-gray-200 transition-colors hover:border-gray-500 hover:text-white"
          >
            <X className="size-4" />
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Compact "Up Next" pill shown during credits markers ──

export function CreditsNextEpisodePill({
  next,
  onPlayNow,
  onDismiss,
}: {
  next: NextEpisodeInfo
  onPlayNow: () => void
  onDismiss: () => void
}) {
  return (
    <div className="absolute bottom-28 right-6 z-30 flex items-center gap-3 rounded-lg border border-[#282c37] bg-black/85 p-3 backdrop-blur">
      <button
        onClick={onPlayNow}
        className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
      >
        <Play className="size-3.5 fill-white" />
        Up Next — {next.label}
      </button>
      <button
        onClick={onDismiss}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// ── Loading / error states ──

export function PlayerLoading({ message = "Loading stream…" }: { message?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/60">
      <Loader2 className="size-20 animate-spin text-white" />
      <p className="text-sm font-medium text-gray-300">{message}</p>
    </div>
  )
}

export function PlayerError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-[#0a0b0d] p-6">
      <TriangleAlert className="size-10 text-accent" />
      <p className="max-w-md text-center text-sm text-gray-300">{message}</p>
      <button
        onClick={onRetry}
        className="rounded-md bg-accent px-5 py-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-accent-hover"
      >
        Retry
      </button>
    </div>
  )
}
