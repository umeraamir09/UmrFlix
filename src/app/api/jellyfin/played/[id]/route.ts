import { NextResponse } from "next/server"
import { markItemPlayed, markItemUnplayed } from "@/lib/jellyfin"
import { isValidItemId } from "@/lib/validation"

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 })
    }
    await markItemPlayed(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to mark item as played"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!isValidItemId(id)) {
      return NextResponse.json({ error: "Invalid item ID" }, { status: 400 })
    }
    await markItemUnplayed(id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to mark item as unplayed"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
