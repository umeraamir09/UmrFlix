import type { Metadata, Viewport } from "next"
import "./globals.css"
import { LayoutShell } from "@/components/LayoutShell"
import { ToastProvider } from "@/components/Toast"
import { SWRProvider } from "@/components/SWRProvider"
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "UmrFlix — Your Personal Media Client",
  description: "Browse TMDB, stream from Jellyfin, and request movies & TV shows via Radarr and Sonarr",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "UmrFlix",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#000000",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full antialiased font-sans", "font-sans", geist.variable)}
    >
      <head>
        <link rel="preconnect" href="https://cdn.fontshare.com" />
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@1,2&display=swap"
        />
      </head>
      <body className="flex min-h-[100dvh] flex-col bg-penpot-bg text-penpot-text-high font-sans">
        <SWRProvider>
          <ToastProvider>
            <LayoutShell>{children}</LayoutShell>
          </ToastProvider>
        </SWRProvider>
      </body>
    </html>
  )
}
