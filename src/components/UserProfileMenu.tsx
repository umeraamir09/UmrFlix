"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, Bookmark, ShieldCheck, UserCheck, LogIn, Settings, Check, RefreshCw } from "lucide-react"
import { usePlayerSettings, type SubtitleMode } from "@/lib/player-settings"

export type UserProfile = {
  userId: string
  username: string
  isAdmin: boolean
  enableDownloading: boolean
  avatarUrl?: string
  serverUrl?: string
  dailyRequestsCount?: number
}

const SUBTITLE_MODE_OPTIONS: { id: SubtitleMode; label: string; description: string }[] = [
  {
    id: "client",
    label: "Client-side subtitles",
    description: "Rendered over video (instant switch & custom styling)",
  },
  {
    id: "burn",
    label: "Burn subtitles into stream",
    description: "Transcoded by server into video stream",
  },
]

export function UserProfileMenu() {
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const [playerSettings, updatePlayerSettings] = usePlayerSettings()

  useEffect(() => {
    async function fetchMe() {
      try {
        const res = await fetch("/api/auth/me")
        if (res.ok) {
          const data = await res.json()
          if (data.authenticated && data.user) {
            setUser(data.user)
          } else {
            setUser(null)
          }
        }
      } catch {
        setUser(null)
      } finally {
        setLoading(false)
      }
    }
    fetchMe()
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" })
      setUser(null)
      setOpen(false)
      router.push("/login")
      router.refresh()
    } catch {
      /* silent error */
    }
  }

  if (loading) {
    return <div className="w-8 h-8 rounded-full bg-white/10 animate-pulse" />
  }

  // If user is NOT signed in, render Sign In button
  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-red text-white text-xs font-bold hover:bg-brand-red-hover transition-all shadow-md shadow-brand-red/20 active:scale-95"
      >
        <LogIn className="w-3.5 h-3.5" />
        <span>Sign In</span>
      </Link>
    )
  }

  const initial = user.username.charAt(0).toUpperCase()

  // If user IS signed in, Sign In button is hidden and Avatar Settings Menu is rendered
  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full p-1 border border-white/10 hover:border-brand-red/50 transition-all bg-[#1b1c22] focus:outline-none focus:ring-1 focus:ring-brand-red"
        title={`Account: ${user.username}`}
        aria-label="User Account Menu"
        aria-expanded={open}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-brand-red text-white flex items-center justify-center text-xs font-bold shadow-md shadow-brand-red/20">
            {initial}
          </div>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-[#141519]/95 border border-white/10 shadow-2xl backdrop-blur-xl p-2.5 z-50 animate-fadeIn text-xs text-gray-200 space-y-2">
          {/* User Account Card */}
          <div className="p-3 rounded-xl bg-[#1d1e24] border border-white/5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-extrabold text-white text-sm truncate">{user.username}</span>
              {user.isAdmin ? (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30">
                  <ShieldCheck className="w-3 h-3" /> Admin
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-500/20 text-gray-300 font-bold border border-gray-500/30">
                  <UserCheck className="w-3 h-3" /> Member
                </span>
              )}
            </div>
            {user.serverUrl && (
              <p className="text-[10px] text-gray-400 truncate">
                Server: {user.serverUrl.replace(/^https?:\/\//, "")}
              </p>
            )}
          </div>

          {/* Navigation Links */}
          <div className="space-y-1 pt-0.5">
            <Link
              href="/my-list"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors text-gray-200 hover:text-white font-medium"
            >
              <Bookmark className="w-4 h-4 text-brand-red fill-brand-red/20" />
              <span>My List / Favorites</span>
            </Link>
          </div>

          {/* Subtitle Settings Section */}
          <div className="pt-2 border-t border-white/10 space-y-1">
            <div className="flex items-center gap-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              <Settings className="w-3 h-3 text-brand-red" />
              <span>Subtitle Preferences</span>
            </div>
            <div className="space-y-1 pt-1">
              {SUBTITLE_MODE_OPTIONS.map((opt) => {
                const selected = playerSettings.subtitleMode === opt.id
                return (
                  <button
                    key={opt.id}
                    onClick={() => updatePlayerSettings({ subtitleMode: opt.id })}
                    className={`w-full flex items-start justify-between gap-2 px-3 py-2 rounded-xl text-left transition-colors ${
                      selected ? "bg-brand-red/15 border border-brand-red/30 text-white" : "hover:bg-white/5 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    <div>
                      <span className={`block font-semibold text-xs ${selected ? "text-brand-red" : "text-gray-200"}`}>
                        {opt.label}
                      </span>
                      <span className="block text-[10px] text-gray-400 mt-0.5 leading-snug">
                        {opt.description}
                      </span>
                    </div>
                    {selected && <Check className="w-3.5 h-3.5 text-brand-red mt-0.5 shrink-0" />}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Switch Account / Logout Button */}
          <div className="pt-2 border-t border-white/10">
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-red-500/15 transition-colors text-red-400 font-semibold text-left"
            >
              <div className="flex items-center gap-2">
                <LogOut className="w-4 h-4" />
                <span>Sign Out / Switch Account</span>
              </div>
              <RefreshCw className="w-3 h-3 opacity-60" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
