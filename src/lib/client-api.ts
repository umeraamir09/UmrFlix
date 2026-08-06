"use client"

import { sanitizeRedirectUrl } from "./url-sanitize"

/**
 * Client-side fetch wrapper that automatically catches 401 Unauthorized responses
 * or { authenticated: false } / { error: "Unauthorized" } payloads and redirects to /login.
 */
export async function clientFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options)

  if (res.status === 401) {
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      const currentPath = sanitizeRedirectUrl(window.location.pathname + window.location.search)
      window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`
    }
  }

  return res
}
