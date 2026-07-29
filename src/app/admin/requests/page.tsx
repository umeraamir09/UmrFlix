"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Film,
  Tv,
  ArrowLeft,
  Loader2,
  Search,
  Filter,
} from "lucide-react"

type RequestItem = {
  id: string
  tmdbId: number
  tvdbId?: number
  title: string
  mediaType: "movie" | "tv"
  year?: number
  requestedBy: {
    userId: string
    username: string
  }
  requestedAt: string
  status: "pending" | "approved" | "denied"
  qualityProfileId: number
  rootFolderPath: string
  denialReason?: string
  approvedBy?: string
  deniedBy?: string
}

type TabType = "all" | "pending" | "approved" | "denied"

export default function AdminRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>("pending")
  const [searchQuery, setSearchQuery] = useState("")

  const [denialModalOpen, setDenialModalOpen] = useState(false)
  const [targetReqId, setTargetReqId] = useState<string | null>(null)
  const [denialReason, setDenialReason] = useState("")
  const [actionSubmitting, setActionSubmitting] = useState(false)

  const fetchAdminRequests = async () => {
    try {
      const res = await fetch("/api/admin/requests")
      if (res.ok) {
        const data = await res.json()
        setRequests(data || [])
      }
    } catch {
      /* silent */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAdminRequests()
  }, [])

  const handleApprove = async (id: string) => {
    setActionSubmitting(true)
    try {
      await fetch("/api/admin/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, action: "approve" }),
      })
      await fetchAdminRequests()
    } finally {
      setActionSubmitting(false)
    }
  }

  const openDenyModal = (id: string) => {
    setTargetReqId(id)
    setDenialReason("")
    setDenialModalOpen(true)
  }

  const submitDeny = async () => {
    if (!targetReqId) return
    setActionSubmitting(true)
    try {
      await fetch("/api/admin/requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: targetReqId, action: "deny", reason: denialReason }),
      })
      setDenialModalOpen(false)
      setTargetReqId(null)
      await fetchAdminRequests()
    } finally {
      setActionSubmitting(false)
    }
  }

  const filteredRequests = requests
    .filter((r) => {
      if (activeTab === "pending") return r.status === "pending"
      if (activeTab === "approved") return r.status === "approved"
      if (activeTab === "denied") return r.status === "denied"
      return true
    })
    .filter((r) => {
      if (!searchQuery) return true
      return (
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.requestedBy.username.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })

  const pendingCount = requests.filter((r) => r.status === "pending").length
  const approvedCount = requests.filter((r) => r.status === "approved").length
  const deniedCount = requests.filter((r) => r.status === "denied").length

  return (
    <main className="min-h-screen bg-[#0a0b0d] text-foreground pb-20 pt-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">
              <Link href="/admin" className="hover:text-white flex items-center gap-1 transition-colors">
                <ArrowLeft className="size-3.5" /> Admin Dashboard
              </Link>
              <span>/</span>
              <span className="text-amber-400 font-bold">Request Management</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight uppercase">
              Request Approval Queue
            </h1>
            <p className="text-sm text-foreground-muted mt-1">
              Review media requests submitted by users. Approve to send to Radarr/Sonarr or Deny with notes.
            </p>
          </div>
        </div>

        {/* Filter Controls & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 border-b border-border/80 overflow-x-auto w-full sm:w-auto">
            {(["pending", "all", "approved", "denied"] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-5 py-3 text-xs font-black uppercase tracking-wider border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                  activeTab === tab
                    ? "border-amber-400 text-white bg-surface/40"
                    : "border-transparent text-gray-400 hover:text-gray-200 hover:bg-surface/20"
                }`}
              >
                {tab === "pending" && `Pending Queue (${pendingCount})`}
                {tab === "all" && `All Requests (${requests.length})`}
                {tab === "approved" && `Approved (${approvedCount})`}
                {tab === "denied" && `Denied (${deniedCount})`}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search title or username..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-border px-3 py-2 pl-9 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Request Grid */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="size-8 animate-spin text-amber-400 mb-3" />
            <p className="text-sm font-medium">Loading requests...</p>
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="p-12 border border-border/60 bg-card text-center space-y-3">
            <CheckCircle2 className="size-10 mx-auto text-emerald-500 opacity-60" />
            <h3 className="text-base font-bold text-white uppercase">No requests found</h3>
            <p className="text-xs text-foreground-muted">
              {activeTab === "pending" ? "No pending requests awaiting approval!" : `No requests found for query.`}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRequests.map((req) => (
              <div
                key={req.id}
                className="p-4 border border-border/80 bg-card flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-gray-500 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-surface text-amber-400 border border-border shrink-0">
                    {req.mediaType === "movie" ? <Film className="size-5" /> : <Tv className="size-5" />}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-white text-base">{req.title}</h3>
                      <span className="px-2 py-0.5 text-[10px] font-black uppercase bg-surface text-gray-300 border border-border">
                        {req.mediaType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>Requested by <strong className="text-white">{req.requestedBy.username}</strong></span>
                      <span>&bull;</span>
                      <span>{new Date(req.requestedAt).toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-gray-500 font-mono">Target: {req.rootFolderPath}</p>
                    {req.denialReason && (
                      <p className="text-xs text-red-400 font-medium pt-1">Reason: {req.denialReason}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                  {req.status === "pending" && (
                    <>
                      <button
                        onClick={() => handleApprove(req.id)}
                        disabled={actionSubmitting}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow cursor-pointer disabled:opacity-50"
                      >
                        Approve & Dispatch
                      </button>
                      <button
                        onClick={() => openDenyModal(req.id)}
                        disabled={actionSubmitting}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow cursor-pointer disabled:opacity-50"
                      >
                        Deny
                      </button>
                    </>
                  )}

                  {req.status === "approved" && (
                    <span className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs uppercase border border-emerald-500/40">
                      Approved ({req.approvedBy})
                    </span>
                  )}

                  {req.status === "denied" && (
                    <span className="px-3 py-1.5 rounded bg-red-500/20 text-red-300 font-bold text-xs uppercase border border-red-500/40">
                      Denied ({req.deniedBy})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Denial Reason Modal */}
        {denialModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-md bg-[#141519] border border-border p-6 shadow-2xl space-y-4">
              <h3 className="text-lg font-extrabold text-white uppercase tracking-tight">Deny Media Request</h3>
              <p className="text-xs text-foreground-muted">
                Please enter a reason for denying this request. This message will be sent directly to the user.
              </p>
              <textarea
                rows={3}
                placeholder="e.g. Content already available in catalog, rating restriction, low bandwidth..."
                value={denialReason}
                onChange={(e) => setDenialReason(e.target.value)}
                className="w-full bg-surface border border-border p-3 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
              />
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => setDenialModalOpen(false)}
                  className="px-4 py-2 bg-surface hover:bg-surface-hover text-gray-300 font-bold text-xs uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  onClick={submitDeny}
                  disabled={actionSubmitting}
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs uppercase tracking-wider shadow cursor-pointer disabled:opacity-50"
                >
                  Confirm Denial
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </main>
  )
}
