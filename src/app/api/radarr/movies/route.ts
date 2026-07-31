import { NextRequest, NextResponse } from "next/server"
import * as radarr from "@/lib/radarr"
import { setRadarrMovies, getRadarrMovies } from "@/lib/cache"
import { getSession, setSessionCookie } from "@/lib/auth"
import { canMakeRequest, incrementRequestCount } from "@/lib/rbac"

export async function GET(request: NextRequest) {
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "true"

  try {
    if (!forceRefresh) {
      const cached = getRadarrMovies()
      if (cached) {
        return NextResponse.json(Array.from(cached.values()))
      }
    }
    const movies = await radarr.getMovies()
    setRadarrMovies(movies)
    return NextResponse.json(movies)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch Radarr movies"
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
      tmdbId: body.tmdbId,
      title: body.title,
      mediaType: "movie",
      year: body.year,
      qualityProfileId: body.qualityProfileId,
      rootFolderPath: body.rootFolderPath,
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
    const message = e instanceof Error ? e.message : "Failed to add movie"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

