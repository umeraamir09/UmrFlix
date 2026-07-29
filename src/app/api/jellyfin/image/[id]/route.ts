import { NextResponse } from "next/server"
import { authenticate } from "@/lib/jellyfin"
import { env } from "@/lib/env"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const type = searchParams.get("type") || "Primary"

    const { token } = await authenticate()
    const baseUrl = env("JELLYFIN_URL")
    const imageUrl = `${baseUrl}/Items/${id}/Images/${type}?api_key=${token}`

    const res = await fetch(imageUrl)
    if (!res.ok) {
      return new NextResponse(null, { status: res.status })
    }

    const blob = await res.arrayBuffer()
    const contentType = res.headers.get("content-type") || "image/jpeg"

    return new NextResponse(blob, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    })
  } catch (e) {
    return new NextResponse(null, { status: 500 })
  }
}
