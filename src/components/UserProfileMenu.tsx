"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { LogIn } from "lucide-react"
import useSWR, { mutate } from "swr"

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
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data, isLoading: loading } = useSWR<{
    authenticated?: boolean
    user?: UserProfile
  }>("/api/auth/me", { revalidateOnFocus: false })

  const user = data?.authenticated ? data?.user ?? null : null

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
      setOpen(false)
      mutate("/api/auth/me", { authenticated: false, user: null }, false)
      window.location.href = "/login"
    } catch {
      /* silent error */
    }
  }

  if (loading) {
    return <div className="size-10 rounded-full bg-penpot-surface animate-pulse border-2 border-penpot-border" />
  }

  // If user is NOT signed in, render Sign In button
  if (!user) {
    return (
      <Link
        href="/login"
        className="flex items-center gap-1.5 px-4 py-2 rounded-[4px] bg-penpot-primary-300 hover:bg-penpot-primary-400 text-white text-xs font-bold uppercase tracking-wider transition-all shadow-md active:scale-95"
      >
        <LogIn className="size-3.5" />
        <span>SIGN IN</span>
      </Link>
    )
  }

  const initial = user.username.charAt(0).toUpperCase()

  return (
    <div className="relative h-full flex items-center" ref={menuRef}>
      {/* Navbar Avatar Trigger Button (Penpot Ellipse 6 with penpot-secondary-200 border) */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-full transition-all focus:outline-none hover:scale-105 cursor-pointer"
        title={`Account: ${user.username}`}
        aria-label="User Account Menu"
        aria-expanded={open}
      >
        <div className="size-10 sm:size-11 rounded-full border-2 border-penpot-secondary-200 bg-penpot-neutral-700 overflow-hidden flex items-center justify-center shrink-0 shadow-md">
          {user.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={user.avatarUrl}
              alt={user.username}
              className="size-full object-cover"
            />
          ) : (
            <div className="size-full bg-penpot-neutral-700 text-penpot-secondary-200 flex items-center justify-center text-sm font-bold">
              {initial}
            </div>
          )}
        </div>
        <span className="text-xs font-semibold text-penpot-text-high hidden lg:inline-block max-w-[90px] truncate">
          {user.username}
        </span>
      </button>

      {/* Penpot MenuUser Dropdown Board */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          {/* Pointer Triangle (Penpot Vector 2 / 3) */}
          <div className="relative">
            <svg
              className="absolute -top-3 right-4 w-4 h-3 z-10 drop-shadow-sm pointer-events-none"
              viewBox="0 0 18 14"
              fill="none"
            >
              <path
                d="M9 1L17 13H1L9 1Z"
                className="fill-penpot-neutral-700 stroke-penpot-border"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              {/* Bottom patch to blend seamlessly with container border */}
              <line x1="1.5" y1="13.5" x2="16.5" y2="13.5" className="stroke-penpot-neutral-700" strokeWidth="2" />
            </svg>

            {/* MenuUser Container (248px width, penpot-neutral-700 bg, penpot-border border, 8px radius) */}
            <div className="w-[248px] bg-penpot-neutral-700 border border-penpot-border rounded-[8px] p-5 shadow-2xl backdrop-blur-xl">
              
              {/* Header Section (Frame 39: Ellipse 9 + Username) */}
              <div className="flex items-center gap-4 pb-5 border-b border-penpot-border/60">
                <div className="size-12 rounded-full overflow-hidden bg-penpot-surface shrink-0 shadow-md">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.avatarUrl}
                      alt={user.username}
                      className="size-full object-cover"
                    />
                  ) : (
                    <div className="size-full bg-penpot-neutral-800 text-penpot-secondary-200 flex items-center justify-center text-lg font-bold uppercase">
                      {initial}
                    </div>
                  )}
                </div>
                <span className="text-base font-normal text-penpot-text-high/90 truncate tracking-normal">
                  {user.username}
                </span>
              </div>

              {/* Navigation Links (Frame 41: Edit Profile, My List, Admin Dashboard, Library, Settings, Logout) */}
              <div className="pt-4 flex flex-col gap-4 text-base font-normal">
                <Link
                  href="/account/avatar"
                  onClick={() => setOpen(false)}
                  className="text-white hover:text-penpot-secondary-200 transition-colors"
                >
                  Edit Profile
                </Link>

                <Link
                  href="/my-list"
                  onClick={() => setOpen(false)}
                  className="text-white hover:text-penpot-secondary-200 transition-colors"
                >
                  My List
                </Link>

                {user.isAdmin && (
                  <Link
                    href="/admin"
                    onClick={() => setOpen(false)}
                    className="text-penpot-link font-bold hover:text-penpot-secondary-200 transition-colors"
                  >
                    Admin Dashboard
                  </Link>
                )}

                <Link
                  href="/library"
                  onClick={() => setOpen(false)}
                  className="text-white hover:text-penpot-secondary-200 transition-colors"
                >
                  Library
                </Link>

                <Link
                  href="/account/preferences"
                  onClick={() => setOpen(false)}
                  className="text-white hover:text-penpot-secondary-200 transition-colors"
                >
                  Settings
                </Link>

                <button
                  onClick={handleLogout}
                  className="text-white hover:text-red-400 transition-colors text-left cursor-pointer"
                >
                  Logout
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}

