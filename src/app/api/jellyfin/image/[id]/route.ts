import { NextResponse } from "next/server"

import { authenticate } from "@/lib/jellyfin"
import { env } from "@/lib/env"

const ALLOWED_TYPES = new Set(["Primary", "Backdrop", "Banner", "Thumb", "Logo"])

const SVG_PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450" viewBox="0 0 300 450" fill="none"><rect width="300" height="450" fill="#1f232d"/><path d="M150 200L180 250H120L150 200Z" fill="#3b4252"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#6c7a96" font-family="sans-serif" font-size="14">No Image Available</text></svg>`

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    if (!id || typeof id !== "string" || !/^[a-zA-Z0-9._-]+$/.test(id)) {
      return new NextResponse("Invalid item ID", { status: 400 })
    }

    const { searchParams } = new URL(req.url)
    const rawType = searchParams.get("type") || "Primary"
    const type = ALLOWED_TYPES.has(rawType) ? rawType : "Primary"
    const width = searchParams.get("width")
    const height = searchParams.get("height")

    const { token } = await authenticate()
    const baseUrl = env("JELLYFIN_URL")
    let imageUrl = `${baseUrl}/Items/${id}/Images/${type}`

    const queryParts: string[] = []
    if (width && !isNaN(Number(width))) queryParts.push(`maxWidth=${width}`)
    if (height && !isNaN(Number(height))) queryParts.push(`maxHeight=${height}`)

    if (queryParts.length > 0) {
      imageUrl += `?${queryParts.join("&")}`
    }

    const res = await fetch(imageUrl, {
      headers: {
        "X-Emby-Token": token,
      },
    })

    if (!res.ok) {
      return new NextResponse(SVG_PLACEHOLDER, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "public, max-age=3600",
        },
      })
    }

    const blob = await res.arrayBuffer()
    const contentType = res.headers.get("content-type") || "image/jpeg"

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  } catch {
    return new NextResponse(SVG_PLACEHOLDER, {
      status: 200,
      headers: {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=60",
      },
    })
  }
}
