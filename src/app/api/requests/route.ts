import { NextRequest, NextResponse } from "next/server"
import { getSession, setSessionCookie } from "@/lib/auth"
import { canMakeRequest, incrementRequestCount } from "@/lib/rbac"
import { createRequest, getAllRequests } from "@/lib/requests-store"

export async function GET() {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const requests = await getAllRequests()
    return NextResponse.json(requests)
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch requests"
    return NextResponse.json({ error: message }, { status: 500 })
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
    const {
      tmdbId,
      tvdbId,
      title,
      mediaType,
      year,
      posterPath,
      backdropPath,
      qualityProfileId,
      rootFolderPath,
      minimumAvailability,
      seriesType,
      tags,
      seasons,
    } = body

    if (!tmdbId || !title || !mediaType || !qualityProfileId || !rootFolderPath) {
      return NextResponse.json({ error: "Missing required request parameters" }, { status: 400 })
    }

    const isUserAdmin = Boolean(session?.isAdmin)

    const requestItem = await createRequest({
      tmdbId: Number(tmdbId),
      tvdbId: tvdbId ? Number(tvdbId) : undefined,
      title,
      mediaType,
      year: year ? Number(year) : undefined,
      posterPath,
      backdropPath,
      qualityProfileId: Number(qualityProfileId),
      rootFolderPath,
      minimumAvailability,
      seriesType,
      tags: Array.isArray(tags) ? tags.map(Number) : undefined,
      seasons,
      requestedBy: {
        userId: session!.userId,
        username: session!.username,
      },
      autoApprove: isUserAdmin,
    })


    if (session && !session.isAdmin) {
      const updatedSession = incrementRequestCount(session)
      await setSessionCookie(updatedSession)
    }

    return NextResponse.json(requestItem, { status: 201 })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to submit request"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
