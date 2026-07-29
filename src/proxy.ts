import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/login-covers",
  "/favicon.ico",
  "/logo_header.png",
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow static files, Next.js internal assets, and public routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth/login") ||
    PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith("/public"))
  ) {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get("umrflix_session")?.value

  // If user is not authenticated and trying to access any route other than /login
  if (!sessionCookie && pathname !== "/login") {
    const loginUrl = new URL("/login", request.url)
    return NextResponse.redirect(loginUrl)
  }

  // If user IS authenticated and trying to access /login, redirect to home /
  if (sessionCookie && pathname === "/login") {
    const homeUrl = new URL("/", request.url)
    return NextResponse.redirect(homeUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for static files:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - logo_header.png (logo file)
     */
    "/((?!_next/static|_next/image|favicon.ico|logo_header.png).*)",
  ],
}
