"use client"

import { usePathname } from "next/navigation"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"

/**
 * App chrome wrapper — the dedicated /watch route renders bare
 * (Netflix-style fullscreen player, no navbar / footer / top padding).
 */
export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname?.startsWith("/login")) {
    return <main className="flex-1 min-w-0 max-w-full overflow-x-hidden bg-penpot-bg">{children}</main>
  }

  if (pathname?.startsWith("/watch")) {
    return <main className="flex-1 min-w-0 max-w-full overflow-x-hidden bg-black">{children}</main>
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 min-w-0 max-w-full overflow-x-hidden">{children}</main>
      <Footer />
    </>
  )
}

