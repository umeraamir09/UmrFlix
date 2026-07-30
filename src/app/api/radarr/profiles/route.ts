import { NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"

export async function GET() {
  try {
    const [qualityProfiles, rawRootFolders, tags, diskSpace] = await Promise.all([
      radarr.getQualityProfiles().catch(() => []),
      radarr.getRootFolders().catch(() => []),
      radarr.getTags().catch(() => []),
      radarr.getDiskSpace().catch(() => []),
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
    const message = e instanceof Error ? e.message : "Failed to fetch Radarr profiles"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

