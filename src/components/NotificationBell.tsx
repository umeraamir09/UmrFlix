"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Bell, Check, CheckCheck, Clock, XCircle, ShieldCheck } from "lucide-react"

export type UserNotification = {
  id: string
  userId: string
  requestId: string
  title: string
  message: string
  type: "approved" | "denied"
  read: boolean
  createdAt: string
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<UserNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const fetchNotifications = async () => {
    try {
      const res = await fetch("/api/notifications")
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {
      /* silent */
    }
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 15000) // Poll every 15s
    return () => clearInterval(interval)
  }, [])

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
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {
      /* silent */
    }
  }

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      })
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {
      /* silent */
    }
  }

  return (
    <div className="relative h-full flex items-center" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2.5 text-gray-300 hover:text-white hover:bg-surface-hover transition-colors rounded-none"
        title="Notifications"
        aria-label="View Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-extrabold text-white shadow-md animate-pulse">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full w-80 sm:w-96 border border-border bg-[#141519] shadow-2xl backdrop-blur-xl rounded-none z-50 text-xs text-gray-200 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-3.5 border-b border-border/80 bg-surface/50 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="size-4 text-accent" />
              <span className="text-sm font-bold text-white uppercase tracking-wider">Notifications</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold text-[10px]">
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

          <div className="max-h-80 overflow-y-auto divide-y divide-border/40">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-foreground-muted">
                <Clock className="size-8 mx-auto mb-2 opacity-40 text-gray-400" />
                <p className="font-medium text-xs">No notifications yet</p>
                <p className="text-[11px] text-gray-500 mt-1">Updates about your requests will appear here.</p>
              </div>
            ) : (
              notifications.map((notif) => (
                <div
                  key={notif.id}
                  className={`p-3.5 transition-colors flex items-start gap-3 ${
                    notif.read ? "bg-transparent opacity-75" : "bg-accent/5"
                  }`}
                >
                  <div className="pt-0.5 shrink-0">
                    {notif.type === "approved" ? (
                      <span className="p-1 rounded bg-emerald-500/20 text-emerald-400 inline-block">
                        <Check className="size-4" />
                      </span>
                    ) : (
                      <span className="p-1 rounded bg-red-500/20 text-red-400 inline-block">
                        <XCircle className="size-4" />
                      </span>
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-white text-xs tracking-tight">{notif.title}</h4>
                      <span className="text-[10px] text-gray-500">
                        {new Date(notif.createdAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <p className="text-gray-300 text-[11px] leading-relaxed">{notif.message}</p>
                    <div className="flex items-center justify-between pt-1.5">
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
                          className="text-[10px] text-gray-400 hover:text-white underline"
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-2.5 border-t border-border/80 bg-surface/30 text-center">
            <Link
              href="/requests"
              onClick={() => setOpen(false)}
              className="text-xs font-bold text-gray-300 hover:text-white uppercase tracking-wider inline-block py-1"
            >
              GO TO MY REQUESTS PAGE
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
