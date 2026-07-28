import type { Metadata } from "next"
import "./globals.css"
import { Navbar } from "@/components/Navbar"
import { Footer } from "@/components/Footer"
import { ToastProvider } from "@/components/Toast"

export const metadata: Metadata = {
  title: "UmrFlix — Your Personal Media Client",
  description: "Browse TMDB, stream from Jellyfin, and request movies & TV shows via Radarr and Sonarr",
  icons: {
    icon: "/favicon.ico",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased font-sans"
    >
      <body className="flex min-h-screen flex-col bg-background text-foreground font-sans">
        <ToastProvider>
          <Navbar />
          <main className="flex-1 pt-16">{children}</main>
          <Footer />
        </ToastProvider>
      </body>
    </html>
  )
}
