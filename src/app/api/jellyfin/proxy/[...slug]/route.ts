import { NextResponse } from "next/server"
import { env } from "@/lib/env"
import { authenticate } from "@/lib/jellyfin"
import { isValidPathSlug } from "@/lib/validation"

export const dynamic = "force-dynamic"

const BASE = () => env("JELLYFIN_URL")

const PROXY_TIMEOUT_MS = 120_000

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g

function escapeRegex(s: string): string {
  return s.replace(ESCAPE_RE, "\\$&")
}

/**
 * GET /api/jellyfin/proxy/[...slug]
 *
 * Same-origin streaming proxy for all Jellyfin media content.
 * Forwards requests to the Jellyfin server using X-Emby-Token header
 * instead of query-param api_key so the token never reaches the browser.
 *
 * HLS manifests (.m3u8) are rewritten so segment URLs also go through
 * the proxy, keeping the token entirely server-side.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string[] }> },
) {
  try {
    const { slug } = await params
    if (!isValidPathSlug(slug)) {
      return NextResponse.json({ error: "Invalid proxy path" }, { status: 400 })
    }
    const path = slug.join("/")

    const baseUrl = BASE()

    const requestUrl = new URL(request.url)
    const upstreamUrl = new URL(`${baseUrl}/${path}`)
    for (const [k, v] of requestUrl.searchParams) {
      upstreamUrl.searchParams.set(k, v)
    }
    upstreamUrl.searchParams.delete("api_key")

    const { token } = await authenticate()

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

    const upstream = await fetch(upstreamUrl.toString(), {
      headers: {
        "X-Emby-Token": token,
        ...(request.headers.get("range")
          ? { Range: request.headers.get("range")! }
          : {}),
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId))

    const contentType = upstream.headers.get("content-type") ?? ""

    const responseHeaders: Record<string, string> = {
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    }

    const contentLength = upstream.headers.get("content-length")
    if (contentLength) responseHeaders["Content-Length"] = contentLength

    const acceptRanges = upstream.headers.get("accept-ranges")
    if (acceptRanges) responseHeaders["Accept-Ranges"] = acceptRanges

    if (upstream.status === 206 && upstream.headers.get("content-range")) {
      responseHeaders["Content-Range"] = upstream.headers.get("content-range")!
    }

    if (contentType.includes("mpegurl") || contentType.includes("vnd.apple.mpegurl")) {
      const text = await upstream.text()
      const escapedBase = escapeRegex(baseUrl)
      const reBase = new RegExp(`https?:\\/\\/${escapedBase.replace(/https?:\/\//, "")}|${escapedBase}`, "g")
      const rewritten = text
        .replace(reBase, "")
        .replace(/api_key=[^&\s]+/g, "")
        .replace(/\?&/g, "?")
        .replace(/&&/g, "&")
        .replace(/\?$/g, "")
      return new NextResponse(rewritten, {
        status: upstream.status,
        headers: responseHeaders,
      })
    }

    if (!upstream.body) {
      return NextResponse.json({ error: "No response body from upstream" }, { status: 502 })
    }

    return new NextResponse(upstream.body as unknown as ReadableStream, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      return NextResponse.json({ error: "Upstream request timed out" }, { status: 504 })
    }
    const message = e instanceof Error ? e.message : "Failed to proxy request"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
