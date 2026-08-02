"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  LogOut,
  Bookmark,
  Settings,
  Pencil,
  History,
  LogIn,
  ShieldCheck,
} from "lucide-react"

export type UserProfile = {
  userId: string
  username: string
  isAdmin: boolean
  enableDownloading: boolean
  avatarUrl?: string
  serverUrl?: string
  dailyRequestsCount?: number
}

export function UserProfileMenu() {
  const router = useRouter()
  const [user, setUser] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

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
    return <div className="size-8 rounded-full bg-surface animate-pulse border border-border" />
  }

  // If user is NOT signed in, render Sign In button
  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-1.5 px-4 py-2 rounded-none bg-accent hover:bg-accent-hover text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95"
      >
        <LogIn className="size-3.5" />
        <span>SIGN IN</span>
      </Link>
    )
  }

  const initial = user.username.charAt(0).toUpperCase()

  return (
    <div className="relative h-full flex items-center " ref={menuRef}>
      {/* Navbar Avatar Trigger Button */}
      <button
        onClick={() => setOpen(!open)}
        className={`h-full flex items-center gap-2 px-2.5 rounded-none transition-colors hover:cursor-pointer ${
          open ? "bg-white/10 text-white" : "text-white/80 hover:text-gray-300"
        }`}
        title={`Account: ${user.username}`}
        aria-label="User Account Menu"
        aria-expanded={open}
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt={user.username}
            className="size-7 object-cover rounded-sm shrink-0"
          />
        ) : (
          <div className="size-7 bg-accent text-white flex items-center justify-center text-xs font-black uppercase shadow-md shrink-0">
            {initial}
          </div>
        )}
        <span className="text-xs font-bold uppercase tracking-wider hidden md:inline-block max-w-[100px] truncate">
          {user.username}
        </span>
      </button>

      {/* Crunchyroll-Inspired Avatar Dropdown Menu */}
      {open && (
        <div className="absolute right-0 top-full w-72 sm:w-80 border border-border border-t-0 bg-[#141519] shadow-2xl backdrop-blur-xl rounded-none animate-in fade-in slide-in-from-top-1 duration-150 z-50 text-xs text-gray-200">
          
          {/* Header Section: Avatar, Username, Pencil Icon */}
          <div className="p-4 flex items-center justify-between border-b border-border/80 bg-surface/50">
            <div className="flex items-center gap-3">
              {user.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={user.avatarUrl}
                  alt={user.username}
                  className="size-11 rounded-sm object-cover shadow-md"
                />
              ) : (
                <div className="size-11 rounded-full bg-accent text-white flex items-center justify-center text-base font-black uppercase shadow-md">
                  {initial}
                </div>
              )}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-bold text-white tracking-tight">{user.username}</span>
                  {user.isAdmin && (
                    <span title="Admin User">
                      <ShieldCheck className="size-4 text-amber-400" />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-foreground-muted font-medium">
                  {user.isAdmin ? "Administrator" : "Member"}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setOpen(false)
                router.push("/account/avatar")
              }}
              className="p-1.5 text-gray-400 hover:text-white transition-colors rounded-none hover:bg-surface-hover"
              title="Edit Profile Avatar"
            >
              <Pencil className="size-4" />
            </button>
          </div>

          {/* Promotional / Premium Banner Button */}
          {/* <div className="p-3 border-b border-border/80 bg-surface/30">
            <button
              onClick={() => router.push("/my-list")}
              className="w-full flex items-center justify-center gap-2 bg-[#fab818] hover:bg-[#e0a412] text-black font-black text-xs uppercase tracking-wider py-2.5 rounded-none shadow-md transition-all active:scale-[0.99] cursor-pointer"
            >
              <Crown className="size-4 fill-black" />
              <span>GO PREMIUM</span>
            </button>
          </div> */}

          {/* Group 1: Switch Profile & Settings */}
          <div className="py-1 border-b border-border/80">
            {/* <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors text-left font-medium cursor-pointer"
            >
              <ArrowLeftRight className="size-4 text-gray-400" />
              <span className="text-sm">Switch Profile</span>
            </button> */}

            <Link
              href="/account/preferences"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors text-left font-medium"
            >
              <Settings className="size-4 text-gray-400" />
              <span className="text-sm">Settings</span>
            </Link>
          </div>

          {/* Group 2: Requests, Watchlist & Library / History */}
          <div className="py-1 border-b border-border/80">
            <Link
              href="/requests"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors font-medium"
            >
              <History className="size-4 text-accent" />
              <span className="text-sm">My Requests</span>
            </Link>

            <Link
              href="/my-list"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors font-medium"
            >
              <Bookmark className="size-4 text-gray-400" />
              <span className="text-sm">Watchlist</span>
            </Link>

            <Link
              href="/library"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors font-medium"
            >
              <History className="size-4 text-gray-400" />
              <span className="text-sm">My Library & History</span>
            </Link>

            {user.isAdmin && (
              <Link
                href="/admin"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3.5 px-4 py-3 hover:bg-surface-hover transition-colors font-bold border-t border-border/40"
              >
                <ShieldCheck className="size-4" />
                <span className="text-sm">Admin Dashboard</span>
              </Link>
            )}
          </div>

          {/* Group 3: Notifications
          <div className="py-1 border-b border-border/80">
            <div className="flex items-center justify-between px-4 py-3 text-gray-200 hover:bg-surface-hover hover:text-white transition-colors font-medium cursor-pointer">
              <div className="flex items-center gap-3.5">
                <Bell className="size-4 text-gray-400" />
                <span className="text-sm">Notifications</span>
              </div>
              <span className="size-2 rounded-full bg-accent" title="System Status Active" />
            </div>
          </div> */}

          {/* Group 4: Log Out */}
          <div className="py-1">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3.5 px-4 py-3 text-gray-200 hover:bg-accent/15 hover:text-accent transition-colors text-left font-medium cursor-pointer"
            >
              <LogOut className="size-4 text-gray-400 group-hover:text-accent" />
              <span className="text-sm font-semibold">Log Out</span>
            </button>
          </div>

        </div>
      )}
    </div>
  )
}
