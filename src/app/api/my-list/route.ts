import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getUserFavorites, toggleFavoriteItem } from "@/lib/jellyfin"
import { tmdbFetch } from "@/lib/tmdb"
import { getImageUrl } from "@/lib/utils"
import {
  getUserMyList,
  addToMyList,
  removeFromMyList,
  MyListItem,
} from "@/lib/my-list-store"

export async function GET() {
  try {
    const session = await getSession()
    const userId = session?.userId || "default-user"

    // Fetch custom stored items
    const customItems = await getUserMyList(userId)
    const customJellyfinIds = new Set(customItems.map((i) => i.jellyfinId).filter(Boolean))

    // Auto-enrich any items missing posterPath or tmdbId metadata
    for (let i = 0; i < customItems.length; i++) {
      const item = customItems[i]
      const numericId = item.tmdbId || (/^\d+$/.test(item.id) ? Number(item.id) : undefined)

      if (numericId && (!item.posterPath || !item.tmdbId)) {
        try {
          const endpoint = item.mediaType === "tv" ? `/tv/${numericId}` : `/movie/${numericId}`
          const details = await tmdbFetch<{ poster_path?: string; overview?: string; release_date?: string; first_air_date?: string; name?: string; title?: string }>(endpoint)

          const posterPath = details.poster_path ? getImageUrl(details.poster_path, "w500") : item.posterPath
          const releaseDate = details.release_date || details.first_air_date
          const releaseYear = releaseDate ? releaseDate.split("-")[0] : item.releaseYear

          const updated = await addToMyList(userId, {
            ...item,
            tmdbId: numericId,
            posterPath,
            overview: details.overview || item.overview,
            releaseYear,
          })
          customItems[i] = updated
        } catch {
          // Ignore TMDB fetch errors for invalid IDs
        }
      }
    }

    // Hybrid sync: fetch Jellyfin favorites and merge any native Jellyfin favorites
    try {
      const jellyfinFavorites = await getUserFavorites()
      for (const fav of jellyfinFavorites) {
        if (!customJellyfinIds.has(fav.Id)) {
          const isMovie = fav.Type?.toLowerCase() === "movie"
          const mediaType = isMovie ? "movie" : "tv"

          const favAny = fav as Record<string, any>
          const newItem: Omit<MyListItem, "id" | "userId" | "addedAt"> = {
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
          }

          // Auto-persist Jellyfin native favorite to custom store
          const added = await addToMyList(userId, newItem)
          customItems.unshift(added)
          customJellyfinIds.add(fav.Id)
        }
      }
    } catch (err) {
      console.warn("Could not sync Jellyfin favorites into My List:", err)
    }

    return NextResponse.json({ items: customItems })
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

    // Hybrid Sync with Jellyfin if item has jellyfinId
    if (body.jellyfinId) {
      toggleFavoriteItem(body.jellyfinId, true).catch((err) =>
        console.warn("Failed to sync favorite to Jellyfin server:", err)
      )
    }

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

    // Hybrid Sync with Jellyfin if jellyfinId provided
    if (jellyfinId) {
      toggleFavoriteItem(jellyfinId, false).catch((err) =>
        console.warn("Failed to unsync favorite from Jellyfin server:", err)
      )
    }

    return NextResponse.json({ success: removed })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove item from My List"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
