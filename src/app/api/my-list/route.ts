import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserFavorites } from "@/lib/jellyfin"
import { tmdbFetch } from "@/lib/tmdb"
import { getImageUrl } from "@/lib/utils"
import {
  getUserMyList,
  addToMyList,
  removeFromMyList,
  MyListItem,
} from "@/lib/my-list-store"

// Bounded concurrency pool for in-memory TMDB enrichment (Issue 1 & 2)
async function enrichItemsInPool(items: MyListItem[], maxConcurrency = 5): Promise<MyListItem[]> {
  const itemsToEnrich = items.map((item, index) => ({ item, index })).filter(({ item }) => {
    const numericId = item.tmdbId || (/^\d+$/.test(item.id) ? Number(item.id) : undefined)
    return numericId && !item.posterPath
  })

  if (itemsToEnrich.length === 0) return items

  const enrichedResult = [...items]
  const chunks: typeof itemsToEnrich[] = []
  for (let i = 0; i < itemsToEnrich.length; i += maxConcurrency) {
    chunks.push(itemsToEnrich.slice(i, i + maxConcurrency))
  }

  for (const chunk of chunks) {
    await Promise.allSettled(
      chunk.map(async ({ item, index }) => {
        const numericId = item.tmdbId || Number(item.id)
        try {
          const endpoint = item.mediaType === "tv" ? `/tv/${numericId}` : `/movie/${numericId}`
          const details = await tmdbFetch<{ poster_path?: string; overview?: string; release_date?: string; first_air_date?: string }>(endpoint)

          const posterPath = details.poster_path ? getImageUrl(details.poster_path, "w500") : item.posterPath
          const releaseDate = details.release_date || details.first_air_date
          const releaseYear = releaseDate ? releaseDate.split("-")[0] : item.releaseYear

          enrichedResult[index] = {
            ...item,
            tmdbId: numericId,
            posterPath: posterPath || null,
            overview: details.overview || item.overview,
            releaseYear: releaseYear || item.releaseYear,
          }
        } catch {
          // Keep original item on error
        }
      })
    )
  }

  return enrichedResult
}

export async function GET(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId || "default-user"

    const { searchParams } = new URL(req.url)
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined
    const offset = searchParams.get("offset") ? Number(searchParams.get("offset")) : 0

    // Fetch custom stored items
    let customItems = await getUserMyList(userId)
    const customJellyfinIds = new Set(customItems.map((i) => i.jellyfinId).filter(Boolean))

    // Hybrid sync: fetch Jellyfin favorites in-memory without side-effect mutations during GET
    try {
      const jellyfinFavorites = await getUserFavorites()
      for (const fav of jellyfinFavorites) {
        if (!customJellyfinIds.has(fav.Id)) {
          const isMovie = fav.Type?.toLowerCase() === "movie"
          const mediaType = isMovie ? "movie" : "tv"
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const favAny = fav as Record<string, any>

          const newItem: MyListItem = {
            id: `jellyfin-${fav.Id}`,
            userId,
            jellyfinId: fav.Id,
            mediaType,
            title: fav.Name,
            posterPath: fav.ImageTags?.Primary
              ? `/api/jellyfin/image/${fav.Id}?type=Primary`
              : fav.BackdropImageTags?.[0]
              ? `/api/jellyfin/image/${fav.Id}?type=Backdrop`
              : null,
            overview: typeof favAny.Overview === "string" ? favAny.Overview : undefined,
            releaseYear: typeof favAny.ProductionYear === "number" || typeof favAny.ProductionYear === "string" ? String(favAny.ProductionYear) : undefined,
            addedAt: new Date().toISOString(),
          }

          customItems.unshift(newItem)
          customJellyfinIds.add(fav.Id)
        }
      }
    } catch (err) {
      console.warn("Could not sync Jellyfin favorites into My List:", err)
    }

    // Enrich missing posterPath in-memory using bounded concurrency pool (Issue 1 & 2)
    customItems = await enrichItemsInPool(customItems, 5)

    // Optional pagination (Issue 14)
    const total = customItems.length
    const items = limit ? customItems.slice(offset, offset + limit) : customItems

    return NextResponse.json({ items, total, offset, limit })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch My List"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId || "default-user"
    const body = await req.json()

    if (!body.title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 })
    }

    const item = await addToMyList(userId, {
      id: body.id,
      tmdbId: body.tmdbId ? Number(body.tmdbId) : undefined,
      tvdbId: body.tvdbId ? Number(body.tvdbId) : undefined,
      jellyfinId: body.jellyfinId,
      mediaType: body.mediaType === "tv" ? "tv" : "movie",
      title: body.title,
      posterPath: body.posterPath,
      overview: body.overview,
      releaseYear: body.releaseYear,
    })

    return NextResponse.json({ success: true, item })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add item to My List"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId || "default-user"

    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    const tmdbId = searchParams.get("tmdbId") ? Number(searchParams.get("tmdbId")) : undefined
    const jellyfinId = searchParams.get("jellyfinId") || undefined
    const mediaType = (searchParams.get("mediaType") as "movie" | "tv") || undefined

    const removed = await removeFromMyList(userId, {
      id: id || undefined,
      tmdbId,
      jellyfinId,
      mediaType,
    })

    return NextResponse.json({ success: removed })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove item from My List"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
