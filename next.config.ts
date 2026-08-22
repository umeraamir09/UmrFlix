import type { NextConfig } from "next"

const nextConfig: NextConfig = {
  allowedDevOrigins: ['100.80.26.90'],
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 86400,
    // No `search` constraint: local proxy images (e.g. /api/jellyfin/image/...)
    // carry query strings like ?type=Primary. Those /api/ paths render via
    // `unoptimized` in MovieCard, but a plain local image with a query string
    // must also match here.
    localPatterns: [
      {
        pathname: "/**",
      },
    ],
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "themoviedb.org" },
      { protocol: "https", hostname: "artworks.thetvdb.com" },
      { protocol: "https", hostname: "static.tvmaze.com" },
    ],
  },
}

export default nextConfig
