import { NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"

export async function GET() {
  try {
    const [qualityProfiles, rootFolders] = await Promise.all([
      radarr.getQualityProfiles(),
      radarr.getRootFolders(),
    ])
    return NextResponse.json({ qualityProfiles, rootFolders })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Radarr profiles"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
