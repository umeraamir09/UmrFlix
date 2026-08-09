"use client"

import { useState } from "react"
import { useSWRConfig } from "swr"
import { Key, AlertTriangle, RefreshCw } from "lucide-react"

export function JellyfinReconnectCard({
  onSuccess,
}: {
  onSuccess?: () => void
}) {
  const { mutate } = useSWRConfig()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      // Mutate all jellyfin SWR keys to trigger fresh requests
      await mutate((key) => typeof key === "string" && key.includes("/api/jellyfin"), undefined, { revalidate: true })
      onSuccess?.()
    } catch {
      /* ignore */
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className="my-6 rounded-lg border border-amber-500/30 bg-amber-950/20 p-5 backdrop-blur-sm">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
            <Key className="size-5" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-white flex items-center gap-2">
              Jellyfin Connection Update Required
              <AlertTriangle className="size-4 text-amber-400" />
            </h4>
            <p className="text-xs text-grey-300">
              Your session with the Jellyfin media server needs to be refreshed. UmrFlix remains signed in.
            </p>
          </div>
        </div>

        <button
          onClick={handleRetry}
          disabled={retrying}
          className="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-xs font-semibold text-black hover:bg-amber-400 active:scale-95 transition-all cursor-pointer disabled:opacity-50 shrink-0"
        >
          <RefreshCw className={`size-3.5 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? "Reconnecting..." : "Reconnect Jellyfin"}
        </button>
      </div>
    </div>
  )
}
