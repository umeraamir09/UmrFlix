import { NextResponse } from "next/server"
import { authenticate, getAllItems } from "@/lib/jellyfin"
import { ensureJellyfinIndex, setJellyfinIndex, getJellyfinIndex } from "@/lib/cache"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const forceRefresh = url.searchParams.get("refresh") === "true"

  if (!forceRefresh) {
    const cached = getJellyfinIndex()
    if (cached) {
      const obj: Record<string, string> = {}
      cached.forEach((v, k) => { obj[k] = v })
      return NextResponse.json({ index: obj, cached: true })
    }
  }

  try {
    const { token, userId } = await authenticate()
    const items = await getAllItems(token, userId)
    setJellyfinIndex(items)

    const map = getJellyfinIndex()!
    const obj: Record<string, string> = {}
    map.forEach((v, k) => { obj[k] = v })

    return NextResponse.json({ index: obj, cached: false, totalItems: items.length })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build Jellyfin index"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
