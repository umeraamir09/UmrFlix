"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  ArrowLeft,
  Loader2,
  Search,
  CheckCircle2,
} from "lucide-react"

import type { RequestItem } from "@/lib/requests-store"
import { AdminRequestCard, type ProfileMapData } from "@/components/AdminRequestCard"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

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

  // Fetch Radarr & Sonarr profiles to resolve Quality Profile names and Tags
  const { data: radarrProfiles } = useSWR<ProfileMapData>("/api/radarr/profiles", fetcher)
  const { data: sonarrProfiles } = useSWR<ProfileMapData>("/api/sonarr/profiles", fetcher)

  const fetchAdminRequests = async () => {
    try {
      const res = await fetch("/api/admin/requests")
      if (res.ok) {
        const data = await res.json()
        setRequests(data || [])
      }
    } catch {
      console.error("[AdminRequests] Failed to fetch admin requests")
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
      const q = searchQuery.toLowerCase()
      return (
        r.title.toLowerCase().includes(q) ||
        r.requestedBy.username.toLowerCase().includes(q) ||
        r.rootFolderPath.toLowerCase().includes(q)
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
              Review detailed media requests submitted by users. Inspect requested seasons, quality profile settings, destination folders, and approve or deny.
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
              placeholder="Search title, user, or path..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-border px-3 py-2 pl-9 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        {/* Request Cards List */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="size-8 animate-spin text-amber-400 mb-3" />
            <p className="text-sm font-medium">Loading requests & technical specifications...</p>
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
          <div className="space-y-4">
            {filteredRequests.map((req) => (
              <AdminRequestCard
                key={req.id}
                request={req}
                radarrProfiles={radarrProfiles}
                sonarrProfiles={sonarrProfiles}
                onApprove={handleApprove}
                onDeny={openDenyModal}
                actionLoading={actionSubmitting}
              />
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
