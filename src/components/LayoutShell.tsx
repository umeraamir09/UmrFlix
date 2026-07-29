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

  if (pathname?.startsWith("/watch") || pathname?.startsWith("/login")) {
    return <main className="flex-1 bg-black">{children}</main>
  }

  return (
    <>
      <Navbar />
      <main className="flex-1 pt-16">{children}</main>
      <Footer />
    </>
  )
}
