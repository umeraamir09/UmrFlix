"use client"

import { useState, useEffect } from "react"
import { usePlayerSettings, type SubtitleMode } from "@/lib/player-settings"
import { Settings, ShieldCheck, UserCheck, Check, Server, Film, Volume2, HardDrive } from "lucide-react"

type UserProfile = {
  userId: string
  username: string
  isAdmin: boolean
  enableDownloading: boolean
  serverUrl?: string
  dailyRequestsCount?: number
}

const SUBTITLE_MODE_OPTIONS: { id: SubtitleMode; label: string; description: string }[] = [
  {
    id: "client",
    label: "Client-Side Subtitles (Recommended)",
    description:
      "Subtitles (SRT, VTT, ASS) are rendered natively over the video player. Instant track switching and custom subtitle styling (font size, color, background opacity) are enabled.",
  },
  {
    id: "burn",
    label: "Burn Subtitles into Video Stream",
    description:
      "Selected subtitle tracks are transcoded directly into the video stream by the Jellyfin server. Use if client-side rendering encounters browser rendering glitches.",
  },
]

export default function AccountPreferencesPage() {
  const [playerSettings, updatePlayerSettings] = usePlayerSettings()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = await res.json()
          if (data.authenticated && data.user) {
            setUser(data.user)
          }
        }
      } catch {
        /* silent error */
      } finally {
        setLoading(false)
      }
    }
    fetchMe()
  }, [])

  return (
    <div className="min-h-[100dvh] bg-background text-foreground pt-24 pb-16 px-4 sm:px-6 md:px-8 max-w-[1200px] mx-auto space-y-8">
      {/* Header Banner */}
      <div className="border-b border-border pb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-none bg-surface border border-border text-accent">
            <Settings className="size-6 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-white">
              Account Preferences & Settings
            </h1>
            <p className="text-xs text-foreground-muted mt-1">
              Manage your streaming preferences, subtitle rendering, and Jellyfin account details.
            </p>
          </div>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Column: Account Profile Card */}
        <div className="space-y-6">
          <div className="bg-surface border border-border rounded-none p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-foreground-muted border-b border-border pb-3">
              <UserCheck className="size-4 text-accent" />
              <span>Jellyfin User Account</span>
            </div>

            {loading ? (
              <div className="space-y-2 animate-pulse">
                <div className="h-4 bg-background w-3/4" />
                <div className="h-3 bg-background w-1/2" />
              </div>
            ) : user ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-white text-base truncate">{user.username}</span>
                  {user.isAdmin ? (
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-none bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                      <ShieldCheck className="size-3" /> ADMIN
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-none bg-gray-500/20 text-gray-300 font-bold border border-gray-500/30">
                      <UserCheck className="size-3" /> MEMBER
                    </span>
                  )}
                </div>

                {user.serverUrl && (
                  <div className="flex items-center gap-2 text-xs text-foreground-muted">
                    <Server className="size-3.5 text-muted shrink-0" />
                    <span className="truncate">{user.serverUrl.replace(/^https?:\/\//, "")}</span>
                  </div>
                )}

                <div className="pt-2 border-t border-border/60 text-xs text-muted space-y-1">
                  <p>Daily Request Quota: {user.isAdmin ? "Unlimited (Admin)" : `${user.dailyRequestsCount ?? 0} / 5 used today`}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted">Not authenticated</p>
            )}
          </div>
        </div>

        {/* Right Column: Extensible Settings Sections */}
        <div className="md:col-span-2 space-y-8">
          
          {/* Section 1: Subtitle Preferences */}
          <div className="bg-surface border border-border rounded-none p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Film className="size-4 text-accent" />
                <span>Subtitle Preferences</span>
              </h2>
            </div>

            <p className="text-xs text-foreground-muted">
              Choose how subtitles are processed during video playback.
            </p>

            <div className="space-y-3 pt-2">
              {SUBTITLE_MODE_OPTIONS.map((opt) => {
                const selected = playerSettings.subtitleMode === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => updatePlayerSettings({ subtitleMode: opt.id })}
                    className={`w-full flex items-start justify-between gap-4 p-4 rounded-none text-left transition-all border ${
                      selected
                        ? "bg-background border-accent text-white shadow-lg"
                        : "bg-surface hover:bg-surface-hover border-border text-gray-400"
                    }`}
                  >
                    <div className="space-y-1">
                      <span className={`block text-xs font-bold uppercase tracking-wide ${selected ? "text-accent" : "text-gray-200"}`}>
                        {opt.label}
                      </span>
                      <span className="block text-xs text-muted leading-relaxed font-normal">
                        {opt.description}
                      </span>
                    </div>
                    {selected && <Check className="size-5 shrink-0 text-accent mt-0.5" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Section 2: Audio & Stream Preferences (Extensible Placeholder) */}
          <div className="bg-surface border border-border rounded-none p-6 space-y-3 shadow-xl opacity-75">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Volume2 className="size-4 text-gray-400" />
                <span>Audio & Preferred Languages</span>
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border border-border text-muted">
                COMING SOON
              </span>
            </div>
            <p className="text-xs text-muted">
              Configure default audio stream tracks and preferred spoken languages.
            </p>
          </div>

          {/* Section 3: Media Server & Automation Settings (Extensible Placeholder) */}
          <div className="bg-surface border border-border rounded-none p-6 space-y-3 shadow-xl opacity-75">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <HardDrive className="size-4 text-gray-400" />
                <span>Automation & Quality Profiles</span>
              </h2>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 border border-border text-muted">
                COMING SOON
              </span>
            </div>
            <p className="text-xs text-muted">
              Configure default Radarr and Sonarr request quality profiles and download destinations.
            </p>
          </div>

        </div>
      </div>
    </div>
  )
}
