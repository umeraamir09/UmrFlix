import { NextResponse } from "next/server"
import * as sonarr from "@/lib/sonarr"

export async function GET() {
  try {
    const [qualityProfiles, rawRootFolders, tags, diskSpace] = await Promise.all([
      sonarr.getQualityProfiles().catch(() => []),
      sonarr.getRootFolders().catch(() => []),
      sonarr.getTags().catch(() => []),
      sonarr.getDiskSpace().catch(() => []),
    ])

    const rootFolders = rawRootFolders.map((f) => {
      const match = diskSpace.find((d) => d.path === f.path || f.path.startsWith(d.path))
      return {
        ...f,
        freeSpace: match ? match.freeSpace : f.freeSpace,
      }
    })

    return NextResponse.json({ qualityProfiles, rootFolders, tags })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Sonarr profiles"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

