import { NextResponse } from "next/server"
import { getSession, clearSessionCookie } from "@/lib/auth"

export async function POST() {
  try {
    const session = await getSession()
    if (session?.serverUrl && session?.accessToken) {
      // Best-effort Jellyfin session logout with 5s timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      fetch(`${session.serverUrl}/Sessions/Logout`, {
        method: "POST",
        headers: {
          "X-Emby-Token": session.accessToken,
        },
        signal: controller.signal,
      }).catch(() => {
        /* best-effort ignore */
      }).finally(() => {
        clearTimeout(timeoutId)
      })
    }
  } catch {
    /* continue logout regardless */
  }

  await clearSessionCookie()
  return NextResponse.json({ success: true })
}
