"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, LogOut, ShieldAlert, UserPlus, Users, XCircle } from "lucide-react"
import type { PartyMember } from "@/lib/party/protocol"
import { StartPartyModal } from "./StartPartyModal"

const STORAGE_KEY = "party-bar-collapsed"

export type PartyBarProps = {
  partyId: string
  isOwner: boolean
  members: PartyMember[]
  bufferingUsers?: string[]
}

export function PartyBar({
  partyId,
  isOwner,
  members,
  bufferingUsers = [],
}: PartyBarProps) {
  const router = useRouter()
  const [inviteModalOpen, setInviteModalOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window === "undefined") return false
    return sessionStorage.getItem(STORAGE_KEY) === "true"
  })

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev
      try {
        if (next) sessionStorage.setItem(STORAGE_KEY, "true")
        else sessionStorage.removeItem(STORAGE_KEY)
      } catch {}
      return next
    })
  }, [])

  const handleLeave = async () => {
    setLeaving(true)
    try {
      await fetch(`/api/party/${partyId}/leave`, { method: "POST" })
      router.push("/")
    } catch (err) {
      console.error("[PartyBar] Error leaving party:", err)
      setLeaving(false)
    }
  }

  const handleEndParty = async () => {
    setLeaving(true)
    try {
      await fetch(`/api/party/${partyId}/end`, { method: "POST" })
      router.push("/")
    } catch (err) {
      console.error("[PartyBar] Error ending party:", err)
      setLeaving(false)
    }
  }

  const memberCount = members.length
  const firstTwo = members.slice(0, 2)
  const extraCount = memberCount - 2

  return (
    <>
      <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-1.5">
        {/* Collapsed pill */}
        {isCollapsed && (
          <button
            onClick={toggleCollapsed}
            title="Show Party Bar"
            className="flex items-center gap-2 bg-black/70 backdrop-blur-xl border border-white/15 px-3 py-2 text-white shadow-xl rounded-none transition-all duration-300 hover:bg-black/80 group"
          >
            <div className="flex items-center gap-1.5">
              <Users className="size-3.5 text-accent" />
              <span className="text-xs font-bold text-gray-200">{memberCount}</span>
            </div>
            <div className="flex -space-x-1.5">
              {firstTwo.map((m) => (
                <div
                  key={m.userId}
                  title={m.username}
                  className={`flex size-6 items-center justify-center rounded-full border border-black text-[9px] font-bold ${
                    m.buffering
                      ? "border-amber-500 bg-amber-500/20 text-amber-300"
                      : "border-black bg-accent text-white"
                  }`}
                >
                  {m.username.substring(0, 2).toUpperCase()}
                </div>
              ))}
              {extraCount > 0 && (
                <div className="flex size-6 items-center justify-center rounded-full bg-gray-700 text-[9px] font-bold text-gray-300 border border-black">
                  +{extraCount}
                </div>
              )}
            </div>
            <ChevronDown className="size-3.5 text-gray-400 transition-transform group-hover:text-white" />
          </button>
        )}

        {/* Expanded bar */}
        <div
          className={`flex items-center gap-2.5 bg-black/70 backdrop-blur-xl border border-white/15 px-3 py-2 text-white shadow-xl rounded-none transition-all duration-300 ${
            isCollapsed
              ? "pointer-events-none max-h-0 scale-95 opacity-0 overflow-hidden px-0 py-0 border-transparent"
              : "max-h-20 scale-100 opacity-100"
          }`}
        >
          {/* Toggle Collapse Button */}
          <button
            onClick={toggleCollapsed}
            title="Collapse Party Bar"
            className="flex items-center justify-center size-7 rounded-none bg-white/5 hover:bg-white/15 transition-colors shrink-0"
          >
            <ChevronDown className="size-3.5 text-gray-400 rotate-180" />
          </button>

          {/* Active Members Stack */}
          <div className="flex items-center gap-1.5">
            <Users className="size-4 text-accent mr-0.5" />
            <div className="flex -space-x-2 overflow-hidden">
              {members.map((m) => (
                <div
                  key={m.userId}
                  title={`${m.username}${m.buffering ? " (Buffering)" : ""}`}
                  className={`relative flex size-7 items-center justify-center rounded-full border-2 text-[10px] font-bold transition-transform hover:z-10 hover:scale-110 ${
                    m.buffering
                      ? "border-amber-500 bg-amber-500/20 text-amber-300"
                      : "border-black bg-accent text-white"
                  }`}
                >
                  {m.username.substring(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
            <span className="text-xs font-semibold text-gray-300 ml-1">
              {memberCount}
            </span>
          </div>

          {/* Buffering Chip */}
          {bufferingUsers.length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-1 text-xs font-bold animate-pulse shrink-0">
              <ShieldAlert className="size-3.5" />
              <span>Waiting for {bufferingUsers.join(", ")}…</span>
            </div>
          )}

          {/* Host Badge */}
          {isOwner && (
            <span className="px-2 py-0.5 rounded bg-accent/20 border border-accent/40 text-accent font-extrabold text-[10px] uppercase tracking-wider shrink-0">
              Host
            </span>
          )}

          {/* Invite Button */}
          <button
            onClick={() => setInviteModalOpen(true)}
            className="flex items-center gap-1 bg-white/10 hover:bg-white/20 px-2.5 py-1 text-xs font-bold text-gray-200 transition-colors border border-white/10 shrink-0"
            title="Invite Friends"
          >
            <UserPlus className="size-3.5 text-accent" />
            <span>Invite</span>
          </button>

          {/* End Party Button (host only) */}
          {isOwner && (
            <button
              onClick={handleEndParty}
              disabled={leaving}
              className="flex items-center gap-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/60 px-2.5 py-1 text-xs font-bold transition-colors shrink-0"
              title="End Party for Everyone"
            >
              <XCircle className="size-3.5" />
              <span>End</span>
            </button>
          )}

          {/* Leave Button */}
          <button
            onClick={handleLeave}
            disabled={leaving}
            className="flex items-center gap-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 px-2.5 py-1 text-xs font-bold transition-colors shrink-0"
            title="Leave Party"
          >
            <LogOut className="size-3.5" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      <StartPartyModal
        isOpen={inviteModalOpen}
        onClose={() => setInviteModalOpen(false)}
        existingPartyId={partyId}
      />
    </>
  )
}
