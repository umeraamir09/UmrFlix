import { NextResponse } from "next/server"
import { authenticate } from "@/lib/jellyfin"

export async function POST() {
  try {
    const { token, userId } = await authenticate()
    return NextResponse.json({ token, userId })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Jellyfin authentication failed"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
