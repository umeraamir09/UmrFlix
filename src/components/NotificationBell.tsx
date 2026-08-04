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
        <span className="p-1 rounded bg-accent/20 text-accent inline-block">
          <ShieldCheck className="size-4" />
        </span>
      )
    }
    if (notif.type === "approved") {
      return (
        <span className="p-1 rounded bg-emerald-500/20 text-emerald-400 inline-block">
          <Check className="size-4" />
        </span>
      )
    }
    if (notif.type === "denied") {
      return (
        <span className="p-1 rounded bg-red-500/20 text-red-400 inline-block">
          <XCircle className="size-4" />
        </span>
      )
    }
    if (notif.type === "admin_request") {
      return (
        <span className="p-1 rounded bg-blue-500/20 text-blue-400 inline-block">
          <Inbox className="size-4" />
        </span>
      )
    }
    if (notif.type === "download_update") {
      return (
        <span className="p-1 rounded bg-amber-500/20 text-amber-400 inline-block">
          <Download className="size-4" />
        </span>
      )
    }
    if (notif.type === "available") {
      return (
        <span className="p-1 rounded bg-emerald-500/20 text-emerald-400 inline-block">
          <Play className="size-4" />
        </span>
      )
    }
    return (
      <span className="p-1 rounded bg-accent/20 text-accent inline-block">
        <Bell className="size-4" />
      </span>
    )
  }

  const renderActions = (notif: UserNotification) => {
    if (notif.type === "party_invite" && notif.partyId) {
      return (
        <div className="flex items-center gap-2">
          <Link
            href={`/party/join/${notif.partyId}`}
            onClick={() => {
              markAsRead(notif.id)
              setOpen(false)
            }}
            className="rounded bg-accent px-3 py-1 text-[11px] font-bold text-white transition-colors hover:bg-accent-hover"
          >
            Join Party
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="text-[10px] text-gray-400 hover:text-white underline"
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
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white transition-colors hover:bg-emerald-500"
          >
            <Play className="size-3" /> Watch Now
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white underline"
            >
              <Check className="size-3" /> Mark as read
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
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
          >
            Review Request &rarr;
          </Link>
          {!notif.read && (
            <button
              onClick={() => markAsRead(notif.id)}
              className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white underline"
            >
              <Check className="size-3" /> Mark as read
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
          className="text-[11px] font-semibold text-accent hover:underline flex items-center gap-1"
        >
          View My Requests &rarr;
        </Link>
        {!notif.read && (
          <button
            onClick={() => markAsRead(notif.id)}
            className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white underline"
          >
            <Check className="size-3" /> Mark as read
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="relative h-full flex items-center" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 text-grey-100 hover:text-white transition-colors rounded-[4px]"
        title="Notifications"
        aria-label="View Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-bold text-white shadow-md animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full w-80 sm:w-96 border border-grey-600 bg-grey-900 shadow-2xl backdrop-blur-xl rounded-[4px] z-50 text-xs text-grey-10 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-3.5 border-b border-grey-750 bg-grey-850 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-accent" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-[4px] bg-accent/20 text-accent font-bold text-[10px]">
                  {unreadCount} NEW
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
              >
                <CheckCheck className="size-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-grey-750">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-grey-100">
                <Clock className="size-8 mx-auto mb-2 opacity-40 text-grey-200" />
                <p className="font-medium text-xs text-white">No notifications</p>
                <p className="text-[11px] text-grey-200 mt-1">Updates about your requests will appear here.</p>
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
                    className={`p-3.5 transition-colors flex items-start gap-3 ${notif.read ? "bg-transparent hover:bg-grey-850" : "bg-grey-850"}`}
                  >
                    <div className="pt-0.5 shrink-0">{renderIcon(notif)}</div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-white text-xs tracking-tight">{notif.title}</h4>
                        <span className="text-[10px] text-grey-200">
                          {new Date(notif.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                      </div>
                      <p className="text-grey-100 text-[11px] leading-relaxed">{message}</p>

                      {notif.type === "download_update" && live && (
                        <div className="mt-1.5">
                          <div className="h-1.5 w-full bg-grey-750 border border-grey-600 overflow-hidden rounded-[2px]">
                            <div
                              className="h-full bg-accent transition-all duration-500"
                              style={{
                                width: `${Math.min(100, Math.max(0, live.progress))}%`,
                              }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] text-grey-200 mt-1">
                            <span>{Math.min(100, Math.max(0, Math.round(live.progress)))}%</span>
                            <span>
                              {formatSpeed(live.dlspeed)}
                              {formatSpeed(live.dlspeed) && live.eta != null ? " · " : ""}
                              {live.eta != null ? `ETA ${formatEta(live.eta)}` : ""}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-1.5">
                        {renderActions(notif)}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <div className="p-2.5 border-t border-grey-750 bg-grey-850 text-center">
            <Link
              href="/requests"
              onClick={() => setOpen(false)}
              className="text-xs font-semibold text-grey-100 hover:text-white uppercase tracking-wider inline-block py-1"
            >
              Go to My Requests Page
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
