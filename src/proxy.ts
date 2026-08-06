import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { decryptSession, COOKIE_NAME } from "@/lib/auth"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/login-covers",
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

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // Allow static files, Next.js internal assets, PWA manifests, icons, and public routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/login") ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith("/public"))
  ) {
    // If authenticated user tries to access /login, redirect to home /
    if (pathname === "/login") {
      const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
      if (sessionCookie) {
        const session = await decryptSession(sessionCookie)
        if (session) {
          const homeUrl = new URL("/", request.url)
          return NextResponse.redirect(homeUrl)
        }
      }
    }
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  const session = sessionCookie ? await decryptSession(sessionCookie) : null

  // If user is unauthenticated or session decryption failed
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
    const targetPath = pathname + search
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
