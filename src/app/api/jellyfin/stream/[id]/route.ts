import { NextResponse } from "next/server"
import { authenticate, getDirectStreamUrl, getHlsMasterUrl } from "@/lib/jellyfin"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { token } = await authenticate()

    return NextResponse.json({
      direct: getDirectStreamUrl(id, token),
      hls: getHlsMasterUrl(id, token),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to get stream URL"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
