import { NextRequest, NextResponse } from "next/server"
import * as sonarr from "@/lib/sonarr"
import { setSonarrSeries, getSonarrSeries } from "@/lib/cache"
import { getSession, setSessionCookie } from "@/lib/auth"
import { canMakeRequest, incrementRequestCount } from "@/lib/rbac"

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true"

  try {
    if (!forceRefresh) {
      const cached = getSonarrSeries()
      if (cached) {
        return NextResponse.json(Array.from(cached.values()))
      }
    }
    const series = await sonarr.getSeries()
    setSonarrSeries(series)
    return NextResponse.json(series)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Sonarr series"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    const check = canMakeRequest(session)
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason }, { status: session ? 429 : 401 })
    }

    const body = await request.json()
    const { createRequest } = await import("@/lib/requests-store")

    const reqItem = await createRequest({
      tmdbId: body.tvdbId || body.tmdbId,
      tvdbId: body.tvdbId,
      title: body.title,
      mediaType: "tv",
      qualityProfileId: body.qualityProfileId,
      rootFolderPath: body.rootFolderPath,
      seasons: body.seasons,
      requestedBy: {
        userId: session!.userId,
        username: session!.username,
      },
      autoApprove: Boolean(session?.isAdmin),
    })

    if (session && !session.isAdmin) {
      const updatedSession = incrementRequestCount(session)
      await setSessionCookie(updatedSession)
    }

    return NextResponse.json(reqItem, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to add series"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

