import { NextResponse } from "next/server"

import { radarrBreaker, sonarrBreaker, jellyfinBreaker, tmdbBreaker, convexBreaker } from "@/lib/circuit-breaker"

export async function GET() {
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
