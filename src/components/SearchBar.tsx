"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState, useCallback, useEffect, useRef } from "react"
import { Search, X, Loader2, Film, Tv } from "lucide-react"
import Image from "next/image"

interface SearchPreviewItem {
  id: number
  title?: string
  name?: string
  media_type?: string
  poster_path?: string
  release_date?: string
  first_air_date?: string
}

export function SearchBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get("q") ?? "")
  const [results, setResults] = useState<SearchPreviewItem[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchPreviews = useCallback(async (term: string) => {
    if (!term.trim() || term.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(term.trim())}`)
      if (res.ok) {
        const data = await res.json()
        setResults((data.results || []).slice(0, 5))
        setOpen(true)
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      fetchPreviews(query)
    }, 350)
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [query, fetchPreviews])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      setOpen(false)
      router.push(`/search?q=${encodeURIComponent(query.trim())}`)
    }
  }

  const handleSelect = (item: SearchPreviewItem) => {
    setOpen(false)
    const type = item.media_type === "tv" || item.name ? "tv" : "movie"
    router.push(`/${type}/${item.id}`)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <Search className="absolute left-3 size-4 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search movies, TV shows..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 2 && results.length > 0 && setOpen(true)}
          className="h-9 w-full rounded-md border border-[#282c37] bg-[#0a0b0d] pl-9 pr-8 text-xs font-medium text-white placeholder-gray-500 transition-all focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        {loading ? (
          <Loader2 className="absolute right-2.5 size-4 animate-spin text-accent" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("")
              setResults([])
              setOpen(false)
            }}
            className="absolute right-2.5 text-gray-400 hover:text-white"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      {/* Live Preview Dropdown Overlay */}
      {open && results.length > 0 && (
        <div className="absolute top-full left-0 mt-1 w-full overflow-hidden rounded-md border border-[#282c37] bg-[#141519] shadow-2xl z-50 divide-y divide-[#282c37]">
          {results.map((item) => {
            const title = item.title || item.name || "Untitled"
            const date = item.release_date || item.first_air_date || ""
            const year = date ? new Date(date).getFullYear() : ""
            const isTv = item.media_type === "tv" || !!item.name
            const poster = item.poster_path
              ? `https://image.tmdb.org/t/p/w92${item.poster_path}`
              : "/placeholder-poster.svg"

            return (
              <div
                key={item.id}
                onClick={() => handleSelect(item)}
                className="flex items-center gap-3 p-2.5 hover:bg-[#1a1c23] cursor-pointer transition-colors group"
              >
                <div className="relative h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-[#232630]">
                  <Image
                    src={poster}
                    alt={title}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-white truncate group-hover:text-accent transition-colors">
                    {title}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                    <span className="flex items-center gap-1 font-medium text-accent uppercase">
                      {isTv ? <Tv className="size-3" /> : <Film className="size-3" />}
                      {isTv ? "TV Show" : "Movie"}
                    </span>
                    {year && <span>• {year}</span>}
                    <span>• Sub | Dub</span>
                  </div>
                </div>
              </div>
            )
          })}
          <button
            onClick={handleSubmit}
            className="w-full bg-[#1a1c23] p-2 text-center text-xs font-semibold text-accent hover:bg-accent hover:text-white transition-colors"
          >
            See all results for "{query}"
          </button>
        </div>
      )}
    </div>
  )
}
