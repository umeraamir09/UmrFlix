import { NextResponse } from "next/server"

import { radarrBreaker, sonarrBreaker, jellyfinBreaker, tmdbBreaker, convexBreaker } from "@/lib/circuit-breaker"

export async function GET() {
  const convexUrl =
    process.env.CONVEX_SELF_HOSTED_URL ||
    process.env.NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL ||
    process.env.CONVEX_URL ||
    process.env.NEXT_PUBLIC_CONVEX_URL

  // Perform lightweight active check for Convex if configured
  if (convexUrl) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(convexUrl, { method: "HEAD", signal: controller.signal }).catch(() => null)
      clearTimeout(timeout)

      if (res && (res.ok || res.status < 500)) {
        convexBreaker.recordSuccess()
      } else {
        convexBreaker.recordFailure()
      }
    } catch {
      convexBreaker.recordFailure()
    }
  }

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
