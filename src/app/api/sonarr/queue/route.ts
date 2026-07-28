import { NextResponse } from "next/server"
import * as sonarr from "@/lib/sonarr"

export async function GET() {
  try {
    const queue = await sonarr.getQueue()
    return NextResponse.json(queue)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Sonarr queue"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
