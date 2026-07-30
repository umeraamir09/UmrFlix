import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { isAdminUser } from "@/lib/rbac"
import * as radarr from "@/lib/radarr"
import * as sonarr from "@/lib/sonarr"
import { getDiskSpace as getQBitDiskSpace } from "@/lib/qbittorrent"

type DiskInfo = {
  path: string
  label?: string
  freeBytes: number
  totalBytes: number
}

function getDiskDeduplicationKey(disk: { path: string; freeSpace: number; totalSpace: number }): string {
  // 1. If path contains a Windows drive letter (e.g. "D:\Movies" or "D:"), deduplicate by drive letter "D:"
  const windowsDriveMatch = disk.path.match(/^([a-zA-Z]:)/)
  if (windowsDriveMatch) {
    return `win_${windowsDriveMatch[1].toUpperCase()}`
  }

  // 2. For Linux/Docker mounts, deduplicate by totalSpace signature (rounded to nearest 100MB)
  // Different subfolders on the same partition report identical totalSpace
  const totalMb = Math.round(disk.totalSpace / (100 * 1024 * 1024))
  return `vol_${totalMb}`
}

export async function GET() {
  try {
    const session = await getSession()
    if (!isAdminUser(session)) {
      return NextResponse.json({ error: "Forbidden. Admin privileges required." }, { status: 403 })
    }

    const [radarrDisks, sonarrDisks, qbitFreeSpace] = await Promise.all([
      radarr.getDiskSpace().catch(() => []),
      sonarr.getDiskSpace().catch(() => []),
      getQBitDiskSpace().catch(() => null),
    ])

    const diskMap = new Map<string, DiskInfo>()

    // Combine all disk entries from Radarr and Sonarr
    const allDisks = [...radarrDisks, ...sonarrDisks]

    for (const disk of allDisks) {
      if (!disk.path || disk.totalSpace <= 0) continue

      const key = getDiskDeduplicationKey(disk)

      // If we haven't registered this physical drive yet, or if current path is cleaner/shorter
      if (!diskMap.has(key)) {
        diskMap.set(key, {
          path: disk.path,
          label: disk.label,
          freeBytes: disk.freeSpace,
          totalBytes: disk.totalSpace,
        })
      } else {
        // Keep the shorter/cleaner root path if available (e.g. "D:\" over "D:\Movies")
        const existing = diskMap.get(key)!
        if (disk.path.length < existing.path.length) {
          diskMap.set(key, {
            path: disk.path,
            label: disk.label || existing.label,
            freeBytes: disk.freeSpace,
            totalBytes: disk.totalSpace,
          })
        }
      }
    }

    let totalFree = 0
    let totalCapacity = 0

    for (const disk of diskMap.values()) {
      totalFree += disk.freeBytes
      totalCapacity += disk.totalBytes
    }

    // Fallback if Radarr/Sonarr diskspace is completely unavailable
    if (qbitFreeSpace && totalCapacity === 0) {
      totalFree = qbitFreeSpace
      totalCapacity = 0
    }

    const usedBytes = Math.max(0, totalCapacity - totalFree)
    const usedPercentage = totalCapacity > 0 ? Math.round((usedBytes / totalCapacity) * 100) : 0

    return NextResponse.json({
      totalFreeBytes: totalFree,
      totalCapacityBytes: totalCapacity,
      usedBytes,
      usedPercentage,
      disks: Array.from(diskMap.values()),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch storage info"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
