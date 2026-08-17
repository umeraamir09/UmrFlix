"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import useSWR from "swr"
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  XCircle,
  ShieldCheck,
  Download,
  Inbox,
  Play,
} from "lucide-react"
import { useEventStream, onReFetch } from "@/lib/use-event-stream"
import { formatSpeed, formatEta } from "@/lib/format"
import { useToast } from "@/components/Toast"
import type { UserNotification } from "@/lib/requests-store"

type NotificationsResponse = {
  notifications: UserNotification[]
  unreadCount: number
}

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

type DownloadsResponse = {
  items: TrackedDownload[]
  fetchedAt?: number
}

const fetcher = (url: string) =>
  fetch(url).then((r) => r.json()) as Promise<NotificationsResponse>

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const hasSubscribedRef = useRef(false)
  const { toast } = useToast()

  useEventStream()

  const { data, mutate } = useSWR("/api/notifications", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  const downloadsFetcher = (url: string) =>
    fetch(url).then((r) => r.json()) as Promise<DownloadsResponse>

  const { data: downloadsData } = useSWR<DownloadsResponse>("/api/downloads/progress", downloadsFetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  })

  const notifications = data?.notifications ?? []
  const unreadNotifications = notifications.filter((n) => !n.read)
  const readNotifications = notifications.filter((n) => n.read)
  const visibleNotifications = [...unreadNotifications, ...readNotifications]
  const unreadCount = data?.unreadCount ?? 0

  const progressByRequestId = new Map<string, TrackedDownload>()
  for (const item of downloadsData?.items ?? []) {
    progressByRequestId.set(item.requestId, item)
  }

  // SSE-triggered refresh: fetch notifications and set SWR cache directly
  const handleReFetch = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications")
      if (res.ok) {
        const fresh = await res.json()
        mutate(fresh, false)
      }
    } catch {
      // Silently fail — next poll will pick up changes
    }
  }, [mutate])

  // Subscribe to SSE re-fetch signals
  useEffect(() => {
    if (hasSubscribedRef.current) return
    hasSubscribedRef.current = true
    const unsub = onReFetch(handleReFetch)
    return () => unsub()
  }, [handleReFetch])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [open])

  const markAsRead = async (notificationId: string) => {
    const wasUnread = data?.notifications.find((n) => n.id === notificationId)?.read === false
    mutate(
      (current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((n) =>
                n.id === notificationId ? { ...n, read: true } : n
              ),
              unreadCount: Math.max(0, current.unreadCount - (wasUnread ? 1 : 0)),
            }
          : current,
      false
    )
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
      const fresh = await res.json()
      mutate(fresh, false)
    } catch {
      mutate()
      toast("Couldn't update notification. Please try again.", "error")
    }
  }

  const markAllAsRead = async () => {
    mutate(
      (current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((n) => ({ ...n, read: true })),
              unreadCount: 0,
            }
          : current,
      false
    )
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      })
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`)
      const fresh = await res.json()
      mutate(fresh, false)
    } catch {
      mutate()
      toast("Couldn't mark notifications as read. Please try again.", "error")
    }
  }

  const renderIcon = (notif: UserNotification) => {
    if (notif.type === "party_invite") {
      return (
        <span className="p-2 rounded-[6px] bg-penpot-secondary-200/15 text-penpot-secondary-200 inline-block">
          <ShieldCheck className="size-4" />
        </span>
      )
    }
    if (notif.type === "approved") {
      return (
        <span className="p-2 rounded-[6px] bg-emerald-500/15 text-emerald-400 inline-block">
          <Check className="size-4" />
        </span>
      )
    }
    if (notif.type === "denied") {
      return (
        <span className="p-2 rounded-[6px] bg-rose-500/15 text-rose-400 inline-block">
          <XCircle className="size-4" />
        </span>
      )
    }
    if (notif.type === "admin_request") {
      return (
        <span className="p-2 rounded-[6px] bg-penpot-link/15 text-penpot-link inline-block">
          <Inbox className="size-4" />
        </span>
      )
    }
    if (notif.type === "download_update") {
      return (
        <span className="p-2 rounded-[6px] bg-amber-500/15 text-amber-400 inline-block">
          <Download className="size-4" />
        </span>
      )
    }
    if (notif.type === "available") {
      return (
        <span className="p-2 rounded-[6px] bg-emerald-500/15 text-emerald-400 inline-block">
          <Play className="size-4" />
        </span>
      )
    }
    return (
      <span className="p-2 rounded-[6px] bg-penpot-secondary-200/15 text-penpot-secondary-200 inline-block">
        <Bell className="size-4" />
      </span>
    )
  }

  const renderActions = (notif: UserNotification) => {
    if (notif.type === "party_invite" && notif.partyId) {
      return (
        <div className="flex items-center gap-3">
          <Link
            href={`/party/join/${notif.partyId}`}
            onClick={() => {
              markAsRead(notif.id)
              setOpen(false)
            }}
            className="rounded-[6px] bg-penpot-secondary-200 px-3.5 py-1 text-xs font-semibold text-black transition-opacity hover:opacity-90"
          >
            Join Party
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              Decline
            </button>
          )}
        </div>
      )
    }

    if (notif.type === "available" && notif.jellyfinItemId) {
      return (
        <div className="flex items-center justify-between w-full">
          <Link
            href={`/watch?id=${notif.jellyfinItemId}&type=${notif.mediaType ?? "movie"}`}
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 rounded-[6px] bg-emerald-600/90 px-3.5 py-1 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
          >
            <Play className="size-3.5" /> Watch Now
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              <Check className="size-3.5" /> Mark read
            </button>
          )}
        </div>
      )
    }

    if (notif.type === "admin_request") {
      return (
        <div className="flex items-center justify-between w-full">
          <Link
            href="/admin/requests"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1 text-xs font-normal text-white hover:text-penpot-secondary-200 transition-colors"
          >
            Review Request &rarr;
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
            >
              <Check className="size-3.5" /> Mark read
            </button>
          )}
        </div>
      )
    }

    return (
      <div className="flex items-center justify-between w-full">
        <Link
          href="/requests"
          onClick={() => setOpen(false)}
          className="text-xs font-normal text-white hover:text-penpot-secondary-200 transition-colors flex items-center gap-1"
        >
          View My Requests &rarr;
        </Link>
        {!notif.read && (
          <button
            onClick={() => markAsRead(notif.id)}
            className="flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors cursor-pointer"
          >
            <Check className="size-3.5" /> Mark read
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full flex items-center" ref={menuRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center text-penpot-text-medium hover:text-white hover:bg-penpot-opacity-white-10 transition-colors rounded-full cursor-pointer"
        title="Notifications"
        aria-label="View Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex size-4 items-center justify-center rounded-full bg-penpot-secondary-200 text-[10px] font-bold text-black shadow-md animate-pulse motion-reduce:animate-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Mobile backdrop overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 sm:hidden"
            onClick={() => setOpen(false)}
          />

          {/* Notification Menu (Cohesive Penpot MenuUser Card Design) */}
          <div className="fixed left-1/2 -translate-x-1/2 top-20 sm:absolute sm:left-auto sm:right-0 sm:top-[calc(100%+8px)] sm:translate-x-0 w-[calc(100vw-2rem)] max-w-sm sm:w-[360px] z-50 animate-in fade-in slide-in-from-top-1 duration-150">
            {/* Pointer Triangle (matching MenuUser Vector 2 & 3) */}
            <div className="relative">
              <svg
                className="hidden sm:block absolute -top-3 right-3.5 w-4 h-3 z-10 drop-shadow-sm pointer-events-none"
                viewBox="0 0 18 14"
                fill="none"
              >
                <path
                  d="M9 1L17 13H1L9 1Z"
                  className="fill-penpot-neutral-700 stroke-penpot-border"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <line x1="1.5" y1="13.5" x2="16.5" y2="13.5" className="stroke-penpot-neutral-700" strokeWidth="2" />
              </svg>

              {/* Main Container */}
              <div className="w-full bg-penpot-neutral-700 border border-penpot-border rounded-[8px] shadow-2xl backdrop-blur-xl overflow-hidden">
                
                {/* Header (Penpot Typography: 16px font-normal) */}
                <div className="p-5 border-b border-penpot-border/60 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-normal text-penpot-text-high/90">Notifications</span>
                    {unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-[4px] bg-penpot-secondary-200/15 text-penpot-secondary-200 font-normal text-xs">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllAsRead}
                      className="flex items-center gap-1 text-xs font-normal text-penpot-secondary-200 hover:underline cursor-pointer"
                    >
                      <CheckCheck className="size-3.5" />
                      Mark all read
                    </button>
                  )}
                </div>

                {/* Notifications List */}
                <div className="max-h-80 overflow-y-auto divide-y divide-penpot-border/40">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-penpot-text-subtle">
                      <Clock className="size-8 mx-auto mb-2 opacity-40 text-penpot-text-subtle" />
                      <p className="text-base font-normal text-white">No notifications</p>
                      <p className="text-xs font-normal text-white/50 mt-1">Updates about your requests will appear here.</p>
                    </div>
                  ) : (
                    visibleNotifications.map((notif) => {
                      const live = notif.type === "download_update" ? progressByRequestId.get(notif.requestId ?? "") : undefined
                      const message = live
                        ? `"${live.title}" is downloading — ${Math.min(100, Math.max(0, Math.round(live.progress)))}% complete.`
                        : notif.message
                      return (
                        <div
                          key={notif.id}
                          className={`p-4 transition-colors flex items-start gap-3.5 ${
                            notif.read ? "bg-transparent hover:bg-penpot-neutral-800" : "bg-penpot-neutral-800 hover:bg-penpot-surface"
                          }`}
                        >
                          <div className="pt-0.5 shrink-0">{renderIcon(notif)}</div>
                          <div className="flex-1 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-normal text-white tracking-normal">{notif.title}</h4>
                              <span className="text-xs font-normal text-white/40">
                                {new Date(notif.createdAt).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                            <p className="text-xs font-normal text-white/70 leading-relaxed">{message}</p>

                            {notif.type === "download_update" && live && (
                              <div className="mt-2">
                                <div className="h-1.5 w-full bg-penpot-neutral-800 border border-penpot-border overflow-hidden rounded-[2px]">
                                  <div
                                    className="h-full bg-penpot-secondary-200 transition-all duration-500"
                                    style={{
                                      width: `${Math.min(100, Math.max(0, live.progress))}%`,
                                    }}
                                  />
                                </div>
                                <div className="flex items-center justify-between text-xs font-normal text-white/50 mt-1">
                                  <span>{Math.min(100, Math.max(0, Math.round(live.progress)))}%</span>
                                  <span>
                                    {formatSpeed(live.dlspeed)}
                                    {formatSpeed(live.dlspeed) && live.eta != null ? " · " : ""}
                                    {live.eta != null ? `ETA ${formatEta(live.eta)}` : ""}
                                  </span>
                                </div>
                              </div>
                            )}

                            <div className="flex items-center justify-between pt-1">
                              {renderActions(notif)}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Footer Link (Matching MenuUser Item Style: regular 16px / 14px text-white hover:text-penpot-secondary-200) */}
                <div className="p-4 border-t border-penpot-border/60 bg-penpot-neutral-700 text-center">
                  <Link
                    href="/requests"
                    onClick={() => setOpen(false)}
                    className="text-sm font-normal text-white hover:text-penpot-secondary-200 transition-colors inline-block py-0.5"
                  >
                    Go to My Requests
                  </Link>
                </div>

              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}


