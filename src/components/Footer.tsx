"use client"

import Link from "next/link"

export function Footer() {
  return (
    <footer className="mt-20 border-t border-penpot-border/30 bg-[#090b13] text-penpot-text-medium pb-safe">
      <div className="mx-auto max-w-[1600px] px-4 py-12 sm:px-6 md:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12">
          {/* Logo & Info */}
          <div className="space-y-4 md:col-span-4">
            <Link href="/" className="inline-block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/umrflix-logo.svg"
                alt="UmrFlix Logo"
                className="h-8 w-auto object-contain"
              />
            </Link>
            <p className="text-xs text-penpot-text-subtle leading-relaxed">
              UmrFlix is your unified home for streaming media, merging TMDB&apos;s global catalog with your Jellyfin library, Radarr, and Sonarr media automation.
            </p>
          </div>

          {/* Column 1: Explore */}
          <div className="space-y-3 md:col-span-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Explore</h4>
            <ul className="space-y-2 text-xs">
              <li><Link href="/popular" className="hover:text-penpot-primary-100 transition-colors">Browse Popular</Link></li>
              <li><Link href="/movie" className="hover:text-penpot-primary-100 transition-colors">Trending Movies</Link></li>
              <li><Link href="/tvshows" className="hover:text-penpot-primary-100 transition-colors">Popular TV Shows</Link></li>
              <li><Link href="/library" className="hover:text-penpot-primary-100 transition-colors">My Library & Requests</Link></li>
            </ul>
          </div>

          {/* Column 2: Resources */}
          <div className="space-y-3 md:col-span-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Services</h4>
            <ul className="space-y-2 text-xs">
              <li><a href="http://localhost:8096" target="_blank" rel="noreferrer" className="hover:text-penpot-primary-100 transition-colors">Jellyfin Server</a></li>
              <li><a href="http://localhost:7878" target="_blank" rel="noreferrer" className="hover:text-penpot-primary-100 transition-colors">Radarr Manager</a></li>
              <li><a href="http://localhost:8989" target="_blank" rel="noreferrer" className="hover:text-penpot-primary-100 transition-colors">Sonarr Manager</a></li>
            </ul>
          </div>

          {/* Column 3: Account */}
          <div className="space-y-3 md:col-span-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-white">Account</h4>
            <ul className="space-y-2 text-xs">
              <li><Link href="/library" className="hover:text-penpot-primary-100 transition-colors">My Watchlist</Link></li>
              <li><Link href="/library" className="hover:text-penpot-primary-100 transition-colors">Download Queue</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-penpot-border/30 pt-6 flex flex-col sm:flex-row items-center justify-between text-[11px] text-penpot-text-subtle gap-4">
          <p>© {new Date().getFullYear()} UmrFlix. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-penpot-primary-100">Terms of Service</Link>
            <Link href="/" className="hover:text-penpot-primary-100">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
