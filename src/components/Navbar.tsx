"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { Suspense, useState, useEffect, useRef } from "react"
import { SearchBar } from "@/components/SearchBar"
import { ChevronDown, Menu } from "lucide-react"
import { IconSearch, IconClose, IconDownloadNav } from "@/components/ui/icons"
import { UserProfileMenu } from "@/components/UserProfileMenu"
import { NotificationBell } from "@/components/NotificationBell"
import { useEventStream } from "@/lib/use-event-stream"
import { ServiceHealthBanner } from "@/components/ServiceHealthBanner"
import { GENRE_CATALOG } from "@/lib/genres"

const NAV_LINKS = [
  { href: "/popular", label: "Popular" },
  { href: "/movies", label: "Movies" },
  { href: "/tv-shows", label: "Tv Shows" },
  { href: "/my-list", label: "My List" },
]

const QUICK_LINKS = [
  { href: "/popular", label: "Popular Movies" },
  { href: "/tv-shows", label: "TV Shows" },
  { href: "/library", label: "My Library" },
]

export function Navbar() {
  useEventStream()

  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    handleScroll()
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Close search menu on route change
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setSearchOpen(false)
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSearchOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  return (
    <header
      className={`fixed top-0 z-50 w-full transition-all duration-300 ${
        scrolled
          ? "bg-black/90 backdrop-blur-md shadow-lg"
          : "bg-gradient-to-b from-black/90 via-black/40 to-transparent"
      }`}
    >
      <ServiceHealthBanner />
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
                  className={`h-full flex items-center px-3.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-white font-bold"
                      : "text-[#B3B3B3] hover:text-[#E5E5E5]"
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
                className={`h-full flex items-center gap-1.5 px-3.5 text-sm font-semibold transition-colors ${
                  categoriesOpen
                    ? "text-gray-300"
                    : "text-white/80 hover:text-gray-300"
                }`}
              >
                <span>Browse By Genre</span>
                <ChevronDown
                  className={`size-4 transition-transform duration-200 ${
                    categoriesOpen ? "rotate-180 text-gray-300" : "text-white/80"
                  }`}
                />
              </button>

              {categoriesOpen && (
                <div
                  className="absolute top-full left-0 w-[640px] bg-black/95 p-6 shadow-2xl backdrop-blur-xl flex gap-6 animate-in fade-in slide-in-from-top-1 duration-150 z-50 rounded-none"
                  onMouseEnter={() => setCategoriesOpen(true)}
                >
                  {/* Left Column: Quick links */}
                  <div className="w-52 flex flex-col gap-1.5 pr-6 shrink-0">
                    {QUICK_LINKS.map((quick) => (
                      <Link
                        key={quick.href}
                        href={quick.href}
                        className="rounded-none px-3 py-2 text-sm font-medium text-white hover:text-gray-300 hover:bg-white/10 transition-colors"
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
                      {GENRE_CATALOG.map((genre) => (
                        <Link
                          key={genre.slug}
                          href={`/genre/${genre.slug}`}
                          className="text-sm font-medium text-white/80 hover:text-gray-300 transition-colors"
                          onClick={() => setCategoriesOpen(false)}
                        >
                          {genre.name}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* My Library */}
            <Link
              href="/library"
              className={`h-full flex items-center px-3.5 text-sm font-semibold transition-colors ${
                pathname === "/library"
                  ? "text-white font-bold"
                  : "text-white/80 hover:text-gray-300"
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
            className="h-full flex items-center justify-center px-3 text-white/80 hover:text-gray-300 transition-colors"
            title="Search Catalog"
          >
            <IconSearch className="size-5" />
          </Link>

          {/* Watchlist */}
          <Link
            href="/library"
            title="Watchlist / My Library"
            className="h-full flex items-center justify-center px-3 text-white/80 hover:text-gray-300 transition-colors"
          >
            <IconDownloadNav className="size-5" />
          </Link>

          {/* Notification Bell */}
          <div className="h-full flex items-center">
            <NotificationBell />
          </div>

          {/* User Profile & Settings Menu */}
          <div className="px-1 flex items-center h-full">
            <UserProfileMenu />
          </div>

          {/* Mobile Drawer Trigger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-full flex items-center justify-center px-3 text-white hover:text-gray-300 md:hidden transition-colors"
            aria-label="Toggle Navigation Menu"
          >
            {mobileMenuOpen ? <IconClose className="size-6" /> : <Menu className="size-6" />}
          </button>
        </div>

        {/* Sliding Full-Width Search Overlay */}
        {searchOpen && (
          <div
            ref={searchContainerRef}
            className="absolute inset-x-0 top-0 h-16 bg-black/95 backdrop-blur-md flex items-center justify-between px-4 sm:px-6 md:px-8 z-50 animate-in fade-in slide-in-from-top-4 duration-200"
          >
            <div className="flex-1 max-w-4xl mx-auto flex items-center gap-4">
              <div className="flex-1">
                <Suspense fallback={<div className="h-9 w-full bg-white/10 rounded-none animate-pulse" />}>
                  <SearchBar />
                </Suspense>
              </div>
              <button
                onClick={() => setSearchOpen(false)}
                className="flex items-center justify-center p-2 text-white hover:text-gray-300 rounded-none transition-colors"
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
        <div className="bg-black/95 backdrop-blur-xl px-6 py-5 md:hidden space-y-4 animate-in fade-in duration-200">
          <div className="space-y-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="block px-3 py-2 rounded-none text-base font-semibold text-white hover:text-gray-300 transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/library"
              onClick={() => setMobileMenuOpen(false)}
              className="block px-3 py-2 rounded-none text-base font-semibold text-white hover:text-gray-300 transition-colors"
            >
              My Library
            </Link>
          </div>
          <div className="pt-3">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Genres</p>
            <div className="grid grid-cols-2 gap-2.5">
              {GENRE_CATALOG.map((genre) => (
                <Link
                  key={genre.slug}
                  href={`/genre/${genre.slug}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium text-white hover:text-gray-300 transition-colors"
                >
                  {genre.name}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}

