"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  Clock,
  CheckCircle2,
  XCircle,
  Film,
  Tv,
  AlertTriangle,
  Loader2,
  Search,
  ArrowLeft,
  BookmarkPlus,
  Download,
} from "lucide-react"
import { formatSpeed, formatEta } from "@/lib/format"

type TrackedDownload = {
  requestId: string
  userId: string
  title: string
  mediaType: "movie" | "tv"
  tmdbId?: number
  progress: number
  dlspeed?: number
  eta?: number
  state?: string
  hash?: string
  updatedAt: number
}

type RequestItem = {
  id: string
  tmdbId: number
  tvdbId?: number
  title: string
  mediaType: "movie" | "tv"
  year?: number
  posterPath?: string
  backdropPath?: string
  requestedBy: {
    userId: string
    username: string
  }
  requestedAt: string
  status: "pending" | "approved" | "denied"
  qualityProfileId: number
  rootFolderPath: string
  seasons?: { seasonNumber: number; monitored: boolean }[]
  denialReason?: string
  approvedAt?: string
  approvedBy?: string
  deniedAt?: string
  deniedBy?: string
}

type TabType = "all" | "pending" | "approved" | "denied"

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>("all")

  const { data: downloadsData } = useSWR<{ items: TrackedDownload[] }>("/api/downloads/progress", {
    refreshInterval: 10_000,
    revalidateOnFocus: true,
  })

  const progressByRequestId = new Map<string, TrackedDownload>()
  for (const item of downloadsData?.items ?? []) {
    progressByRequestId.set(item.requestId, item)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/requests/my")
        if (res.ok) {
          const data = await res.json()
          if (!cancelled) setRequests(data || [])
        }
      } catch {
        console.error("[RequestsPage] Failed to fetch user requests")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredRequests = requests.filter((r) => {
    if (activeTab === "pending") return r.status === "pending"
    if (activeTab === "approved") return r.status === "approved"
    if (activeTab === "denied") return r.status === "denied"
    return true
  })

  const pendingCount = requests.filter((r) => r.status === "pending").length
  const approvedCount = requests.filter((r) => r.status === "approved").length
  const deniedCount = requests.filter((r) => r.status === "denied").length

  return (
    <main className="min-h-screen bg-[#0a0b0d] text-foreground pb-20 pt-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Top Header & Breadcrumb */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
              <Link href="/" className="hover:text-white flex items-center gap-1 transition-colors">
                <ArrowLeft className="size-3.5" /> Home
              </Link>
              <span>/</span>
              <span className="text-accent">User Requests</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight uppercase">
              My Media Requests
            </h1>
            <p className="text-sm text-foreground-muted mt-1">
              Track approval status, download progress, and decision notes for content you requested.
            </p>
          </div>

          <Link
            href="/search"
            className="self-start sm:self-auto flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white text-xs font-black uppercase tracking-wider transition-all shadow-md active:scale-95"
          >
            <Search className="size-4" />
            <span>REQUEST NEW ITEM</span>
          </Link>
        </div>

        {/* Status Counter Stats Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div
            onClick={() => setActiveTab("all")}
            className={`cursor-pointer p-4 border transition-all ${
              activeTab === "all" ? "border-white bg-surface" : "border-border/60 bg-card hover:bg-surface/50"
            }`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Total Submitted</span>
            <div className="text-3xl font-black text-white mt-1">{requests.length}</div>
          </div>

          <div
            onClick={() => setActiveTab("pending")}
            className={`cursor-pointer p-4 border transition-all ${
              activeTab === "pending" ? "border-amber-400 bg-amber-500/10" : "border-border/60 bg-card hover:bg-surface/50"
            }`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1">
              <Clock className="size-3.5" /> Pending
            </span>
            <div className="text-3xl font-black text-amber-300 mt-1">{pendingCount}</div>
          </div>

          <div
            onClick={() => setActiveTab("approved")}
            className={`cursor-pointer p-4 border transition-all ${
              activeTab === "approved" ? "border-emerald-400 bg-emerald-500/10" : "border-border/60 bg-card hover:bg-surface/50"
            }`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="size-3.5" /> Approved
            </span>
            <div className="text-3xl font-black text-emerald-300 mt-1">{approvedCount}</div>
          </div>

          <div
            onClick={() => setActiveTab("denied")}
            className={`cursor-pointer p-4 border transition-all ${
              activeTab === "denied" ? "border-red-400 bg-red-500/10" : "border-border/60 bg-card hover:bg-surface/50"
            }`}
          >
            <span className="text-xs font-bold uppercase tracking-wider text-red-400 flex items-center gap-1">
              <XCircle className="size-3.5" /> Denied
            </span>
            <div className="text-3xl font-black text-red-300 mt-1">{deniedCount}</div>
          </div>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-2 border-b border-border/80 overflow-x-auto">
          {(["all", "pending", "approved", "denied"] as TabType[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === tab
                  ? "border-accent text-white bg-surface/40"
                  : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-surface/20"
              }`}
            >
              {tab === "all" && `All Requests (${requests.length})`}
              {tab === "pending" && `Pending Approval (${pendingCount})`}
              {tab === "approved" && `Approved (${approvedCount})`}
              {tab === "denied" && `Denied (${deniedCount})`}
            </button>
          ))}
        </div>

        {/* Request Items Grid / List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="size-8 animate-spin text-accent mb-3" />
            <p className="text-sm font-medium">Loading your media requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 border border-border/60 bg-card text-center space-y-4">
            <BookmarkPlus className="size-12 mx-auto text-gray-600" />
            <h3 className="text-lg font-bold text-white uppercase">No requests found</h3>
            <p className="text-sm text-foreground-muted max-w-md mx-auto">
              {activeTab === "all"
                ? "You haven't submitted any movie or TV show requests yet."
                : `You don't have any requests in '${activeTab}' status.`}
            </p>
            <Link
              href="/search"
              className="inline-flex items-center gap-2 px-6 py-3 bg-accent hover:bg-accent-hover text-white text-xs font-black uppercase tracking-wider shadow-md transition-all"
            >
              Search & Request Media
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredRequests.map((req) => (
              <div
                key={req.id}
                className="border border-border/80 bg-card p-5 space-y-4 hover:border-gray-500 transition-colors"
              >
                {/* Header info */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-surface text-accent border border-border">
                      {req.mediaType === "movie" ? <Film className="size-5" /> : <Tv className="size-5" />}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white tracking-tight">{req.title}</h3>
                      <div className="flex items-center gap-2 text-xs text-foreground-muted mt-0.5">
                        <span className="uppercase font-semibold text-gray-300">{req.mediaType}</span>
                        {req.year && <span>&bull; {req.year}</span>}
                        <span>&bull; Requested {new Date(req.requestedAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {req.status === "pending" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500/20 text-amber-300 font-black text-xs uppercase border border-amber-500/40">
                        <Clock className="size-3.5 animate-pulse" /> Pending
                      </span>
                    )}
                    {req.status === "approved" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-500/20 text-emerald-300 font-black text-xs uppercase border border-emerald-500/40">
                        <CheckCircle2 className="size-3.5" /> Approved
                      </span>
                    )}
                    {req.status === "denied" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-500/20 text-red-300 font-black text-xs uppercase border border-red-500/40">
                        <XCircle className="size-3.5" /> Denied
                      </span>
                    )}
                  </div>
                </div>

                {/* Details Footer */}
                <div className="p-3 bg-surface/50 border border-border/40 text-xs text-gray-300 space-y-1.5">
                  {req.mediaType === "tv" && req.seasons && req.seasons.length > 0 && (
                    <div className="flex justify-between items-start">
                      <span className="text-foreground-muted">Seasons:</span>
                      <span className="font-semibold text-amber-300 text-right">
                        {req.seasons.filter((s) => s.monitored).length === req.seasons.length
                          ? `All Seasons (1–${req.seasons.length})`
                          : req.seasons.filter((s) => s.monitored).length === 0
                          ? "Future Only"
                          : `Seasons ${req.seasons.filter((s) => s.monitored).map((s) => s.seasonNumber).join(", ")}`}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-foreground-muted">Target Path:</span>
                    <span className="font-mono text-gray-200 truncate max-w-[200px]">{req.rootFolderPath}</span>
                  </div>
                  {req.approvedBy && (
                    <div className="flex justify-between">
                      <span className="text-foreground-muted">Approved By:</span>
                      <span className="font-semibold text-emerald-400">{req.approvedBy}</span>
                    </div>
                  )}
                  {req.deniedBy && (
                    <div className="flex justify-between">
                      <span className="text-foreground-muted">Denied By:</span>
                      <span className="font-semibold text-red-400">{req.deniedBy}</span>
                    </div>
                  )}

                  {req.status === "approved" && progressByRequestId.has(req.id) && (
                    (() => {
                      const live = progressByRequestId.get(req.id)!
                      const pct = Math.min(100, Math.max(0, Math.round(live.progress)))
                      return (
                        <div className="pt-1.5 border-t border-border/40">
                          <div className="flex items-center justify-between text-[10px] uppercase tracking-wider mb-1">
                            <span className="text-foreground-muted flex items-center gap-1">
                              <Download className="size-3 text-amber-400" /> Download Progress
                            </span>
                            <span className="text-amber-300 font-black">{pct}%</span>
                          </div>
                          <div className="h-1.5 w-full bg-surface border border-border/40 overflow-hidden">
                            <div
                              className="h-full bg-accent transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-gray-400 mt-1">
                            <span>{formatSpeed(live.dlspeed)}</span>
                            <span>{live.eta != null ? `ETA ${formatEta(live.eta)}` : ""}</span>
                          </div>
                        </div>
                      )
                    })()
                  )}
                </div>

                {/* Denial Reason Alert if rejected */}
                {req.status === "denied" && req.denialReason && (
                  <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-300 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider">
                      <AlertTriangle className="size-4 text-red-400" /> Denial Reason:
                    </div>
                    <p className="pl-5 text-gray-200">{req.denialReason}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
