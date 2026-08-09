import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { COOKIE_NAME } from "@/lib/auth-crypto"
import { getSessionBySid } from "@/lib/session-store"
import { sanitizeRedirectUrl } from "@/lib/url-sanitize"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/login-covers",
  "/api/health",
  "/favicon.ico",
  "/logo_header.png",
  "/manifest.webmanifest",
  "/manifest.json",
  "/icon-192.svg",
  "/icon-512.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]

function isCsrfValid(request: NextRequest): boolean {
  if (process.env.CSRF_INSECURE_CLIENTS_ALLOWED === "1") return true

  const origin = request.headers.get("origin")
  const referer = request.headers.get("referer")
  const rawHost = request.headers.get("x-forwarded-host") || request.headers.get("host")

  if (!rawHost) return false
  const expectedHost = rawHost.split(":")[0].toLowerCase()

  const checkUrl = origin || referer
  if (!checkUrl) return false

  try {
    const sourceHost = new URL(checkUrl).hostname.toLowerCase()
    return sourceHost === expectedHost
  } catch {
    return false
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Allow static files, Next.js internal assets, PWA manifests, icons, and public routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/login") ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith("/public"))
  ) {
    // If authenticated user tries to access /login, redirect to their target path or home /
    if (pathname === "/login") {
      const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
      if (sessionCookie) {
        const session = await getSessionBySid(sessionCookie)
        if (session) {
          const redirectParam = request.nextUrl.searchParams.get("redirect")
          const targetPath = sanitizeRedirectUrl(redirectParam, "/")
          return NextResponse.redirect(new URL(targetPath, request.url))
        }
      }
    }
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  const session = sessionCookie ? await getSessionBySid(sessionCookie) : null

  // If user is unauthenticated or session lookup failed
  if (!session) {
    // For API requests, return 401 Unauthorized and clear the invalid cookie
    if (pathname.startsWith("/api/")) {
      const response = NextResponse.json(
        { error: "Unauthorized", authenticated: false },
        { status: 401 }
      )
      if (sessionCookie) {
        response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 })
      }
      return response
    }

    // For page requests, redirect to /login?redirect=<targetPath> and clear the invalid cookie
    const rawTargetPath = pathname + search
    const targetPath = sanitizeRedirectUrl(rawTargetPath, "/")
    const loginUrl = new URL(
      `/login?redirect=${encodeURIComponent(targetPath)}`,
      request.url
    )
    const response = NextResponse.redirect(loginUrl)
    if (sessionCookie) {
      response.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 })
    }
    return response
  }

  // Enforce CSRF protection for non-safe API mutations
  const method = request.method.toUpperCase()
  if (pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (!isCsrfValid(request)) {
      return NextResponse.json(
        { error: "CSRF check failed: invalid or missing Origin/Referer header", authenticated: true },
        { status: 403 }
      )
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, logo_header.png, manifests, and static images/icons
     */
    "/((?!_next/static|_next/image|favicon\\.ico|logo_header\\.png|manifest\\.webmanifest|manifest\\.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
