import { NextResponse } from "next/server"
import { triggerLibraryScan } from "@/lib/jellyfin"
import { invalidateAll } from "@/lib/cache"

export async function POST() {
  try {
    const ok = await triggerLibraryScan()
    if (!ok) {
      return NextResponse.json({ error: "Failed to trigger Jellyfin library scan" }, { status: 502 })
    }
    invalidateAll()
    return NextResponse.json({ success: true, message: "Jellyfin library scan initiated successfully" })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to trigger library scan"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
