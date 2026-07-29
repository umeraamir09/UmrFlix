import { NextResponse } from "next/server"
import { getUserFavorites } from "@/lib/jellyfin"

export async function GET() {
  try {
    const favorites = await getUserFavorites()
    return NextResponse.json({ items: favorites })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch favorites"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
