import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { authenticate } from "@/lib/jellyfin"

export const dynamic = "force-dynamic"

const BASE = () => env("JELLYFIN_URL")

/**
 * GET /api/jellyfin/subtitles/{itemId}/{mediaSourceId}/{streamIndex}?format=vtt
 *
 * Same-origin proxy for text subtitle tracks (VTT/SRT/ASS). Client-side
 * subtitle rendering fetches through this route so the Jellyfin token never
 * reaches the browser and cross-origin/CORS issues can't break subtitle
 * loading.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  try {
    const { slug } = await params
    const [itemId, mediaSourceId, streamIndex] = slug
    if (!itemId || !mediaSourceId || streamIndex == null) {
      return NextResponse.json({ error: "Invalid subtitle path" }, { status: 400 })
    }

    const format = new URL(request.url).searchParams.get("format") || "vtt"
    if (!/^[a-z0-9]+$/i.test(format)) {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 })
    }

    const { token } = await authenticate()
    const upstream = await fetch(
      `${BASE()}/Videos/${itemId}/${mediaSourceId}/Subtitles/${streamIndex}/0/Stream.${format}?api_key=${token}`,
    )

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Subtitle fetch failed: ${upstream.status}` },
        { status: upstream.status },
      )
    }

    const text = await upstream.text()
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type":
          format === "vtt" ? "text/vtt; charset=utf-8" : "text/plain; charset=utf-8",
        // Subtitle files are immutable for a given stream
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to load subtitle track"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
