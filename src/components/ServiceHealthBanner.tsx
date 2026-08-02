"use client"

import useSWR from "swr"
import { AlertTriangle } from "lucide-react"

type HealthResponse = {
  status: "ok" | "degraded"
  services: Record<string, { state: "CLOSED" | "OPEN" | "HALF-OPEN"; name: string }>
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function ServiceHealthBanner() {
  const { data } = useSWR<HealthResponse>("/api/health", fetcher, {
    refreshInterval: 30_000, // check health every 30 seconds
    revalidateOnFocus: false,
  })

  if (!data || data.status === "ok") return null

  const degradedServices = Object.values(data.services)
    .filter((s) => s.state === "OPEN")
    .map((s) => s.name)

  if (degradedServices.length === 0) return null

  return (
    <div className="bg-amber-950/90 border-b border-amber-500/30 px-4 sm:px-6 md:px-8 py-2 text-xs sm:text-sm text-amber-200 flex items-center justify-between gap-3 backdrop-blur-md w-full shrink-0">
      <div className="mx-auto flex max-w-[1600px] items-center gap-2 w-full">
        <AlertTriangle className="size-4 text-amber-400 shrink-0" />
        <span>
          <strong className="font-semibold text-amber-300">Notice:</strong>{" "}
          {degradedServices.join(", ")} {degradedServices.length === 1 ? "is" : "are"} currently unreachable. Catalog browsing and playback remain active.
        </span>
      </div>
    </div>
  )
}
