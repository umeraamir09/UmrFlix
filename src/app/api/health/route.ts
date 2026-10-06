import { NextResponse } from "next/server"
import { getPool } from "@/lib/db/pool"
import { env } from "@/lib/env"
import { tmdbApiFetch } from "@/lib/tmdb-api"

import { radarrBreaker, sonarrBreaker, jellyfinBreaker, tmdbBreaker, postgresBreaker, getAggregateOpen } from "@/lib/circuit-breaker"

async function probeService(
  url: string,
  breaker: typeof radarrBreaker,
  timeoutMs = 3000,
  headers?: Record<string, string>
): Promise<void> {
  if (!url) return
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "follow" }).catch(() => null)
    clearTimeout(timeout)

    if (res?.ok) {
      breaker.recordSuccess()
    } else {
      breaker.recordFailure()
    }
  } catch {
    breaker.recordFailure()
  }
}

async function probeDatabase(): Promise<void> {
  if (!env("DATABASE_URL")) return
  try {
    await getPool().query("SELECT 1")
    postgresBreaker.recordSuccess()
  } catch {
    postgresBreaker.recordFailure()
  }
}

export async function GET() {
  const radarrUrl = process.env.RADARR_URL
  const sonarrUrl = process.env.SONARR_URL
  const jellyfinUrl = process.env.JELLYFIN_URL
  const tmdbApiKey = env("TMDB_API_KEY")

  await Promise.allSettled([
    probeService(radarrUrl ? `${radarrUrl}/api/v3/system/status` : "", radarrBreaker, 3000, {
      "X-Api-Key": process.env.RADARR_API_KEY ?? "",
    }),
    probeService(sonarrUrl ? `${sonarrUrl}/api/v3/system/status` : "", sonarrBreaker, 3000, {
      "X-Api-Key": process.env.SONARR_API_KEY ?? "",
    }),
    // /System/Info/Public is Jellyfin's unauthenticated liveness endpoint —
    // probing the origin root can 30x-redirect to /web/ and false-flag the server.
    probeService(jellyfinUrl ? `${jellyfinUrl.replace(/\/$/, "")}/System/Info/Public` : "", jellyfinBreaker),
    tmdbApiKey
      ? tmdbApiFetch("/3/configuration", { timeoutMs: 4000, retries: 0, skipCache: true })
          .then((res) => {
            if (!res.ok) tmdbBreaker.recordFailure()
          })
          .catch(() => { /* Transport failures are recorded by tmdbApiFetch. */ })
      : Promise.resolve(),
    probeDatabase(),
  ])

  // Per-user Jellyfin breakers live in the registry (not the shared global).
  // Report them as an aggregate so /health still flags widespread request-side
  // outages without letting any one session's failures block another's.
  const jellyfinAggregate = getAggregateOpen("jellyfin:")

  const breakers = {
    radarr: radarrBreaker.getState(),
    sonarr: sonarrBreaker.getState(),
    jellyfin: jellyfinBreaker.getState(),
    jellyfinSessions: {
      state: jellyfinAggregate.anyOpen ? "OPEN" : "CLOSED",
      openCount: jellyfinAggregate.openCount,
      name: "Jellyfin (per-user)",
    },
    tmdb: tmdbBreaker.getState(),
    postgres: postgresBreaker.getState(),
  }

  const isDegraded =
    Object.values(breakers).some((b) => b.state === "OPEN") ||
    jellyfinAggregate.anyOpen

  return NextResponse.json({
    status: isDegraded ? "degraded" : "ok",
    timestamp: new Date().toISOString(),
    services: breakers,
  })
}
