import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { authenticate } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

const BASE = () => env("JELLYFIN_URL")
const ITEM_ID_RE = /^[a-zA-Z0-9]+$/
const MAX_CHAPTER_INDEX = 500

/**
 * GET /api/jellyfin/chapter-image/{itemId}/{chapterIndex}
 *
 * Same-origin proxy for Jellyfin chapter images
 * (/Items/{itemId}/Images/Chapter/{index}).
 * The seek-bar preview loads chapter images through this route
 * so the Jellyfin token never reaches the browser.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  try {
    const { slug } = await params
    const [itemId, indexRaw] = slug
    if (!itemId || !ITEM_ID_RE.test(itemId)) {
      return NextResponse.json(
        { error: "Invalid chapter image path" },
        { status: 400 },
      )
    }

    const index = Number(indexRaw)
    if (!Number.isInteger(index) || index < 0 || index > MAX_CHAPTER_INDEX) {
      return NextResponse.json(
        { error: "Invalid chapter index" },
        { status: 400 },
      )
    }

    const { token } = await authenticate()

    const { searchParams } = new URL(request.url)
    const upstreamUrl = new URL(`${BASE()}/Items/${itemId}/Images/Chapter/${index}`)
    upstreamUrl.searchParams.set("maxWidth", "320")
    const tag = searchParams.get("tag")
    if (tag) upstreamUrl.searchParams.set("tag", tag)

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: { "X-Emby-Token": token },
    })

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Chapter image fetch failed: ${upstream.status}` },
        { status: upstream.status },
      )
    }

    const blob = await upstream.arrayBuffer()
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to load chapter image"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
