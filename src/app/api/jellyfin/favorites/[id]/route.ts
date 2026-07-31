import { NextResponse } from "next/server"
import { setFavoriteItem } from "@/lib/jellyfin"

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const success = await setFavoriteItem(id, true)
    return NextResponse.json({ success })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add favorite"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const success = await setFavoriteItem(id, false)
    return NextResponse.json({ success })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to remove favorite"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
