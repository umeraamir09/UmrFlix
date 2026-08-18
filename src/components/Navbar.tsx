"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, useEffect, useRef } from "react"
import {
  IconHome,
  IconTv,
  IconMovie,
  IconVideoLibrary,
  IconStar,
  IconExpandMore,
  IconPlus,
  IconSearch,
  IconClose,
} from "@/components/ui/icons"
import { UserProfileMenu } from "@/components/UserProfileMenu"
import { NotificationBell } from "@/components/NotificationBell"
import { useEventStream } from "@/lib/use-event-stream"
import { ServiceHealthBanner } from "@/components/ServiceHealthBanner"
import { GENRE_CATALOG } from "@/lib/genres"

const NAV_ITEMS = [
  {
    href: "/",
    label: "Home",
    icon: IconHome,
    exact: true,
  },
  {
    href: "/tvshows",
    label: "Series",
    icon: IconTv,
    matchPrefixes: ["/tvshows", "/tv-shows", "/tv"],
  },
  {
    href: "/movies",
    label: "Movies",
    icon: IconMovie,
    matchPrefixes: ["/movies", "/movie"],
  },
  {
    href: "/my-list",
    label: "My List",
    icon: IconPlus,
    matchPrefixes: ["/my-list"],
  },
]

const QUICK_LINKS = [
  { href: "/popular", label: "Popular Movies" },
  { href: "/tvshows", label: "TV Shows" },
  { href: "/library", label: "My Library" },
]

export function Navbar() {
  useEventStream()

  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20)
    }
    handleScroll()
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  // Close menus on route change during render
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (prevPathname !== pathname) {
    setPrevPathname(pathname)
    setMobileMenuOpen(false)
    setCategoriesOpen(false)
  }

  // Handle escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setCategoriesOpen(false)
        setMobileMenuOpen(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  const categoriesTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const handleOpenCategories = () => {
    if (categoriesTimeoutRef.current) {
      clearTimeout(categoriesTimeoutRef.current)
      categoriesTimeoutRef.current = null
    }
    setCategoriesOpen(true)
  }

  const handleCloseCategories = () => {
    if (categoriesTimeoutRef.current) {
      clearTimeout(categoriesTimeoutRef.current)
    }
    categoriesTimeoutRef.current = setTimeout(() => {
      setCategoriesOpen(false)
    }, 180)
  }

  useEffect(() => {
    return () => {
      if (categoriesTimeoutRef.current) {
        clearTimeout(categoriesTimeoutRef.current)
      }
    }
  }, [])

  function isNavItemActive(item: typeof NAV_ITEMS[number]) {
    if (item.exact) {
      return pathname === item.href
    }
    if (item.matchPrefixes) {
      return item.matchPrefixes.some((p) => pathname === p || pathname?.startsWith(`${p}/`))
    }
    return pathname === item.href
  }

  return (
    <header
      className={`fixed top-0 z-50 w-full pt-safe transition-colors duration-300 ${
        scrolled
          ? "bg-penpot-neutral-700/95 backdrop-blur-md shadow-xl"
          : "bg-gradient-to-b from-penpot-header-dark via-penpot-header-dark/80 to-transparent"
      }`}
    >
      <ServiceHealthBanner />
      <div className="mx-auto flex h-20 max-w-[1600px] items-center justify-between px-4 sm:px-6 md:px-8 relative">

        {/* Left Section: Logo & Nav Links */}
        <div className="flex items-center gap-6 lg:gap-8 h-full">

          {/* UmrFlix Penpot Vector Brand Logo */}
          <Link
            href="/"
            className="flex items-center gap-2.5 transition-transform hover:scale-105 duration-200 focus:outline-none shrink-0"
            aria-label="UmrFlix Home"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/umrflix-logo.svg"
              alt="UmrFlix"
              className="h-9 sm:h-10 w-auto object-contain"
            />
          </Link>

          {/* Desktop Nav Links (Penpot Frame 43) */}
          <nav className="hidden md:flex items-center gap-1.5 lg:gap-2 h-full" aria-label="Main Navigation">
            {NAV_ITEMS.map((item) => {
              const active = isNavItemActive(item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group h-10 flex items-center gap-2 px-3.5 rounded-[4px] text-sm font-medium transition-all ${
                    active
                      ? "text-white font-bold bg-penpot-opacity-white-10"
                      : "text-penpot-text-medium hover:text-white hover:bg-penpot-opacity-white-10"
                  }`}
                >
                  <Icon
                    className={`size-5 transition-colors ${
                      active ? "text-penpot-secondary-200" : "text-penpot-text-medium group-hover:text-penpot-secondary-200"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              )
            })}

            {/* Browse By Genre Dropdown with Invisible Bridge and Grace Window */}
            <div
              className="relative h-full flex items-center"
              onMouseEnter={handleOpenCategories}
              onMouseLeave={handleCloseCategories}
            >
              <button
                onClick={() => setCategoriesOpen((prev) => !prev)}
                className={`group h-10 flex items-center gap-2 px-3.5 rounded-[4px] text-sm font-medium transition-all cursor-pointer ${
                  categoriesOpen || pathname?.startsWith("/genre/")
                    ? "text-white font-bold bg-penpot-opacity-white-10"
                    : "text-penpot-text-medium hover:text-white hover:bg-penpot-opacity-white-10"
                }`}
                aria-expanded={categoriesOpen}
                aria-haspopup="true"
              >
                <IconStar
                  className={`size-5 transition-colors ${
                    categoriesOpen || pathname?.startsWith("/genre/")
                      ? "text-penpot-secondary-200"
                      : "text-penpot-text-medium group-hover:text-penpot-secondary-200"
                  }`}
                />
                <span>Browse by Genre</span>
                <IconExpandMore
                  className={`size-4 transition-transform duration-200 ${
                    categoriesOpen ? "rotate-180 text-penpot-secondary-200" : "text-penpot-text-subtle"
                  }`}
                />
              </button>

              {/* Mega-Dropdown Menu */}
              {categoriesOpen && (
                <div
                  className="absolute top-full left-0 pt-2 w-[580px] max-w-[90vw] z-50 animate-in fade-in slide-in-from-top-1 duration-150"
                  onMouseEnter={handleOpenCategories}
                  onMouseLeave={handleCloseCategories}
                >
                  {/* Pointer Triangle (Penpot Vector 2 & 3) */}
                  <div className="relative">
                    <svg
                      className="absolute -top-3 left-6 w-4 h-3 z-10 drop-shadow-sm pointer-events-none"
                      viewBox="0 0 18 14"
                      fill="none"
                    >
                      <path
                        d="M9 1L17 13H1L9 1Z"
                        className="fill-penpot-neutral-700 stroke-penpot-border"
                        strokeWidth="1.5"
                        strokeLinejoin="round"
                      />
                      <line x1="1.5" y1="13.5" x2="16.5" y2="13.5" className="stroke-penpot-neutral-700" strokeWidth="2" />
                    </svg>

                    {/* Main Container */}
                    <div className="w-full bg-penpot-neutral-700 border border-penpot-border rounded-[8px] p-6 shadow-2xl backdrop-blur-xl flex flex-col md:flex-row gap-6">
                      
                      {/* Left Column: Featured links */}
                      <div className="w-44 flex flex-col gap-2 pr-5 border-r border-penpot-border/60 shrink-0">
                        <span className="text-xs font-normal text-white/40 mb-1 block">
                          Featured
                        </span>
                        {QUICK_LINKS.map((quick) => (
                          <Link
                            key={quick.href}
                            href={quick.href}
                            className="text-base font-normal text-white hover:text-penpot-secondary-200 transition-colors py-1 truncate"
                            onClick={() => setCategoriesOpen(false)}
                          >
                            {quick.label}
                          </Link>
                        ))}
                      </div>

                      {/* Right Column: All Genres Grid */}
                      <div className="flex-1">
                        <span className="text-xs font-normal text-white/40 mb-2 block">
                          All Genres
                        </span>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                          {GENRE_CATALOG.map((genre) => (
                            <Link
                              key={genre.slug}
                              href={`/genre/${genre.slug}`}
                              className="text-sm font-normal text-white/90 hover:text-penpot-secondary-200 transition-colors py-1 truncate"
                              onClick={() => setCategoriesOpen(false)}
                            >
                              {genre.name}
                            </Link>
                          ))}
                        </div>
                      </div>

                    </div>
                  </div>
                </div>
              )}
            </div>
          </nav>
        </div>

        {/* Right Section (Penpot Frame 44): Search, My List, Notifications, Avatar */}
        <div className="flex items-center gap-2 sm:gap-3 h-full">

          {/* Penpot Search (searchInput Board) */}
          <Link
            href="/search"
            className={`h-10 px-3 flex items-center gap-2 rounded-[4px] transition-all ${
              pathname === "/search"
                ? "bg-penpot-opacity-white-10 text-white"
                : "text-penpot-text-medium hover:text-white hover:bg-penpot-opacity-white-10"
            }`}
            title="Search Catalog"
            aria-label="Search media catalog"
          >
            <IconSearch className="size-5 text-penpot-text-medium group-hover:text-penpot-secondary-200" />
            <span className="text-xs font-medium hidden xl:inline-block">Search</span>
          </Link>

          {/* Quick Action: My List / Watchlist (Penpot icon/plus) */}
          <Link
            href="/library"
            className={`h-10 px-3 flex items-center gap-2 rounded-[4px] transition-all ${
              pathname === "/my-list"
                ? "bg-penpot-opacity-white-10 text-white"
                : "text-penpot-text-medium hover:text-white hover:bg-penpot-opacity-white-10"
            }`}
            title="Library"
            aria-label="View My Library"
          >
            <IconVideoLibrary className="size-5 text-penpot-text-medium hover:text-penpot-secondary-200" />
            <span className="text-xs font-medium hidden xl:inline-block">Library</span>
          </Link>

          {/* Notifications Dropdown (Cohesive with MenuUser Penpot standards) */}
          <NotificationBell />

          {/* User Account / Avatar Dropdown (Penpot MenuUser Component) */}
          <UserProfileMenu />

          {/* Mobile Menu Hamburger Button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-10 w-10 flex items-center justify-center text-penpot-text-high hover:text-penpot-secondary-200 md:hidden transition-colors rounded-[4px] hover:bg-penpot-opacity-white-10 cursor-pointer"
            aria-label="Toggle mobile menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? (
              <IconClose className="size-6 text-penpot-text-high" />
            ) : (
              <div className="flex flex-col gap-1.5 items-center justify-center">
                <span className="block h-0.5 w-5 bg-penpot-text-high rounded-full" />
                <span className="block h-0.5 w-5 bg-penpot-text-high rounded-full" />
                <span className="block h-0.5 w-5 bg-penpot-text-high rounded-full" />
              </div>
            )}
          </button>

        </div>
      </div>

      {/* Mobile Drawer (Penpot Dark Theme) */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-penpot-border bg-penpot-neutral-700/98 backdrop-blur-xl px-4 py-6 animate-in slide-in-from-top duration-200 max-h-[80vh] overflow-y-auto">
          <div className="flex flex-col gap-2">
            {NAV_ITEMS.map((item) => {
              const active = isNavItemActive(item)
              const Icon = item.icon
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-[4px] text-base font-medium transition-colors ${
                    active
                      ? "text-penpot-secondary-200 bg-penpot-surface"
                      : "text-penpot-text-high hover:text-penpot-secondary-200 hover:bg-penpot-surface"
                  }`}
                >
                  <Icon className={`size-5 ${active ? "text-penpot-secondary-200" : "text-penpot-text-subtle"}`} />
                  <span>{item.label}</span>
                </Link>
              )
            })}

            <Link
              href="/my-list"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-[4px] text-base font-medium transition-colors ${
                pathname === "/my-list"
                  ? "text-penpot-secondary-200 bg-penpot-surface"
                  : "text-penpot-text-high hover:text-penpot-secondary-200 hover:bg-penpot-surface"
              }`}
            >
              <IconPlus className="size-5 text-penpot-text-subtle" />
              <span>My List</span>
            </Link>

            <Link
              href="/search"
              onClick={() => setMobileMenuOpen(false)}
              className={`flex items-center gap-3 px-4 py-3 rounded-[4px] text-base font-medium transition-colors ${
                pathname === "/search"
                  ? "text-penpot-secondary-200 bg-penpot-surface"
                  : "text-penpot-text-high hover:text-penpot-secondary-200 hover:bg-penpot-surface"
              }`}
            >
              <IconSearch className="size-5 text-penpot-text-subtle" />
              <span>Search</span>
            </Link>

            {/* Mobile Genre Links */}
            <div className="pt-4 mt-2 border-t border-penpot-border">
              <p className="px-4 text-xs font-bold text-penpot-text-subtle uppercase tracking-wider mb-2">
                Genres
              </p>
              <div className="grid grid-cols-2 gap-1 px-2">
                {GENRE_CATALOG.slice(0, 12).map((genre) => (
                  <Link
                    key={genre.slug}
                    href={`/genre/${genre.slug}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-xs font-medium text-penpot-text-medium hover:text-penpot-secondary-200 transition-colors py-1"
                  >
                    {genre.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}


