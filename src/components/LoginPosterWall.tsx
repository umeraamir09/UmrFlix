"use client"

import useSWR from "swr"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function LoginPosterWall() {
  const { data } = useSWR<{ posters: string[] }>("/api/login-covers", fetcher, {
    revalidateOnFocus: false,
  })

  const posters = data?.posters && data.posters.length > 0 ? data.posters : []

  if (posters.length === 0) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-[#141519] via-[#0a0b0d] to-black opacity-90 z-0" />
    )
  }

  // Ensure each of the 5 rows gets a full, rich set of posters (at least 15 items per row track)
  const getRowPosters = (rowIndex: number) => {
    const total = posters.length
    const offset = rowIndex * 5
    const rowItems: string[] = []
    for (let i = 0; i < Math.max(16, total); i++) {
      rowItems.push(posters[(i + offset) % total])
    }
    return rowItems
  }

  const rows = [0, 1, 2, 3, 4].map((idx) => getRowPosters(idx))

  return (
    <div className="absolute inset-0 overflow-hidden z-0 pointer-events-none select-none bg-black">
      {/* 3D Tilted Slanted Grid Container (Brighter opacity-75) */}
      <div className="absolute -inset-x-32 -inset-y-40 origin-center transform -rotate-[10deg] scale-125 opacity-75 flex flex-col gap-4">
        {rows.map((rowPosters, rowIdx) => {
          const isLeft = rowIdx % 2 === 0
          const duration = 120 + rowIdx * 20

          return (
            <div
              key={rowIdx}
              className={`flex w-max shrink-0 flex-nowrap ${
                isLeft ? "animate-marquee-left" : "animate-marquee-right"
              }`}
              style={{ animationDuration: `${duration}s` }}
            >
              {/* Track Half 1 */}
              <div className="flex shrink-0 items-center gap-4 pr-4">
                {rowPosters.map((url, i) => (
                  <div
                    key={`h1-${rowIdx}-${i}`}
                    className="relative w-36 sm:w-44 aspect-[2/3] shrink-0 rounded-none overflow-hidden bg-surface border border-border/50 shadow-2xl"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Media Poster Cover"
                      className="w-full h-full object-cover brightness-105 contrast-110"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>

              {/* Track Half 2 (Identical duplicate for 100% mathematical seamless loop) */}
              <div className="flex shrink-0 items-center gap-4 pr-4">
                {rowPosters.map((url, i) => (
                  <div
                    key={`h2-${rowIdx}-${i}`}
                    className="relative w-36 sm:w-44 aspect-[2/3] shrink-0 rounded-none overflow-hidden bg-surface border border-border/50 shadow-2xl"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Media Poster Cover"
                      className="w-full h-full object-cover brightness-105 contrast-110"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Brighter Dark Overlay Gradient (Preserves poster visibility & contrast for login form) */}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-background/30 z-10" />
      <div className="absolute inset-0 bg-radial from-transparent via-background/40 to-background/95 z-10" />
    </div>
  )
}
