import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { authenticate } from "@/lib/jellyfin"
import { isValidItemId, isValidIndex } from "@/lib/validation"

export const dynamic = "force-dynamic"

const BASE = () => env("JELLYFIN_URL")

const MAX_TILE_INDEX = 10_000
const MIN_WIDTH = 32
const MAX_WIDTH = 1920

/**
 * GET /api/jellyfin/trickplay/{itemId}/{width}/{tileIndex}
 *
 * Same-origin proxy for Jellyfin trickplay sprite tiles
 * (/Videos/{itemId}/Trickplay/{width}/{index}.jpg). The seek-bar preview
 * loads tiles through this route so the Jellyfin token never reaches the
 * browser.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  try {
    const { slug } = await params
    const [itemId, widthRaw, indexRaw] = slug
    if (!isValidItemId(itemId)) {
      return NextResponse.json({ error: "Invalid trickplay path" }, { status: 400 })
    }

    const width = Number(widthRaw)
    const index = Number(indexRaw)
    if (
      !Number.isInteger(width) ||
      width < MIN_WIDTH ||
      width > MAX_WIDTH ||
      !isValidIndex(index, MAX_TILE_INDEX)
    ) {
      return NextResponse.json({ error: "Invalid trickplay path" }, { status: 400 })
    }

    const { token } = await authenticate()
    const upstream = await fetch(
      `${BASE()}/Videos/${itemId}/Trickplay/${width}/${index}.jpg`,
      { headers: { "X-Emby-Token": token } },
    )

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Trickplay tile fetch failed: ${upstream.status}` },
        { status: upstream.status },
      )
    }

    const blob = await upstream.arrayBuffer()
    // Trickplay tiles are immutable for a given media file
    return new NextResponse(blob, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load trickplay tile"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
