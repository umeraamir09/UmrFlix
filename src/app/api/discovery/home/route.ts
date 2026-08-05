import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPersonalizedFeed } from "@/lib/discovery/engine"
import { recordServeLog, recordRowFatigueImpression } from "@/lib/discovery/store"

export const dynamic = "force-dynamic"

/**
 * Personalized home/genre feed rows for the current session user.
 * Client-fetched (SWR) so the ISR page shells stay cacheable across users.
 */
export async function GET(req: Request) {
  try {
    const session = await getSession()
    const userId = session?.userId ?? "default-user"

    const { searchParams } = new URL(req.url)
    const mediaTypeParam = searchParams.get("mediaType")
    const mediaType =
      mediaTypeParam === "movie" || mediaTypeParam === "tv" ? mediaTypeParam : undefined
    const hourParam = searchParams.get("hour")
    const clientHour = hourParam ? Number.parseInt(hourParam, 10) : undefined

    const rows = await getPersonalizedFeed(userId, "default", { mediaType, clientHour })

    if (rows.length > 0) {
      const servedItemKeys = rows.flatMap((r) => r.items.map((i) => `${i.media_type ?? "movie"}:${i.id}`))
      void recordServeLog(userId, "default", servedItemKeys)
      for (const row of rows) {
        void recordRowFatigueImpression(userId, "default", row.key)
      }
    }

    return NextResponse.json({ rows })
  } catch (err) {
    console.error("[Discovery] Home feed failed:", err)
    return NextResponse.json({ rows: [] })
  }
}
