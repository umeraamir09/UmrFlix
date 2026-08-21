"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  Settings,
  ShieldCheck,
  Check,
  Server,
  Film,
  Volume2,
  Sliders,
  Keyboard,
  Activity,
  User,
  Play,
  RotateCcw,
  Sparkles,
  Zap,
  LogOut,
  Trash2,
  Monitor,
  CheckCircle2,
} from "lucide-react"
import {
  usePlayerSettings,
  type SubtitleMode,
  DEFAULT_PLAYER_SETTINGS,
} from "@/lib/player-settings"
import {
  loadSubtitleStyle,
  saveSubtitleStyle,
  DEFAULT_SUBTITLE_STYLE,
  type SubtitleStyle,
} from "@/components/player/SubtitleOverlay"

type UserProfile = {
  userId: string
  username: string
  isAdmin: boolean
  enableDownloading: boolean
  avatarUrl?: string
  serverUrl?: string
  dailyRequestsCount?: number
}

type SettingsTab = "account" | "playback" | "subtitles" | "shortcuts" | "diagnostics"

const SUBTITLE_MODE_OPTIONS: { id: SubtitleMode; label: string; badge: string; description: string }[] = [
  {
    id: "client",
    label: "Client-Side Subtitles",
    badge: "Recommended",
    description:
      "Renders SRT, VTT, and ASS tracks directly in the browser. Enables instant track switching, custom fonts, colors, and zero-latency seek.",
  },
  {
    id: "burn",
    label: "Server Burn-In Subtitles",
    badge: "Transcoded",
    description:
      "Burns subtitles directly into the video stream via Jellyfin transcoder. Recommended only if your browser has issues rendering complex subtitle tracks. Burned subtitles are rendered by the server and do not use the appearance settings below.",
  },
]

const QUALITY_PRESETS = [
  { id: "auto", label: "Auto (Adaptive)", desc: "Automatically adjusts to your network speed" },
  { id: "4k", label: "4K Ultra HD", desc: "Maximum bitrate and direct stream resolution" },
  { id: "1080p-20m", label: "1080p FHD (20 Mbps)", desc: "Very high fidelity streaming" },
  { id: "1080p-10m", label: "1080p FHD (10 Mbps)", desc: "Standard high definition" },
  { id: "720p-4m", label: "720p HD (4 Mbps)", desc: "Data saver for slower connections" },
]

const AUDIO_LANGUAGES = [
  { id: "original", label: "Original / Default" },
  { id: "eng", label: "English" },
  { id: "jpn", label: "Japanese" },
  { id: "spa", label: "Spanish" },
  { id: "fre", label: "French" },
  { id: "deu", label: "German" },
  { id: "ita", label: "Italian" },
]

const SUBTITLE_LANGUAGES = [
  { id: "none", label: "Off by default" },
  { id: "eng", label: "English" },
  { id: "spa", label: "Spanish" },
  { id: "fre", label: "French" },
  { id: "jpn", label: "Japanese" },
  { id: "deu", label: "German" },
  { id: "ita", label: "Italian" },
]

const SKIP_INTERVALS = [5, 10, 15, 30]
const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0]

const SUBTITLE_SIZES: { id: string; label: string; cssSize: string; mult: number }[] = [
  { id: "small", label: "Small", cssSize: "text-sm", mult: 0.7 },
  { id: "medium", label: "Medium", cssSize: "text-base sm:text-lg", mult: 1 },
  { id: "large", label: "Large", cssSize: "text-xl sm:text-2xl", mult: 1.4 },
  { id: "extra-large", label: "Extra Large", cssSize: "text-2xl sm:text-3xl", mult: 1.8 },
]

const SUBTITLE_COLORS: { id: string; label: string; hex: string }[] = [
  { id: "white", label: "Classic White", hex: "#FFFFFF" },
  { id: "yellow", label: "Cinema Yellow", hex: "#FFD700" },
  { id: "cyan", label: "Cyan Blue", hex: "#02E7F5" },
]

const OPACITY_OPTIONS: { id: number; label: string }[] = [
  { id: 0, label: "0% (None)" },
  { id: 25, label: "25%" },
  { id: 50, label: "50%" },
  { id: 75, label: "75%" },
  { id: 100, label: "100%" },
]

const KEYBOARD_SHORTCUTS = [
  { keys: ["Space", "K"], label: "Play / Pause playback" },
  { keys: ["F"], label: "Toggle fullscreen mode" },
  { keys: ["M"], label: "Mute / Unmute audio" },
  { keys: ["←", "→"], label: "Skip backward / forward (configurable)" },
  { keys: ["↑", "↓"], label: "Volume up / down by 5%" },
  { keys: ["C"], label: "Toggle subtitles on / off" },
  { keys: ["S"], label: "Cycle playback speed (1x → 2x)" },
  { keys: ["N"], label: "Jump to next episode in season" },
  { keys: ["Esc"], label: "Exit fullscreen or close open menus" },
  { keys: ["?"], label: "Toggle technical Debug HUD overlay" },
]

export default function AccountPreferencesPage() {
  const [playerSettings, updatePlayerSettings] = usePlayerSettings()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "") as SettingsTab
      if (["account", "playback", "subtitles", "shortcuts", "diagnostics"].includes(hash)) {
        return hash
      }
    }
    return "playback"
  })
  const [savedBanner, setSavedBanner] = useState(false)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [pinging, setPinging] = useState(false)

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
        /* silent */
      } finally {
        setLoading(false)
      }
    }
    fetchMe()
  }, [])

  const handleUpdate = (patch: Parameters<typeof updatePlayerSettings>[0]) => {
    updatePlayerSettings(patch)
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 2200)
  }

  // Subtitle appearance (size / color / background) lives in the same
  // localStorage store the player overlay reads from ("umrflix.substyle"),
  // so settings saved here take effect during playback immediately.
  const [subStyle, setSubStyle] = useState<SubtitleStyle>(() => loadSubtitleStyle())

  const handleSubStyle = (patch: Partial<SubtitleStyle>) => {
    const next = { ...subStyle, ...patch }
    setSubStyle(next)
    saveSubtitleStyle(next)
    setSavedBanner(true)
    setTimeout(() => setSavedBanner(false), 2200)
  }

  const handleResetDefaults = () => {
    if (confirm("Reset all player and subtitle preferences to their default settings?")) {
      updatePlayerSettings(DEFAULT_PLAYER_SETTINGS)
      setSubStyle(DEFAULT_SUBTITLE_STYLE)
      saveSubtitleStyle(DEFAULT_SUBTITLE_STYLE)
      setSavedBanner(true)
      setTimeout(() => setSavedBanner(false), 2200)
    }
  }

  const handleClearCache = () => {
    if (confirm("Clear local playback cache and stored player preferences?")) {
      localStorage.removeItem("umrflix.playerSettings")
      localStorage.removeItem("umrflix.substyle")
      localStorage.removeItem("umrflix.session")
      window.location.reload()
    }
  }

  const handleTestPing = async () => {
    setPinging(true)
    const start = performance.now()
    try {
      await fetch("/api/auth/me", { cache: "no-store" })
      const duration = Math.round(performance.now() - start)
      setPingMs(duration)
    } catch {
      setPingMs(-1)
    } finally {
      setPinging(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      window.location.href = "/login"
    } catch {
      /* silent */
    }
  }

  const previewSizeClass =
    (SUBTITLE_SIZES.find((s) => s.mult === subStyle.size) ?? SUBTITLE_SIZES[1]).cssSize

  return (
    <div className="min-h-[100dvh] bg-penpot-bg text-penpot-text-high pt-24 pb-20 px-4 sm:px-6 md:px-10 max-w-[1380px] mx-auto space-y-8 font-sans">
      
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-[16px] bg-gradient-to-r from-penpot-neutral-700 via-penpot-surface to-penpot-neutral-700 border border-penpot-border p-6 sm:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-penpot-primary-300/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        
        <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="size-12 sm:size-14 rounded-[12px] bg-penpot-primary-300/20 border border-penpot-primary-300/40 flex items-center justify-center text-penpot-primary-200 shadow-inner">
              <Settings className="size-6 sm:size-7 animate-[spin_12s_linear_infinite]" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-penpot-link">
                <span>UmrFlix Client</span>
                <span>•</span>
                <span className="text-penpot-secondary-200">System Preferences</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mt-0.5">
                Settings & Account
              </h1>
              <p className="text-xs sm:text-sm text-penpot-text-medium mt-1">
                Customize playback performance, subtitle typography, audio tracks, and account controls.
              </p>
            </div>
          </div>

          {/* Quick Actions / Save Feedback Indicator */}
          <div className="flex items-center gap-3 self-start sm:self-center">
            {savedBanner ? (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 text-xs font-bold animate-in fade-in zoom-in-95 duration-200 shadow-lg">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>Preferences Saved</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-penpot-neutral-800/80 border border-penpot-border text-penpot-text-subtle text-xs">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Settings Auto-Synced</span>
              </div>
            )}
            
            <button
              onClick={handleResetDefaults}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-penpot-surface hover:bg-penpot-surface-hover border border-penpot-border text-penpot-text-medium hover:text-white text-xs font-semibold transition-all cursor-pointer active:scale-95"
              title="Reset all settings to default"
            >
              <RotateCcw className="size-3.5" />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar Tabs + Active Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Navigation Sidebar */}
        <div className="lg:col-span-3 space-y-4">
          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar bg-penpot-neutral-700/80 border border-penpot-border rounded-[12px] p-2 shadow-xl backdrop-blur-md">
            
            <button
              onClick={() => { setActiveTab("playback"); window.location.hash = "playback" }}
              className={`flex items-center gap-3 px-4 py-3 rounded-[8px] text-xs sm:text-sm font-semibold transition-all text-left whitespace-nowrap cursor-pointer ${
                activeTab === "playback"
                  ? "bg-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/30"
                  : "text-penpot-text-medium hover:text-white hover:bg-penpot-surface/60"
              }`}
            >
              <Play className="size-4 shrink-0" />
              <span>Playback & Streaming</span>
            </button>

            <button
              onClick={() => { setActiveTab("subtitles"); window.location.hash = "subtitles" }}
              className={`flex items-center gap-3 px-4 py-3 rounded-[8px] text-xs sm:text-sm font-semibold transition-all text-left whitespace-nowrap cursor-pointer ${
                activeTab === "subtitles"
                  ? "bg-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/30"
                  : "text-penpot-text-medium hover:text-white hover:bg-penpot-surface/60"
              }`}
            >
              <Film className="size-4 shrink-0" />
              <span>Subtitles & Audio</span>
            </button>

            <button
              onClick={() => { setActiveTab("account"); window.location.hash = "account" }}
              className={`flex items-center gap-3 px-4 py-3 rounded-[8px] text-xs sm:text-sm font-semibold transition-all text-left whitespace-nowrap cursor-pointer ${
                activeTab === "account"
                  ? "bg-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/30"
                  : "text-penpot-text-medium hover:text-white hover:bg-penpot-surface/60"
              }`}
            >
              <User className="size-4 shrink-0" />
              <span>Account & Profile</span>
            </button>

            <button
              onClick={() => { setActiveTab("shortcuts"); window.location.hash = "shortcuts" }}
              className={`flex items-center gap-3 px-4 py-3 rounded-[8px] text-xs sm:text-sm font-semibold transition-all text-left whitespace-nowrap cursor-pointer ${
                activeTab === "shortcuts"
                  ? "bg-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/30"
                  : "text-penpot-text-medium hover:text-white hover:bg-penpot-surface/60"
              }`}
            >
              <Keyboard className="size-4 shrink-0" />
              <span>Shortcuts & Controls</span>
            </button>

            <button
              onClick={() => { setActiveTab("diagnostics"); window.location.hash = "diagnostics" }}
              className={`flex items-center gap-3 px-4 py-3 rounded-[8px] text-xs sm:text-sm font-semibold transition-all text-left whitespace-nowrap cursor-pointer ${
                activeTab === "diagnostics"
                  ? "bg-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/30"
                  : "text-penpot-text-medium hover:text-white hover:bg-penpot-surface/60"
              }`}
            >
              <Activity className="size-4 shrink-0" />
              <span>Server & Diagnostics</span>
            </button>

          </nav>

          {/* Quick Account Mini-Card in sidebar */}
          {user && (
            <div className="hidden lg:block bg-penpot-neutral-700/60 border border-penpot-border rounded-[12px] p-4 space-y-3 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full border border-penpot-secondary-200 bg-penpot-neutral-800 overflow-hidden shrink-0 flex items-center justify-center font-bold text-penpot-secondary-200">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.avatarUrl} alt={user.username} className="size-full object-cover" />
                  ) : (
                    user.username.charAt(0).toUpperCase()
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{user.username}</div>
                  <div className="text-[11px] text-penpot-text-subtle truncate">
                    {user.isAdmin ? "Administrator" : "Standard Member"}
                  </div>
                </div>
              </div>
              <Link
                href="/account/avatar"
                className="block text-center w-full py-1.5 rounded-[6px] bg-penpot-surface hover:bg-penpot-surface-hover text-penpot-link text-xs font-semibold transition-colors border border-penpot-border"
              >
                Change Avatar
              </Link>
            </div>
          )}
        </div>

        {/* Tab Content Panel */}
        <div className="lg:col-span-9 space-y-6">

          {/* TAB 1: PLAYBACK & STREAMING */}
          {activeTab === "playback" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Quality Preference Card */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-5 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Sliders className="size-5 text-penpot-secondary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Default Video Quality</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Set your default streaming bitrate. Adaptive adjusts automatically to network stability.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {QUALITY_PRESETS.map((preset) => {
                    const isSelected = (playerSettings.qualityPreference || "auto") === preset.id
                    return (
                      <button
                        key={preset.id}
                        onClick={() => handleUpdate({ qualityPreference: preset.id })}
                        className={`flex items-start justify-between gap-3 p-3.5 rounded-[10px] text-left transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-penpot-primary-300/15 border-penpot-primary-300 text-white shadow-md shadow-penpot-primary-300/10 ring-1 ring-penpot-primary-300"
                            : "bg-penpot-surface/40 hover:bg-penpot-surface border-penpot-border text-penpot-text-medium hover:text-white"
                        }`}
                      >
                        <div className="space-y-0.5">
                          <span className={`block text-xs font-bold ${isSelected ? "text-penpot-link" : "text-white"}`}>
                            {preset.label}
                          </span>
                          <span className="block text-[11px] text-penpot-text-subtle leading-normal">
                            {preset.desc}
                          </span>
                        </div>
                        {isSelected && <Check className="size-4 shrink-0 text-penpot-secondary-200 mt-0.5" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Playback Behaviors Card */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-5 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Play className="size-5 text-penpot-primary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Playback Automation</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Manage autoplay sequences, intro skips, and transport seek steps.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  
                  {/* Auto-Play Next Episode */}
                  <div className="flex items-center justify-between gap-4 p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border">
                    <div className="space-y-0.5">
                      <div className="text-xs sm:text-sm font-bold text-white">Auto-Play Next Episode</div>
                      <div className="text-xs text-penpot-text-subtle">
                        Automatically advance to the next season episode when the credits roll.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={playerSettings.autoPlayNext ?? true}
                        onChange={(e) => handleUpdate({ autoPlayNext: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-penpot-neutral-500 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-penpot-primary-300" />
                    </label>
                  </div>

                  {/* Auto-Skip Intros */}
                  <div className="flex items-center justify-between gap-4 p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border">
                    <div className="space-y-0.5">
                      <div className="text-xs sm:text-sm font-bold text-white">Auto-Skip Intro & Recaps</div>
                      <div className="text-xs text-penpot-text-subtle">
                        Automatically skip detected intro markers without requiring manual button clicks.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={playerSettings.autoSkipIntro ?? false}
                        onChange={(e) => handleUpdate({ autoSkipIntro: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-penpot-neutral-500 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-penpot-primary-300" />
                    </label>
                  </div>

                  {/* Skip Step Duration */}
                  <div className="p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border space-y-3">
                    <div className="space-y-0.5">
                      <div className="text-xs sm:text-sm font-bold text-white">Skip Interval Duration</div>
                      <div className="text-xs text-penpot-text-subtle">
                        Number of seconds skipped when using arrow keys, transport buttons, or double-tap gestures.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {SKIP_INTERVALS.map((sec) => {
                        const isSelected = (playerSettings.skipInterval || 10) === sec
                        return (
                          <button
                            key={sec}
                            onClick={() => handleUpdate({ skipInterval: sec })}
                            className={`px-3.5 py-1.5 rounded-[8px] text-xs font-bold transition-all border cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            ±{sec} Seconds
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Default Playback Speed */}
                  <div className="p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border space-y-3">
                    <div className="space-y-0.5">
                      <div className="text-xs sm:text-sm font-bold text-white">Default Playback Rate</div>
                      <div className="text-xs text-penpot-text-subtle">
                        Standard playback speed initialized when starting video streams.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {PLAYBACK_SPEEDS.map((spd) => {
                        const isSelected = (playerSettings.defaultPlaybackRate || 1.0) === spd
                        return (
                          <button
                            key={spd}
                            onClick={() => handleUpdate({ defaultPlaybackRate: spd })}
                            className={`px-3.5 py-1.5 rounded-[8px] text-xs font-bold transition-all border cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            {spd}x {spd === 1.0 ? "(Normal)" : ""}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                </div>
              </div>

            </div>
          )}

          {/* TAB 2: SUBTITLES & AUDIO */}
          {activeTab === "subtitles" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Subtitle Rendering Mode Selection */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-5 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Film className="size-5 text-penpot-secondary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Subtitle Delivery Engine</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Select how subtitles are processed and rendered during stream playback.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SUBTITLE_MODE_OPTIONS.map((opt) => {
                    const isSelected = playerSettings.subtitleMode === opt.id
                    return (
                      <button
                        key={opt.id}
                        onClick={() => handleUpdate({ subtitleMode: opt.id })}
                        className={`flex flex-col justify-between gap-3 p-4 rounded-[12px] text-left transition-all border cursor-pointer ${
                          isSelected
                            ? "bg-penpot-primary-300/15 border-penpot-primary-300 text-white shadow-lg ring-1 ring-penpot-primary-300"
                            : "bg-penpot-surface/40 hover:bg-penpot-surface border-penpot-border text-penpot-text-medium hover:text-white"
                        }`}
                      >
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className={`text-xs sm:text-sm font-bold ${isSelected ? "text-penpot-link" : "text-white"}`}>
                              {opt.label}
                            </span>
                            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[4px] border ${
                              isSelected
                                ? "bg-penpot-secondary-200/20 text-penpot-secondary-200 border-penpot-secondary-200/30"
                                : "bg-penpot-neutral-500/40 text-penpot-text-subtle border-penpot-border"
                            }`}>
                              {opt.badge}
                            </span>
                          </div>
                          <p className="text-xs text-penpot-text-subtle leading-relaxed">
                            {opt.description}
                          </p>
                        </div>
                        {isSelected && (
                          <div className="flex items-center gap-1.5 text-xs text-penpot-secondary-200 font-semibold pt-2 border-t border-penpot-primary-300/30">
                            <Check className="size-4" /> Active Subtitle Engine
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Interactive Live Cinema Subtitle Preview Studio */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-penpot-border/80 pb-4">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="size-5 text-penpot-secondary-200" />
                    <div>
                      <h2 className="text-base font-bold text-white">Subtitle Appearance Studio</h2>
                      <p className="text-xs text-penpot-text-subtle">
                        Live interactive preview for client-side subtitle overlays.
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-penpot-link px-2.5 py-1 rounded-[6px] bg-penpot-surface border border-penpot-border">
                    Live Preview
                  </span>
                </div>

                {/* Simulated Cinema Screen Backdrop */}
                <div className="relative aspect-video max-h-56 sm:max-h-64 w-full rounded-[12px] overflow-hidden border border-penpot-border/80 bg-gradient-to-tr from-black via-slate-900 to-indigo-950 flex flex-col justify-between p-4 shadow-2xl select-none">
                  {/* Atmospheric Glow Lines */}
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-penpot-primary-300/15 via-transparent to-black/80 pointer-events-none" />
                  
                  {/* Top Mockup Cinema Info */}
                  <div className="relative z-10 flex items-center justify-between text-[10px] font-mono text-penpot-text-subtle">
                    <div className="flex items-center gap-2">
                      <span className="size-2 rounded-full bg-emerald-400" />
                      <span>STREAM: 4K HDR • 24.000 FPS</span>
                    </div>
                    <span>00:42:15 / 02:18:30</span>
                  </div>

                  {/* Centered Live Subtitle Text Overlay */}
                  <div className="relative z-10 text-center pb-2">
                    <span
                      className={`inline-block font-medium tracking-wide px-3 py-1 rounded-[4px] shadow-lg transition-all duration-150 ${previewSizeClass}`}
                      style={{
                        color: subStyle.color,
                        backgroundColor: `rgba(0, 0, 0, ${subStyle.bgOpacity})`,
                        textShadow: "0 2px 4px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0,0,0,0.8)",
                      }}
                    >
                      Welcome to UmrFlix • Streaming in Ultra High Definition
                    </span>
                  </div>
                </div>

                {/* Subtitle Appearance Controls */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-2">
                  
                  {/* Font Size Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-penpot-text-medium">
                      Font Size
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {SUBTITLE_SIZES.map((size) => {
                        const isSelected = subStyle.size === size.mult
                        return (
                          <button
                            key={size.id}
                            onClick={() => handleSubStyle({ size: size.mult })}
                            className={`px-3 py-2 rounded-[8px] text-xs font-semibold transition-all border cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            {size.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Font Color Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-penpot-text-medium">
                      Font Color
                    </label>
                    <div className="flex flex-col gap-2">
                      {SUBTITLE_COLORS.map((col) => {
                        const isSelected = subStyle.color.toLowerCase() === col.hex.toLowerCase()
                        return (
                          <button
                            key={col.id}
                            onClick={() => handleSubStyle({ color: col.hex })}
                            className={`flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-xs font-semibold transition-all border cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300/20 border-penpot-primary-300 text-white"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            <span
                              className="size-3.5 rounded-full border border-white/40 shrink-0 shadow-sm"
                              style={{ backgroundColor: col.hex }}
                            />
                            <span>{col.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Background Opacity Selector */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-penpot-text-medium">
                      Background Box Opacity
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {OPACITY_OPTIONS.map((op) => {
                        const isSelected = Math.round(subStyle.bgOpacity * 100) === op.id
                        return (
                          <button
                            key={op.id}
                            onClick={() => handleSubStyle({ bgOpacity: op.id / 100 })}
                            className={`px-3 py-2 rounded-[8px] text-xs font-semibold transition-all border cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            {op.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                </div>
              </div>

              {/* Language Preferences Card */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-5 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Volume2 className="size-5 text-penpot-primary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Language Defaults</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Automatically prioritize audio and subtitle tracks matching your language. Track choices you make in the player are remembered per movie or series and take priority.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {/* Preferred Audio Language */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-penpot-text-medium">
                      Preferred Audio Track
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {AUDIO_LANGUAGES.map((lang) => {
                        const isSelected = (playerSettings.preferredAudioLanguage || "original") === lang.id
                        return (
                          <button
                            key={lang.id}
                            onClick={() => handleUpdate({ preferredAudioLanguage: lang.id })}
                            className={`px-3 py-2 rounded-[8px] text-xs font-semibold transition-all border text-left cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            {lang.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Preferred Subtitle Language */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold uppercase tracking-wider text-penpot-text-medium">
                      Preferred Subtitle Track
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {SUBTITLE_LANGUAGES.map((lang) => {
                        const isSelected = (playerSettings.preferredSubtitleLanguage || "none") === lang.id
                        return (
                          <button
                            key={lang.id}
                            onClick={() => handleUpdate({ preferredSubtitleLanguage: lang.id })}
                            className={`px-3 py-2 rounded-[8px] text-xs font-semibold transition-all border text-left cursor-pointer ${
                              isSelected
                                ? "bg-penpot-primary-300 border-penpot-primary-300 text-white shadow-sm"
                                : "bg-penpot-surface hover:bg-penpot-surface-hover border-penpot-border text-penpot-text-medium"
                            }`}
                          >
                            {lang.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 3: ACCOUNT & PROFILE */}
          {activeTab === "account" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              {/* Profile Overview Card */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-penpot-border/80 pb-4">
                  <div className="flex items-center gap-2.5">
                    <User className="size-5 text-penpot-secondary-200" />
                    <div>
                      <h2 className="text-base font-bold text-white">Jellyfin Profile</h2>
                      <p className="text-xs text-penpot-text-subtle">
                        Manage your connected account identity and server privileges.
                      </p>
                    </div>
                  </div>
                  {user?.isAdmin && (
                    <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2.5 py-1 rounded-[6px] bg-amber-500/20 text-amber-400 font-bold border border-amber-500/40">
                      <ShieldCheck className="size-3.5" /> Administrator
                    </span>
                  )}
                </div>

                {loading ? (
                  <div className="space-y-3 animate-pulse">
                    <div className="h-16 bg-penpot-surface rounded-[10px]" />
                    <div className="h-12 bg-penpot-surface rounded-[10px]" />
                  </div>
                ) : user ? (
                  <div className="space-y-5">
                    
                    {/* User Identity Banner */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border">
                      <div className="flex items-center gap-4">
                        <div className="size-16 rounded-full border-2 border-penpot-secondary-200 bg-penpot-neutral-800 overflow-hidden shrink-0 flex items-center justify-center font-black text-xl text-penpot-secondary-200 shadow-md">
                          {user.avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={user.avatarUrl} alt={user.username} className="size-full object-cover" />
                          ) : (
                            user.username.charAt(0).toUpperCase()
                          )}
                        </div>
                        <div>
                          <div className="text-lg font-bold text-white">{user.username}</div>
                          <div className="text-xs text-penpot-text-subtle font-mono mt-0.5">
                            ID: {user.userId}
                          </div>
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-penpot-surface border border-penpot-border text-penpot-text-medium">
                              Direct Stream: Enabled
                            </span>
                            <span className="text-[11px] px-2 py-0.5 rounded-[4px] bg-penpot-surface border border-penpot-border text-penpot-text-medium">
                              Downloads: {user.enableDownloading ? "Allowed" : "Disabled"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <Link
                        href="/account/avatar"
                        className="self-start sm:self-center px-4 py-2 rounded-[8px] bg-penpot-primary-300 hover:bg-penpot-primary-400 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95 text-center"
                      >
                        Change Avatar
                      </Link>
                    </div>

                    {/* Daily Request Quota Tracker */}
                    <div className="p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">Daily TMDB / Jellyfin Request Quota</span>
                        <span className="text-penpot-link font-semibold">
                          {user.isAdmin ? "Unlimited (Admin)" : `${user.dailyRequestsCount ?? 0} / 5 used today`}
                        </span>
                      </div>
                      {!user.isAdmin && (
                        <div className="w-full bg-penpot-neutral-800 h-2 rounded-full overflow-hidden border border-penpot-border">
                          <div
                            className="bg-penpot-primary-300 h-full rounded-full transition-all duration-300"
                            style={{ width: `${Math.min(100, ((user.dailyRequestsCount ?? 0) / 5) * 100)}%` }}
                          />
                        </div>
                      )}
                      <p className="text-[11px] text-penpot-text-subtle">
                        Quotas automatically refresh daily at midnight. Admins have unlimited media requests.
                      </p>
                    </div>

                    {/* Server Connection Information */}
                    {user.serverUrl && (
                      <div className="flex items-center justify-between p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border">
                        <div className="flex items-center gap-3">
                          <Server className="size-5 text-penpot-secondary-200 shrink-0" />
                          <div>
                            <div className="text-xs font-bold text-white">Primary Jellyfin Host</div>
                            <div className="text-xs text-penpot-text-subtle font-mono">
                              {user.serverUrl}
                            </div>
                          </div>
                        </div>
                        <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-semibold px-2.5 py-1 rounded-[6px] bg-emerald-500/10 border border-emerald-500/30">
                          <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                          Online
                        </span>
                      </div>
                    )}

                  </div>
                ) : (
                  <div className="text-center py-8 text-penpot-text-subtle text-sm">
                    No active Jellyfin session found. Please sign in.
                  </div>
                )}
              </div>

              {/* Data & Cache Management Card */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-4 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Trash2 className="size-5 text-red-400" />
                  <div>
                    <h2 className="text-base font-bold text-white">Data & Session Management</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Reset stored browser tokens or terminate your active session.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    onClick={handleClearCache}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-penpot-surface hover:bg-penpot-surface-hover border border-penpot-border text-penpot-text-medium hover:text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    <Trash2 className="size-4 text-penpot-text-subtle" />
                    <span>Clear Local Player Cache</span>
                  </button>

                  <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-[8px] bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 hover:text-red-200 text-xs font-bold transition-all cursor-pointer"
                  >
                    <LogOut className="size-4" />
                    <span>Sign Out of UmrFlix</span>
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: KEYBOARD & CONTROLS */}
          {activeTab === "shortcuts" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-6 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Keyboard className="size-5 text-penpot-secondary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Keyboard Shortcuts Cheatsheet</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Accelerate playback control in fullscreen cinema mode with hotkeys.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {KEYBOARD_SHORTCUTS.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-3.5 rounded-[10px] bg-penpot-surface/40 border border-penpot-border"
                    >
                      <span className="text-xs text-penpot-text-medium font-medium">
                        {item.label}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className="px-2.5 py-1 rounded-[6px] bg-penpot-neutral-800 border border-penpot-border text-penpot-link font-mono text-xs font-bold shadow-inner"
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mobile Touch Controls Guide */}
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-4 shadow-xl">
                <div className="flex items-center gap-2.5 border-b border-penpot-border/80 pb-4">
                  <Monitor className="size-5 text-penpot-primary-200" />
                  <div>
                    <h2 className="text-base font-bold text-white">Touch Gestures (Mobile & Tablet)</h2>
                    <p className="text-xs text-penpot-text-subtle">
                      Optimized touch controls for phones, tablets, and iPad devices.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div className="p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border space-y-1">
                    <div className="text-xs font-bold text-white">Single Tap</div>
                    <div className="text-xs text-penpot-text-subtle">
                      Show or hide transport overlay controls and playback scrubber.
                    </div>
                  </div>
                  <div className="p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border space-y-1">
                    <div className="text-xs font-bold text-white">Double Tap Sides</div>
                    <div className="text-xs text-penpot-text-subtle">
                      Double-tap left or right half of the screen to skip ±10 seconds.
                    </div>
                  </div>
                  <div className="p-4 rounded-[10px] bg-penpot-surface/40 border border-penpot-border space-y-1">
                    <div className="text-xs font-bold text-white">Lock Screen Mode</div>
                    <div className="text-xs text-penpot-text-subtle">
                      Tap lock icon to prevent accidental touches during movie playback.
                    </div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* TAB 5: SERVER & DIAGNOSTICS */}
          {activeTab === "diagnostics" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              
              <div className="bg-penpot-neutral-700/90 border border-penpot-border rounded-[16px] p-6 space-y-6 shadow-xl">
                <div className="flex items-center justify-between border-b border-penpot-border/80 pb-4">
                  <div className="flex items-center gap-2.5">
                    <Activity className="size-5 text-penpot-secondary-200" />
                    <div>
                      <h2 className="text-base font-bold text-white">Server Health & Diagnostics</h2>
                      <p className="text-xs text-penpot-text-subtle">
                        Live connection latency, microservice status, and client versioning.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleTestPing}
                    disabled={pinging}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-penpot-primary-300 hover:bg-penpot-primary-400 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Zap className="size-3.5" />
                    <span>{pinging ? "Testing..." : "Test Latency"}</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  
                  {/* Jellyfin Status */}
                  <div className="p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-penpot-text-medium font-semibold">Jellyfin Media Server</span>
                      <span className="size-2 rounded-full bg-emerald-400 animate-pulse" />
                    </div>
                    <div className="text-base font-bold text-white">Online & Healthy</div>
                    <div className="text-[11px] text-penpot-text-subtle font-mono">
                      {pingMs !== null ? (
                        <span className="text-emerald-400 font-bold">{pingMs}ms response time</span>
                      ) : (
                        "Click 'Test Latency' to ping"
                      )}
                    </div>
                  </div>

                  {/* Watch Party Sync Protocol */}
                  <div className="p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-penpot-text-medium font-semibold">Watch Party Engine</span>
                      <span className="size-2 rounded-full bg-emerald-400" />
                    </div>
                    <div className="text-base font-bold text-white">Active (v2.1 Protocol)</div>
                    <div className="text-[11px] text-penpot-text-subtle">
                      Adaptive buffer pause & time-sync enabled
                    </div>
                  </div>

                  {/* HLS Video Pipeline */}
                  <div className="p-4 rounded-[12px] bg-penpot-surface/40 border border-penpot-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-penpot-text-medium font-semibold">Client Video Engine</span>
                      <span className="size-2 rounded-full bg-penpot-secondary-200" />
                    </div>
                    <div className="text-base font-bold text-white">HLS.js + WebVTT</div>
                    <div className="text-[11px] text-penpot-text-subtle">
                      Native Web Audio + Subtitle Overlay
                    </div>
                  </div>

                </div>

                {/* Application Build Info */}
                <div className="p-4 rounded-[12px] bg-penpot-neutral-800 border border-penpot-border space-y-2 text-xs font-mono text-penpot-text-subtle">
                  <div className="flex items-center justify-between">
                    <span className="text-penpot-text-medium font-bold">UmrFlix Version:</span>
                    <span className="text-penpot-link">v2.4.0-release</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-penpot-text-medium font-bold">Framework:</span>
                    <span>Next.js 16 (App Router) • React 19</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-penpot-text-medium font-bold">Design Tokens:</span>
                    <span>Penpot / Satoshi UI Theme</span>
                  </div>
                </div>

              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  )
}

