import { NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"

export async function GET() {
  try {
    const queue = await radarr.getQueue()
    return NextResponse.json(queue)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Radarr queue"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
