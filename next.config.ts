import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "themoviedb.org" },
      { protocol: "https", hostname: "artworks.thetvdb.com" },
      { protocol: "https", hostname: "static.tvmaze.com" },
    ],
  },
}

export default nextConfig
