import { NextRequest, NextResponse } from "next/server"
import { env } from "@/lib/env"

const SONARR_BASE = env("SONARR_URL")
const SONARR_KEY = env("SONARR_API_KEY")

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  if (!path || path.length === 0) {
    return new NextResponse("Not Found", { status: 404 })
  }

  const searchParams = request.nextUrl.searchParams.toString()
  const queryString = searchParams ? `?${searchParams}` : ""
  const targetUrl = `${SONARR_BASE}/api/v3/MediaCover/${path.join("/")}${queryString}`

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "X-Api-Key": SONARR_KEY,
      },
    })

    if (!res.ok) {
      return new NextResponse("Failed to fetch image from Sonarr", { status: res.status })
    }

    const contentType = res.headers.get("content-type") || "image/jpeg"
    const buffer = await res.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  } catch (error) {
    console.error("Error proxying Sonarr MediaCover:", error)
    return new NextResponse("Internal Error", { status: 500 })
  }
}
