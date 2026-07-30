"use client"

import { useCallback, useMemo, useState } from "react"
import { ArrowLeft, Film, Loader2, Search, Users } from "lucide-react"
import type { PartyMember } from "@/lib/party/protocol"

type EpisodeItem = {
  id: string
  title: string
  seasonNumber: number
  episodeNumber: number
  status: string
  thumbUrl: string
}

export type PartyLobbyProps = {
  partyId: string
  isOwner: boolean
  members: PartyMember[]
  onSelectItem: (itemId: string) => void
}

export function PartyLobby({
  partyId,
  isOwner,
  members,
  onSelectItem,
}: PartyLobbyProps) {
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; title: string; type: string; posterUrl?: string }>
  >([])

  // Episode picker sub-view state
  const [seriesPicking, setSeriesPicking] = useState<{
    seriesId: string
    seriesTitle: string
  } | null>(null)
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)

  const [searchLimit, setSearchLimit] = useState(30)
  const [totalRecordCount, setTotalRecordCount] = useState(0)

  const fetchSearchResults = async (queryStr: string, limit: number) => {
    setSearching(true)
    try {
      const res = await fetch(
        `/api/jellyfin/proxy/Items?searchTerm=${encodeURIComponent(
          queryStr
        )}&includeItemTypes=Movie,Episode,Series&recursive=true&limit=${limit}`
      )
      if (res.ok) {
        const data = await res.json()
        setTotalRecordCount(data.TotalRecordCount || 0)
        const items = (data.Items || []).map((item: any) => ({
          id: item.Id,
          title: item.Name,
          type: item.Type,
          posterUrl: `/api/jellyfin/image/${item.Id}?type=Primary`,
        }))
        setSearchResults(items)
      }
    } catch (err) {
      console.error("[PartyLobby] Search error:", err)
    } finally {
      setSearching(false)
    }
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim()) return
    setSearchLimit(30)
    await fetchSearchResults(searchQuery, 30)
  }

  const handleLoadMore = async () => {
    const newLimit = searchLimit + 30
    setSearchLimit(newLimit)
    await fetchSearchResults(searchQuery, newLimit)
  }

  const loadEpisodesForSeries = async (seriesId: string, seriesTitle: string) => {
    setLoadingEpisodes(true)
    setSeriesPicking({ seriesId, seriesTitle })
    try {
      const res = await fetch(`/api/jellyfin/series/${seriesId}/episodes`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.episodes)) {
          const playable = data.episodes.filter(
            (e: EpisodeItem) => e.status === "in_library"
          )
          setEpisodes(playable)
        }
      }
    } catch (err) {
      console.error("[PartyLobby] Load episodes error:", err)
    } finally {
      setLoadingEpisodes(false)
    }
  }

  const selectItem = async (itemId: string) => {
    try {
      await fetch(`/api/party/${partyId}/item`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      })
      onSelectItem(itemId)
    } catch (err) {
      console.error("[PartyLobby] Select item error:", err)
    }
  }

  const handleSearchResultClick = (result: {
    id: string
    title: string
    type: string
  }) => {
    if (result.type === "Series") {
      loadEpisodesForSeries(result.id, result.title)
    } else {
      // Movie or Episode — play directly
      selectItem(result.id)
    }
  }

  const backToSearch = useCallback(() => {
    setSeriesPicking(null)
    setEpisodes([])
  }, [])

  // Group episodes by season
  const episodesBySeason = useMemo(() => {
    const grouped: Record<number, EpisodeItem[]> = {}
    for (const ep of episodes) {
      const s = ep.seasonNumber
      if (!grouped[s]) grouped[s] = []
      grouped[s].push(ep)
    }
    return Object.entries(grouped).sort(
      ([a], [b]) => Number(a) - Number(b)
    )
  }, [episodes])

  return (
    <div className="flex h-dvh w-screen flex-col items-center justify-center bg-black p-6 text-white">
      <div className="w-full max-w-xl border border-border bg-[#141519] p-8 shadow-2xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded bg-accent/20 text-accent">
              <Film className="size-6" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold uppercase tracking-wider">
                {seriesPicking
                  ? `Pick Episode — ${seriesPicking.seriesTitle}`
                  : "Watch Party Lobby"}
              </h1>
              <p className="text-xs text-gray-400">
                {!isOwner
                  ? "Waiting for host to select content…"
                  : seriesPicking
                    ? "Select an episode to play for the group"
                    : "Select content from your library to start watching"}
              </p>
            </div>
          </div>
          {isOwner && (
            <span className="px-2.5 py-1 rounded bg-accent text-white font-bold text-xs uppercase tracking-wider">
              Host
            </span>
          )}
        </div>

        {/* Member list */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-300">
            <Users className="size-4 text-accent" />
            <span>Party Members ({members.length})</span>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {members.map((m) => (
              <div
                key={m.userId}
                className="flex items-center gap-2 bg-surface border border-border px-3 py-1.5 rounded-none text-xs font-medium"
              >
                <div className="flex size-6 items-center justify-center rounded-full bg-accent/20 text-accent font-bold text-[10px]">
                  {m.username.substring(0, 2).toUpperCase()}
                </div>
                <span>{m.username}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Host Content Selector */}
        {isOwner ? (
          seriesPicking ? (
            /* ── Episode picker sub-view ── */
            <div className="space-y-4 pt-2">
              <button
                onClick={backToSearch}
                className="flex items-center gap-1.5 text-xs font-bold text-accent hover:underline"
              >
                <ArrowLeft className="size-3.5" />
                Back to search
              </button>

              {loadingEpisodes ? (
                <div className="flex items-center justify-center p-6 text-gray-400 gap-2">
                  <Loader2 className="size-5 animate-spin text-accent" />
                  <span className="text-xs">Loading episodes…</span>
                </div>
              ) : episodesBySeason.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">
                  No playable episodes found in this series.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto divide-y divide-border/40 border border-border bg-surface">
                  {episodesBySeason.map(([seasonNum, seasonEps]) => (
                    <div key={seasonNum}>
                      <div className="px-3 py-1.5 bg-surface border-b border-border/30 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Season {seasonNum}
                      </div>
                      {seasonEps.map((ep) => (
                        <div
                          key={ep.id}
                          onClick={() => selectItem(ep.id)}
                          className="flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-surface-hover transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Film className="size-4 text-accent shrink-0" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-white truncate">
                                S{ep.seasonNumber}:E{ep.episodeNumber} — {ep.title}
                              </p>
                            </div>
                          </div>
                          <button className="bg-accent/20 hover:bg-accent text-accent hover:text-white px-3 py-1 text-xs font-bold transition-colors shrink-0 ml-2">
                            Play
                          </button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* ── Search view ── */
            <div className="space-y-4 pt-2">
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-2.5 size-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search library movies, series & episodes…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface border border-border pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="bg-accent hover:bg-accent-hover px-5 py-2 text-xs font-bold uppercase tracking-wider text-white transition-colors flex items-center gap-1.5"
                >
                  {searching && <Loader2 className="size-3.5 animate-spin" />}
                  Search
                </button>
              </form>

              {searchResults.length > 0 && (
                <div className="space-y-2">
                  <div className="max-h-60 overflow-y-auto divide-y divide-border/40 border border-border bg-surface">
                    {searchResults.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => handleSearchResultClick(item)}
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-surface-hover transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Film className="size-4 text-accent" />
                          <div>
                            <p className="text-xs font-bold text-white">{item.title}</p>
                            <p className="text-[10px] text-gray-400 uppercase">
                              {item.type === "Series" ? "Series" : item.type}
                            </p>
                          </div>
                        </div>
                        <button className="bg-accent/20 hover:bg-accent text-accent hover:text-white px-3 py-1 text-xs font-bold transition-colors">
                          {item.type === "Series" ? "Browse Episodes" : "Play For Group"}
                        </button>
                      </div>
                    ))}
                  </div>
                  {searchResults.length < totalRecordCount && (
                    <button
                      onClick={handleLoadMore}
                      disabled={searching}
                      className="w-full py-2 bg-surface hover:bg-surface-hover border border-border text-xs font-bold uppercase tracking-wider text-accent transition-colors flex items-center justify-center gap-2"
                    >
                      {searching && <Loader2 className="size-3.5 animate-spin text-accent" />}
                      Load More Results ({searchResults.length} of {totalRecordCount})
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center p-8 border border-border/80 bg-surface/30 text-center gap-3">
            <Loader2 className="size-8 animate-spin text-accent" />
            <p className="text-sm font-semibold text-gray-300">
              {seriesPicking
                ? `Host is browsing "${seriesPicking.seriesTitle}" episodes…`
                : "Host is selecting title to watch…"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
