import { NextResponse } from "next/server"

import { radarrBreaker, sonarrBreaker, jellyfinBreaker, tmdbBreaker, convexBreaker } from "@/lib/circuit-breaker"

async function probeService(url: string, breaker: typeof radarrBreaker, timeoutMs = 3000): Promise<void> {
  if (!url) return
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { method: "HEAD", signal: controller.signal }).catch(() => null)
    clearTimeout(timeout)

    if (res && (res.ok || res.status < 500)) {
      breaker.recordSuccess()
    } else {
      breaker.recordFailure()
    }
  } catch {
    breaker.recordFailure()
  }
}

export async function GET() {
  const radarrUrl = process.env.RADARR_URL
  const sonarrUrl = process.env.SONARR_URL
  const jellyfinUrl = process.env.JELLYFIN_URL
  const tmdbKey = process.env.TMDB_API_KEY
  const convexUrl =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL

  await Promise.allSettled([
    probeService(radarrUrl ? `${radarrUrl}/api/v3/system/status` : "", radarrBreaker),
    probeService(sonarrUrl ? `${sonarrUrl}/api/v3/system/status` : "", sonarrBreaker),
    probeService(jellyfinUrl, jellyfinBreaker),
    tmdbKey
      ? probeService(
          `https://api.themoviedb.org/3/configuration?api_key=${tmdbKey}`,
          tmdbBreaker,
          4000
        )
      : Promise.resolve(),
    probeService(convexUrl ?? "", convexBreaker),
  ])

  const breakers = {
    radarr: radarrBreaker.getState(),
    sonarr: sonarrBreaker.getState(),
    jellyfin: jellyfinBreaker.getState(),
    tmdb: tmdbBreaker.getState(),
    convex: convexBreaker.getState(),
  }

  const isDegraded = Object.values(breakers).some((b) => b.state === "OPEN")

  return NextResponse.json({
    status: isDegraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    services: breakers,
  })
}
