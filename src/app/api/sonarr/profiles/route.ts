import { NextResponse } from "next/server"
import * as sonarr from "@/lib/sonarr"

export async function GET() {
  try {
    const [qualityProfiles, rootFolders] = await Promise.all([
      sonarr.getQualityProfiles(),
      sonarr.getRootFolders(),
    ])
    return NextResponse.json({ qualityProfiles, rootFolders })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Sonarr profiles"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
