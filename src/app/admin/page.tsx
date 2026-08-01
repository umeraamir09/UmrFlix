"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  ShieldCheck,
  Clock,
  Download,
  HardDrive,
  Tv,
  CheckCircle2,
  XCircle,
  Pause,
  Play,
  Trash2,
  Loader2,
  RefreshCw,
  Film,
  Users,
  AlertCircle,
  ExternalLink,
} from "lucide-react"

import useSWR from "swr"

import type { RequestItem } from "@/lib/requests-store"
import { useEventStream, onReFetch } from "@/lib/use-event-stream"
import { AdminRequestCard, type ProfileMapData } from "@/components/AdminRequestCard"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

type TorrentItem = {
  hash: string
  name: string
  size: number
  progress: number
  dlspeed: number
  upspeed: number
  eta: number
  state: string
  num_seeds: number
  num_leechs: number
}

type JellyfinSessionItem = {
  Id: string
  UserName?: string
  Client?: string
  DeviceName?: string
  NowPlayingItem?: {
    Name: string
    SeriesName?: string
    Type: string
  }
  TranscodingInfo?: {
    IsVideoDirect?: boolean
    TranscodeReason?: string
  }
}

type StorageData = {
  totalFreeBytes: number
  totalCapacityBytes: number
  usedBytes: number
  usedPercentage: number
}

export default function AdminDashboardPage() {
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [torrents, setTorrents] = useState<TorrentItem[]>([])
  const [sessions, setSessions] = useState<JellyfinSessionItem[]>([])
  const [storage, setStorage] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Fetch profiles for quality profile and tag resolution
  const { data: radarrProfiles } = useSWR<ProfileMapData>("/api/radarr/profiles", fetcher)
  const { data: sonarrProfiles } = useSWR<ProfileMapData>("/api/sonarr/profiles", fetcher)

  const fetchData = async () => {
    try {
      const [reqRes, qbitRes, jellyRes, storeRes] = await Promise.all([
        fetch("/api/admin/requests").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/admin/qbittorrent").then((r) => (r.ok ? r.json() : { torrents: [] })),
        fetch("/api/admin/jellyfin/sessions").then((r) => (r.ok ? r.json() : { sessions: [] })),
        fetch("/api/admin/storage").then((r) => (r.ok ? r.json() : null)),
      ])

      setRequests(reqRes || [])
      setTorrents(qbitRes?.torrents || [])
      setSessions(jellyRes?.sessions || [])
      setStorage(storeRes)
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }

  useEventStream()

  useEffect(() => {
    fetchData()
    const unsub = onReFetch(fetchData)
    return () => unsub()
  }, [])

  const handleApprove = async (id: string) => {
    setActionLoading(id)
    try {
      await fetch("/api/admin/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action: "approve" }),
      })
      await fetchData()
    } finally {
      setActionLoading(null)
    }
  }

  const handleDeny = async (id: string) => {
    const reason = prompt("Enter reason for denying this request (optional):")
    setActionLoading(id)
    try {
      await fetch("/api/admin/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action: "deny", reason }),
      })
      await fetchData()
    } finally {
      setActionLoading(null)
    }
  }

  const handleTorrentAction = async (action: "pause" | "resume" | "delete", hash: string, name?: string) => {
    let deleteFiles = false
    if (action === "delete") {
      const confirmDelete = confirm(`Are you sure you want to delete "${name || "this torrent"}"?`)
      if (!confirmDelete) return
      deleteFiles = confirm("Do you also want to delete downloaded files from disk?")
    }

    setActionLoading(hash)
    try {
      const res = await fetch("/api/admin/qbittorrent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, hashes: [hash], deleteFiles }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) {
        alert(data.error || `Failed to ${action} torrent.`)
      }
      await fetchData()
    } catch {
      alert("Network error executing torrent action.")
    } finally {
      setActionLoading(null)
    }
  }

  const handleStopSession = async (sessionId: string) => {
    setActionLoading(sessionId)
    try {
      await fetch("/api/admin/jellyfin/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      })
      await fetchData()
    } finally {
      setActionLoading(null)
    }
  }

  const pendingRequests = requests.filter((r) => r.status === "pending")
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 GB"
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1000) return `${(gb / 1024).toFixed(2)} TB`
    return `${gb.toFixed(1)} GB`
  }

  return (
    <main className="min-h-screen bg-[#0a0b0d] text-foreground pb-20 pt-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-amber-400 uppercase tracking-widest mb-1">
              <ShieldCheck className="size-4" /> Admin Control Panel
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight uppercase">
              System Dashboard
            </h1>
            <p className="text-sm text-foreground-muted mt-1">
              Manage non-admin requests, qBittorrent downloads, Jellyfin streams, and system storage.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={fetchData}
              className="flex items-center gap-2 px-4 py-2 bg-surface hover:bg-surface-hover text-white text-xs font-bold uppercase tracking-wider border border-border transition-colors cursor-pointer"
            >
              <RefreshCw className="size-3.5" /> Refresh
            </button>
            <Link
              href="/admin/requests"
              className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95"
            >
              <span>MANAGE REQUESTS ({pendingRequests.length})</span>
            </Link>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Pending Requests */}
          <div className="p-5 border border-border/80 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Pending Requests</span>
              <Clock className="size-5 text-amber-400" />
            </div>
            <div className="text-3xl font-black text-white">{pendingRequests.length}</div>
            <p className="text-xs text-foreground-muted">Awaiting Admin Approval</p>
          </div>

          {/* Card 2: Active Torrents */}
          <div className="p-5 border border-border/80 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Downloads</span>
              <Download className="size-5 text-blue-400" />
            </div>
            <div className="text-3xl font-black text-white">{torrents.length}</div>
            <p className="text-xs text-foreground-muted">qBittorrent Torrents</p>
          </div>

          {/* Card 3: Active Streams */}
          <div className="p-5 border border-border/80 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Active Jellyfin Streams</span>
              <Tv className="size-5 text-purple-400" />
            </div>
            <div className="text-3xl font-black text-white">{sessions.length}</div>
            <p className="text-xs text-foreground-muted">Active Playback Sessions</p>
          </div>

          {/* Card 4: Total Storage Used */}
          <div className="p-5 border border-border/80 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Storage Capacity</span>
              <HardDrive className="size-5 text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-white">
              {storage ? `${storage.usedPercentage}%` : "N/A"}
            </div>
            <p className="text-xs text-foreground-muted">
              {storage ? `${formatBytes(storage.usedBytes)} / ${formatBytes(storage.totalCapacityBytes)}` : "Storage Monitoring"}
            </p>
          </div>
        </div>

        {/* Storage Bar Widget */}
        {storage && storage.totalCapacityBytes > 0 && (
          <div className="p-5 border border-border/80 bg-card space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <HardDrive className="size-4 text-emerald-400" /> Disk Storage Breakdown
              </span>
              <span className="text-xs font-mono font-bold text-gray-300">
                {formatBytes(storage.totalFreeBytes)} FREE
              </span>
            </div>
            <div className="w-full bg-surface h-3 rounded-none overflow-hidden border border-border flex">
              <div
                className="bg-accent h-full transition-all duration-500"
                style={{ width: `${Math.min(100, storage.usedPercentage)}%` }}
              />
            </div>
          </div>
        )}

        {/* Webhook Configuration & Real-Time SSE System Card */}
        <div className="p-5 border border-border/80 bg-card space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <RefreshCw className="size-4 text-accent animate-spin-slow" /> Webhook Integration & Real-Time Event Bridge
              </h2>
              <p className="text-xs text-foreground-muted mt-0.5">
                Configure Radarr & Sonarr webhooks to push instant notifications without polling.
              </p>
            </div>
            <button
              onClick={async () => {
                await fetch("/api/webhooks", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    eventType: "Download",
                    movie: { title: "Test Realtime Movie" },
                  }),
                })
              }}
              className="px-3 py-1.5 bg-accent hover:bg-accent-hover text-white text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer shrink-0"
            >
              Emit Test Webhook Event
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-3 bg-surface border border-border space-y-1">
              <span className="font-bold text-gray-300 uppercase tracking-wider block">Webhook Endpoint URL</span>
              <code className="text-accent font-mono text-[11px] block select-all">/api/webhooks</code>
              <p className="text-gray-400 text-[11px] mt-1">
                Set URL in Radarr/Sonarr &rarr; Settings &rarr; Connect &rarr; Webhook (`On Grab`, `On Download`, `On Rename`).
              </p>
            </div>
            <div className="p-3 bg-surface border border-border space-y-1">
              <span className="font-bold text-gray-300 uppercase tracking-wider block">Server-Sent Events Stream</span>
              <code className="text-emerald-400 font-mono text-[11px] block select-all">/api/events</code>
              <p className="text-gray-400 text-[11px] mt-1">
                Real-time event stream active. Broadcasts updates instantly to all connected browser clients.
              </p>
            </div>
          </div>
        </div>


        {/* Pending Requests Approval Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
              <Clock className="size-5 text-amber-400" /> Pending Requests Approval Queue ({pendingRequests.length})
            </h2>
            <Link href="/admin/requests" className="text-xs font-bold text-accent hover:underline">
              View All Requests &rarr;
            </Link>
          </div>

          {pendingRequests.length === 0 ? (
            <div className="p-8 border border-border/60 bg-card text-center text-foreground-muted text-sm">
              <CheckCircle2 className="size-8 mx-auto text-emerald-500 mb-2 opacity-80" />
              No pending requests requiring approval.
            </div>
          ) : (
            <div className="space-y-4">
              {pendingRequests.map((req) => (
                <AdminRequestCard
                  key={req.id}
                  request={req}
                  radarrProfiles={radarrProfiles}
                  sonarrProfiles={sonarrProfiles}
                  onApprove={handleApprove}
                  onDeny={handleDeny}
                  actionLoading={actionLoading === req.id}
                />
              ))}
            </div>
          )}
        </div>

        {/* Live qBittorrent Torrents Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Download className="size-5 text-blue-400" /> qBittorrent Active Downloads ({torrents.length})
          </h2>

          {torrents.length === 0 ? (
            <div className="p-8 border border-border/60 bg-card text-center text-foreground-muted text-sm">
              No active torrent downloads in qBittorrent queue (or qBittorrent connection offline).
            </div>
          ) : (
            <div className="border border-border/80 bg-card overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-300">
                <thead className="bg-surface text-gray-400 font-bold uppercase tracking-wider border-b border-border/80">
                  <tr>
                    <th className="p-3">Torrent Name</th>
                    <th className="p-3">Progress</th>
                    <th className="p-3">Size</th>
                    <th className="p-3">Speed (DL/UL)</th>
                    <th className="p-3">State</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {torrents.map((t) => (
                    <tr key={t.hash} className="hover:bg-surface/30">
                      <td className="p-3 font-semibold text-white truncate max-w-[240px]" title={t.name}>
                        {t.name}
                      </td>
                      <td className="p-3 font-mono">
                        <div className="flex items-center gap-2">
                          <div className="w-20 bg-surface h-2 border border-border">
                            <div className="bg-blue-500 h-full" style={{ width: `${Math.round(t.progress * 100)}%` }} />
                          </div>
                          <span>{(t.progress * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td className="p-3 font-mono">{formatBytes(t.size)}</td>
                      <td className="p-3 font-mono text-blue-400">
                        {(t.dlspeed / (1024 * 1024)).toFixed(2)} MB/s
                      </td>
                      <td className="p-3 uppercase font-bold text-[10px] text-amber-300">{t.state}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!t.hash.startsWith("radarr_") && !t.hash.startsWith("sonarr_") && (
                            <>
                              <button
                                disabled={actionLoading === t.hash}
                                onClick={() => handleTorrentAction("pause", t.hash, t.name)}
                                className="p-1.5 hover:bg-surface text-gray-300 hover:text-white disabled:opacity-50 transition-colors cursor-pointer"
                                title="Pause Torrent"
                              >
                                <Pause className="size-4" />
                              </button>
                              <button
                                disabled={actionLoading === t.hash}
                                onClick={() => handleTorrentAction("resume", t.hash, t.name)}
                                className="p-1.5 hover:bg-surface text-gray-300 hover:text-emerald-400 disabled:opacity-50 transition-colors cursor-pointer"
                                title="Resume Torrent"
                              >
                                <Play className="size-4" />
                              </button>
                            </>
                          )}
                          <button
                            disabled={actionLoading === t.hash}
                            onClick={() => handleTorrentAction("delete", t.hash, t.name)}
                            className="p-1.5 hover:bg-surface text-gray-300 hover:text-red-400 disabled:opacity-50 transition-colors cursor-pointer"
                            title="Delete Torrent"
                          >
                            {actionLoading === t.hash ? <Loader2 className="size-4 animate-spin text-amber-400" /> : <Trash2 className="size-4" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Jellyfin Active Sessions Section */}
        <div className="space-y-4">
          <h2 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
            <Tv className="size-5 text-purple-400" /> Active Jellyfin Streams ({sessions.length})
          </h2>

          {sessions.length === 0 ? (
            <div className="p-8 border border-border/60 bg-card text-center text-foreground-muted text-sm">
              No active users streaming from Jellyfin currently.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sessions.map((s) => (
                <div key={s.Id} className="p-4 border border-border/80 bg-card flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-white text-sm">{s.UserName || "User"}</span>
                      <span className="text-xs text-gray-400">&bull; {s.Client || "Client"}</span>
                    </div>
                    <p className="text-xs text-purple-300 font-semibold">
                      {s.NowPlayingItem?.SeriesName ? `${s.NowPlayingItem.SeriesName} - ` : ""}
                      {s.NowPlayingItem?.Name || "Media Item"}
                    </p>
                    <p className="text-[11px] text-gray-400">
                      {s.TranscodingInfo?.IsVideoDirect ? "Direct Play" : "Transcoding"}
                    </p>
                  </div>

                  <button
                    onClick={() => handleStopSession(s.Id)}
                    disabled={actionLoading === s.Id}
                    className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 text-white font-bold text-xs uppercase transition-all shadow cursor-pointer disabled:opacity-50"
                  >
                    Stop Stream
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  )
}
