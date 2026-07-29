import { NextResponse } from "next/server"
import { tmdbFetch, TmdbMovie, TmdbTvShow, TmdbPaginated } from "@/lib/tmdb"
import { authenticate, getAllItems } from "@/lib/jellyfin"

export const revalidate = 3600 // Cache for 1 hour

export async function GET() {
  const posters: string[] = []

  // 1. Fetch TMDB Trending Posters
  try {
    const tmdbData = await tmdbFetch<TmdbPaginated<TmdbMovie | TmdbTvShow>>("/trending/all/week")
    if (tmdbData?.results) {
      for (const item of tmdbData.results) {
        if (item.poster_path) {
          posters.push(`https://image.tmdb.org/t/p/w500${item.poster_path}`)
        }
      }
    }
  } catch {
    /* silent TMDB fallback */
  }

  // 2. Fetch Jellyfin Library Covers
  try {
    const { token, userId } = await authenticate()
    const jellyfinItems = await getAllItems(token, userId)
    if (jellyfinItems && jellyfinItems.length > 0) {
      for (const item of jellyfinItems) {
        if (item.Id) {
          posters.push(`/api/jellyfin/image/${item.Id}?type=Primary`)
        }
      }
    }
  } catch {
    /* silent Jellyfin fallback */
  }

  // Fallback default high-res poster URLs if APIs are unavailable
  if (posters.length < 20) {
    const fallbackPosters = [
      "https://image.tmdb.org/t/p/w500/9cqNxsWh83vuFiM2UTWgh5e4ChD.jpg",
      "https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg",
      "https://image.tmdb.org/t/p/w500/d5NXSklXo0qyIYkgV94WAgMIckC.jpg",
      "https://image.tmdb.org/t/p/w500/q71t2A7yL9jURuF8jT0rmKV41eG.jpg",
      "https://image.tmdb.org/t/p/w500/vpnVM9B6NMmQpEZZaVUozE1yAOF.jpg",
      "https://image.tmdb.org/t/p/w500/rCzpDGLbOoPwLjy3exCQupAU2mM.jpg",
      "https://image.tmdb.org/t/p/w500/7WsyChLLEz3yB0m9tB88hWz2vjV.jpg",
      "https://image.tmdb.org/t/p/w500/t6HIfvMGHvUoW1vFhZMBaLA9ft.jpg",
      "https://image.tmdb.org/t/p/w500/kDp1vUBnMpeYrAKbLpqm128ftx.jpg",
      "https://image.tmdb.org/t/p/w500/1E5baW8bK6v8hLdE2v3F9i4f9c.jpg",
      "https://image.tmdb.org/t/p/w500/62HCnUTziyWcpDaBO2i1wYvB4v.jpg",
      "https://image.tmdb.org/t/p/w500/7IIIrV3nOSg89tB5tG89tB3t.jpg"
    ]
    posters.push(...fallbackPosters)
  }

  // Shuffle array
  const shuffled = posters.sort(() => Math.random() - 0.5)

  return NextResponse.json({ posters: shuffled })
}
