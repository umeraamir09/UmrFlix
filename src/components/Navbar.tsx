"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Suspense, useState, useEffect, useRef } from "react"
import { SearchBar } from "@/components/SearchBar"
import { Check, ChevronDown, Menu, Settings } from "lucide-react"
import { IconSearch, IconClose, IconDownloadNav, IconUser } from "@/components/ui/icons"
import { usePlayerSettings, type SubtitleMode } from "@/lib/player-settings"

const SUBTITLE_MODE_OPTIONS: { id: SubtitleMode; label: string; description: string }[] = [
  {
    id: "client",
    label: "Client-side subtitles",
    description: "Rendered over the video — switch instantly, custom styling (default)",
  },
  {
    id: "burn",
    label: "Burn subtitles into video",
    description: "Transcoded into the stream by the server on every playback",
  },
]

const NAV_LINKS = [
  { href: "/popular", label: "Popular" },
  { href: "/movies", label: "Movies" },
  { href: "/tv-shows", label: "Tv Shows" },
]

const QUICK_LINKS = [
  { href: "/search", label: "Browse All (A-Z)" },
  { href: "/popular", label: "Popular Movies" },
  { href: "/tv-shows", label: "TV Shows" },
  { href: "/library", label: "My Library" },
]

const CATEGORIES = [
  "Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary",
  "Drama", "Family", "Fantasy", "Horror", "Mystery", "Romance", "Sci-Fi", "Thriller"
]

export function Navbar() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const [playerSettings, updatePlayerSettings] = usePlayerSettings()

  // Close search & settings menu on route change (adjusted during render,
  // not in an effect, per react.dev "you might not need an effect")
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setSearchOpen(false)
    setSettingsOpen(false)
  }

  // Close settings menu on click-outside
  useEffect(() => {
    if (!settingsOpen) return
    const close = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [settingsOpen])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false)
        setSettingsOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <header className="fixed top-0 z-50 w-full bg-nav-bg border-b border-border-subtle backdrop-blur-md transition-colors shadow-lg">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-4 sm:px-6 md:px-8 relative">

        {/* Normal Header View */}
        <div className="flex items-center gap-6 h-full">
          <Link href="/" className="flex items-center gap-2 group pr-2">
            <Image
              src="/logo_header.png"
              alt="UmrFlix Logo"
              width={140}
              height={36}
              className="h-8 w-auto object-contain transition-all duration-200 group-hover:brightness-0 group-hover:invert"
              priority
            />
          </Link>

          {/* Desktop Nav Items */}
          <nav className="hidden items-center h-full md:flex">
            {NAV_LINKS.map((link) => {
              const isActive = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`h-full flex items-center px-4 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-surface text-white"
                      : "text-foreground-muted hover:bg-surface-hover hover:text-white"
                  }`}
                >
                  {link.label}
                </Link>
              )
            })}

            {/* Categories Dropdown Container */}
            <div className="relative h-full flex items-center" onMouseLeave={() => setCategoriesOpen(false)}>
              <button
                onMouseEnter={() => setCategoriesOpen(true)}
                onClick={() => setCategoriesOpen(!categoriesOpen)}
                className={`h-full flex items-center gap-1.5 px-4 text-sm font-medium transition-colors ${
                  categoriesOpen
                    ? "bg-surface-hover text-white"
                    : "text-foreground-muted hover:bg-surface-hover hover:text-white"
                }`}
              >
                <span>Categories</span>
                <ChevronDown
                  className={`size-4 transition-transform duration-200 ${
                    categoriesOpen ? "rotate-180 text-white" : "text-foreground-muted"
                  }`}
                />
              </button>

              {categoriesOpen && (
                <div
                  className="absolute top-full left-0 w-[640px] border border-border border-t-0 bg-surface-hover p-6 shadow-2xl backdrop-blur-xl flex gap-6 animate-in fade-in slide-in-from-top-1 duration-150 z-50 rounded-none"
                  onMouseEnter={() => setCategoriesOpen(true)}
                >
                  {/* Left Column: Quick links */}
                  <div className="w-52 flex flex-col gap-1.5 pr-6 border-r border-border shrink-0">
                    {QUICK_LINKS.map((quick) => (
                      <Link
                        key={quick.href}
                        href={quick.href}
                        className="rounded-none px-3 py-2 text-sm font-medium text-gray-200 hover:bg-surface-hover-alt hover:text-white transition-colors"
                        onClick={() => setCategoriesOpen(false)}
                      >
                        {quick.label}
                      </Link>
                    ))}
                  </div>

                  {/* Right Column: Genres Grid */}
                  <div className="flex-1">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3.5 block">
                      GENRES
                    </span>
                    <div className="grid grid-cols-3 gap-x-6 gap-y-3">
                      {CATEGORIES.map((cat) => (
                        <Link
                          key={cat}
                          href={`/search?genre=${encodeURIComponent(cat)}`}
                          className="text-sm font-medium text-foreground-muted hover:text-white transition-colors"
                          onClick={() => setCategoriesOpen(false)}
                        >
                          {cat}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Vertical Separator */}
            <div className="h-4 w-px bg-separator mx-2 self-center" />

            {/* My Library */}
            <Link
              href="/library"
              className={`h-full flex items-center px-4 text-sm font-medium transition-colors ${
                pathname === "/library"
                  ? "bg-surface text-white"
                  : "text-foreground-muted hover:bg-surface-hover hover:text-white"
              }`}
            >
              My Library
            </Link>
          </nav>
        </div>

        {/* Right Section */}
        <div className="flex items-center h-full">
          {/* Search Button */}
          <Link
            href="/search"
            className="h-full flex items-center justify-center px-3.5 text-foreground-muted hover:text-white hover:bg-surface-hover transition-colors"
            title="Search Catalog"
          >
            <IconSearch className="size-5" />
          </Link>

          {/* Watchlist */}
          <Link
            href="/library"
            title="Watchlist / My Library"
            className="h-full flex items-center justify-center px-3.5 text-foreground-muted hover:text-white hover:bg-surface-hover transition-colors"
          >
            <IconDownloadNav className="size-5" />
          </Link>

          {/* User Profile / Settings */}
          <div ref={settingsRef} className="relative hidden sm:flex h-full items-center">
            <button
              onClick={() => setSettingsOpen((o) => !o)}
              className={`h-full flex items-center justify-center px-3.5 transition-colors ${
                settingsOpen
                  ? "bg-surface-hover text-white"
                  : "text-gray-200 hover:text-white hover:bg-surface-hover"
              }`}
              title="Settings"
              aria-label="Settings"
              aria-expanded={settingsOpen}
            >
              <IconUser className="size-6" />
            </button>

            {settingsOpen && (
              <div className="absolute right-0 top-full w-80 border border-border border-t-0 bg-surface-hover shadow-2xl backdrop-blur-xl rounded-none animate-in fade-in slide-in-from-top-1 duration-150 z-50">
                {/* Header */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <Settings className="size-4 text-accent" />
                  <span className="text-xs font-black uppercase tracking-widest text-white">
                    Settings
                  </span>
                </div>

                {/* Subtitle mode */}
                <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-widest text-gray-400">
                  Subtitles
                </div>
                <div className="pb-2">
                  {SUBTITLE_MODE_OPTIONS.map((opt) => {
                    const selected = playerSettings.subtitleMode === opt.id
                    return (
                      <button
                        key={opt.id}
                        onClick={() => updatePlayerSettings({ subtitleMode: opt.id })}
                        className={`w-full flex items-start justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                          selected ? "bg-surface" : "hover:bg-surface"
                        }`}
                      >
                        <span className="min-w-0">
                          <span className={`block text-sm font-semibold ${selected ? "text-white" : "text-gray-200"}`}>
                            {opt.label}
                          </span>
                          <span className="block text-[11px] font-normal text-gray-400 mt-0.5 leading-snug">
                            {opt.description}
                          </span>
                        </span>
                        {selected && <Check className="mt-0.5 size-4 shrink-0 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Mobile Drawer Trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-full flex items-center justify-center px-3 text-gray-300 md:hidden hover:text-white hover:bg-surface-hover transition-colors"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <IconClose className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>

        {/* Sliding Full-Width Search Overlay */}
        {searchOpen && (
          <div
            ref={searchContainerRef}
            className="absolute inset-x-0 top-0 h-16 bg-surface flex items-center justify-between px-4 sm:px-6 md:px-8 z-50 animate-in fade-in slide-in-from-top-4 duration-200"
          >
            <div className="flex-1 max-w-4xl mx-auto flex items-center gap-4">
              <div className="flex-1">
                <Suspense fallback={<div className="h-9 w-full bg-card rounded-none animate-pulse" />}>
                  <SearchBar />
                </Suspense>
              </div>
              <button
                onClick={() => setSearchOpen(false)}
                className="flex items-center justify-center p-2 text-gray-400 hover:text-white rounded-none hover:bg-gray-800/50 transition-colors"
                title="Close Search"
              >
                <IconClose className="size-5" />
              </button>
            </div>
          </div>
        )}

      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="border-b border-border bg-surface px-6 py-5 md:hidden space-y-4 animate-in fade-in duration-200">
          <div className="space-y-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-none text-base font-medium text-gray-200 hover:bg-card-hover hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/library"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-none text-base font-medium text-gray-200 hover:bg-card-hover hover:text-white transition-colors"
            >
              My Library
            </Link>
          </div>
          <div className="pt-3 border-t border-border">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Genres</p>
            <div className="grid grid-cols-2 gap-2.5">
              {CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  href={`/search?genre=${encodeURIComponent(cat)}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium text-foreground-muted hover:text-white transition-colors"
                >
                  {cat}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

