import {
  getAllRequests,
  notifyDownloadStarted,
  notifyItemAvailable,
  enrichAvailableNotification,
  updateDownloadProgressNotif,
  type RequestItem,
} from "./requests-store"
import { getTorrents, type QBittorrentItem } from "./qbittorrent"
import * as radarr from "./radarr"
import * as sonarr from "./sonarr"
import {
  ensureRadarrMovies,
  ensureSonarrSeries,
  ensureJellyfinIndex,
  getJellyfinItemId,
  getTmdbToTvdbMapping,
} from "./cache"
import { authenticate, getAllItems } from "./jellyfin"
import { eventBus } from "./event-bus"

const POLL_INTERVAL_MS = 10_000
const PERSIST_STEP_PCT = 5
const PERSIST_MIN_INTERVAL_MS = 30_000
const COMPLETE_THRESHOLD_PCT = 99.5

export type TrackedDownload = {
  requestId: string
  userId: string
  title: string
  mediaType: "movie" | "tv"
  tmdbId?: number
  progress: number
  dlspeed?: number
  eta?: number
  state?: string
  hash?: string
  updatedAt: number
}

type TrackState = {
  requestId: string
  hash: string | null
  lastPersistedPct: number
  lastPersistAt: number
}

class DownloadTracker {
  private interval: NodeJS.Timeout | null = null
  private running = false
  private lastFetchOk = false
  private tracked = new Map<string, TrackState>()
  private snapshot = new Map<string, TrackedDownload>()
  private completed = new Set<string>()

  start(): void {
    if (this.interval) return
    void this.tick().catch(() => {
      /* keep polling */
    })
    this.interval = setInterval(() => {
      void this.tick().catch(() => {
        /* keep polling */
      })
    }, POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  getSnapshotForUser(userId: string): TrackedDownload[] {
    const items: TrackedDownload[] = []
    for (const entry of this.snapshot.values()) {
      if (entry.userId === userId) items.push(entry)
    }
    return items.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      let requests: RequestItem[]
      try {
        requests = await getAllRequests()
      } catch {
        // Transient store failure — keep current tracking state and retry next
        // tick instead of wiping progress data.
        return
      }
      const approved = requests.filter((r) => r.status === "approved")
      if (approved.length === 0) {
        this.tracked.clear()
        this.snapshot.clear()
        return
      }

      let fetchOk = true
      const [torrents, radarrQueue, sonarrQueue] = await Promise.all([
        getTorrents().catch(() => {
          fetchOk = false
          return []
        }),
        radarr.getQueue().catch(() => {
          fetchOk = false
          return []
        }),
        sonarr.getQueue().catch(() => {
          fetchOk = false
          return []
        }),
      ])
      // lastFetchOk tracks whether the fetch itself succeeded, not whether any
      // downloads are present — availability checks must keep running even
      // after every queue/torrent has cleared.
      this.lastFetchOk = fetchOk

      const [movies, series] = await Promise.all([
        ensureRadarrMovies(() => radarr.getMovies()).catch(() => new Map<number, radarr.RadarrMovie>()),
        ensureSonarrSeries(() => sonarr.getSeries()).catch(() => new Map<number, sonarr.SonarrSeries>()),
      ])

      const movieIdToTmdb = new Map<number, number>()
      for (const m of movies.values()) movieIdToTmdb.set(m.id, m.tmdbId)
      const seriesIdToTvdb = new Map<number, number>()
      for (const s of series.values()) seriesIdToTvdb.set(s.id, s.tvdbId)

      const radarrQueueByMovie = new Map<number, radarr.RadarrQueueItem[]>()
      for (const q of radarrQueue) {
        const list = radarrQueueByMovie.get(q.movieId) ?? []
        list.push(q)
        radarrQueueByMovie.set(q.movieId, list)
      }
      const sonarrQueueBySeries = new Map<number, sonarr.SonarrQueueItem[]>()
      for (const q of sonarrQueue) {
        const list = sonarrQueueBySeries.get(q.seriesId) ?? []
        list.push(q)
        sonarrQueueBySeries.set(q.seriesId, list)
      }

      const torrentByHash = new Map<string, QBittorrentItem>()
      for (const t of torrents) {
        if (t.hash) torrentByHash.set(t.hash.toLowerCase(), t)
      }

      const nextTracked = new Map<string, TrackState>()
      const nextSnapshot = new Map<string, TrackedDownload>()
      let needsAvailabilityCheck = false
      const availabilityCandidates: RequestItem[] = []

      for (const req of approved) {
        if (this.completed.has(req.id)) {
          await this.maybeEnrich(req).catch(() => null)
          continue
        }

        const download = this.resolveDownload(req, {
          movieIdToTmdb,
          seriesIdToTvdb,
          radarrQueueByMovie,
          sonarrQueueBySeries,
          torrentByHash,
          torrents,
        })

        if (!download) {
          if (this.tracked.has(req.id)) {
            needsAvailabilityCheck = true
            availabilityCandidates.push(req)
          }
          continue
        }

        const state = this.tracked.get(req.id)
        const trackState: TrackState = {
          requestId: req.id,
          hash: download.hash ?? null,
          lastPersistedPct: state?.lastPersistedPct ?? -1,
          lastPersistAt: state?.lastPersistAt ?? 0,
        }

        if (!state) {
          await notifyDownloadStarted(req, download.progress).catch(() => null)
          trackState.lastPersistedPct = download.progress
          trackState.lastPersistAt = Date.now()
        } else if (
          download.progress - trackState.lastPersistedPct >= PERSIST_STEP_PCT ||
          Date.now() - trackState.lastPersistAt >= PERSIST_MIN_INTERVAL_MS
        ) {
          await updateDownloadProgressNotif(req, download.progress).catch(() => null)
          trackState.lastPersistedPct = download.progress
          trackState.lastPersistAt = Date.now()
        }

        nextTracked.set(req.id, trackState)
        nextSnapshot.set(req.id, {
          requestId: req.id,
          userId: req.requestedBy.userId,
          title: req.title,
          mediaType: req.mediaType,
          tmdbId: req.tmdbId,
          progress: download.progress,
          dlspeed: download.dlspeed,
          eta: download.eta,
          state: download.state,
          hash: download.hash,
          updatedAt: Date.now(),
        })

        if (download.progress >= COMPLETE_THRESHOLD_PCT) {
          // Don't notify "ready to watch" until the item is genuinely
          // available (imported + scanned); otherwise the notification fires
          // minutes early and can never be enriched with a Jellyfin item id.
          const available = await this.isAvailable(req)
          if (available) {
            await this.completeRequest(req)
            this.completed.add(req.id)
            nextTracked.delete(req.id)
            nextSnapshot.delete(req.id)
          }
          continue
        }

        eventBus.emitEvent({
          type: "download:progress",
          payload: {
            requestId: req.id,
            title: req.title,
            mediaType: req.mediaType,
            tmdbId: req.tmdbId,
            progress: download.progress,
            dlspeed: download.dlspeed,
            eta: download.eta,
            state: download.state,
            audience: [req.requestedBy.userId],
          },
        })
      }

      if (needsAvailabilityCheck && availabilityCandidates.length > 0) {
        await this.checkAvailability(availabilityCandidates)
      }

      const approvedIds = new Set(approved.map((r) => r.id))
      for (const id of this.completed) {
        if (!approvedIds.has(id)) this.completed.delete(id)
      }

      this.tracked = nextTracked
      this.snapshot = nextSnapshot
    } finally {
      this.running = false
    }
  }

  private async completeRequest(req: RequestItem): Promise<void> {
    const jellyfinItemId = await this.resolveJellyfinItemId(req)
    const notified = await notifyItemAvailable(req, jellyfinItemId).catch(() => false)
    if (!notified && jellyfinItemId) {
      // Notification already exists (e.g. created by a webhook before the
      // Jellyfin index caught up) — backfill the item id so "Watch Now" works.
      await enrichAvailableNotification(req, jellyfinItemId).catch(() => null)
    }
    if (notified) {
      eventBus.emitEvent({
        type: "download:available",
        payload: {
          requestId: req.id,
          title: req.title,
          mediaType: req.mediaType,
          jellyfinItemId,
          audience: [req.requestedBy.userId],
        },
      })
    }
  }

  private async maybeEnrich(req: RequestItem): Promise<void> {
    const jellyfinItemId = await this.resolveJellyfinItemId(req)
    if (jellyfinItemId) {
      await enrichAvailableNotification(req, jellyfinItemId).catch(() => null)
    }
  }

  private async checkAvailability(candidates: RequestItem[]): Promise<void> {
    if (!this.lastFetchOk) return

    for (const req of candidates) {
      if (this.tracked.has(req.id)) continue
      const available = await this.isAvailable(req)
      if (available) {
        await this.completeRequest(req)
        this.completed.add(req.id)
        this.tracked.delete(req.id)
        this.snapshot.delete(req.id)
      }
    }
  }

  private async isAvailable(req: RequestItem): Promise<boolean> {
    try {
      if (req.mediaType === "movie") {
        const movies = await ensureRadarrMovies(() => radarr.getMovies()).catch(
          () => new Map<number, radarr.RadarrMovie>()
        )
        const movie = movies.get(req.tmdbId)
        if (movie?.hasFile) return true
      }
      const keys = this.resolveProviderKeys(req)
      for (const key of keys) {
        if (getJellyfinItemId(key)) return true
      }
      const idx = await ensureJellyfinIndex(async () => {
        try {
          const { token, userId } = await authenticate()
          return getAllItems(token, userId)
        } catch {
          return []
        }
      }).catch(() => new Map<string, string>())
      return keys.some((key) => idx.has(key))
    } catch {
      return false
    }
  }

  private async resolveJellyfinItemId(req: RequestItem): Promise<string | undefined> {
    try {
      const keys = this.resolveProviderKeys(req)
      for (const key of keys) {
        const cached = getJellyfinItemId(key)
        if (cached) return cached
      }
      const idx = await ensureJellyfinIndex(async () => {
        try {
          const { token, userId } = await authenticate()
          return getAllItems(token, userId)
        } catch {
          return []
        }
      }).catch(() => new Map<string, string>())
      for (const key of keys) {
        const id = idx.get(key)
        if (id) return id
      }
      return undefined
    } catch {
      return undefined
    }
  }

  private resolveProviderKeys(req: RequestItem): string[] {
    if (req.mediaType === "movie") return [`tmdb-${req.tmdbId}`]
    const tvdb = req.tvdbId ?? getTmdbToTvdbMapping(req.tmdbId)
    const keys: string[] = []
    if (tvdb) keys.push(`tvdb-${tvdb}`)
    keys.push(`tmdb-${req.tmdbId}`)
    return keys
  }

  private resolveDownload(
    req: RequestItem,
    ctx: {
      movieIdToTmdb: Map<number, number>
      seriesIdToTvdb: Map<number, number>
      radarrQueueByMovie: Map<number, radarr.RadarrQueueItem[]>
      sonarrQueueBySeries: Map<number, sonarr.SonarrQueueItem[]>
      torrentByHash: Map<string, QBittorrentItem>
      torrents: QBittorrentItem[]
    }
  ): { progress: number; dlspeed?: number; eta?: number; state?: string; hash?: string } | null {
    const {
      movieIdToTmdb,
      seriesIdToTvdb,
      radarrQueueByMovie,
      sonarrQueueBySeries,
      torrentByHash,
      torrents,
    } = ctx

    let queueItems: { progressPercent: number; downloadId?: string; status?: string }[] = []

    if (req.mediaType === "movie") {
      for (const [movieId, items] of radarrQueueByMovie) {
        if (movieIdToTmdb.get(movieId) === req.tmdbId) {
          queueItems = items
          break
        }
      }
    } else {
      const targetTvdb = req.tvdbId ?? getTmdbToTvdbMapping(req.tmdbId)
      for (const [seriesId, items] of sonarrQueueBySeries) {
        if (seriesIdToTvdb.get(seriesId) === targetTvdb) {
          queueItems = items
          break
        }
      }
    }

    if (queueItems.length > 0) {
      const getItemPct = (item: { progressPercent?: number; sizeleft?: number; totalSize?: number }) => {
        if (item.totalSize && item.totalSize > 0 && item.sizeleft != null) {
          return Math.max(0, Math.min(100, ((item.totalSize - item.sizeleft) / item.totalSize) * 100))
        }
        return item.progressPercent ?? 0
      }
      const best = queueItems.reduce((a, b) => (getItemPct(b) > getItemPct(a) ? b : a))
      const downloadId = best.downloadId?.toLowerCase()
      const torrent = downloadId ? torrentByHash.get(downloadId) : undefined
      const bestPct = getItemPct(best)
      const progress = torrent ? torrent.progress * 100 : bestPct
      return {
        progress,
        dlspeed: torrent?.dlspeed,
        eta: torrent?.eta,
        state: torrent?.state ?? best.status,
        hash: torrent?.hash ?? best.downloadId,
      }
    }

    const normTitle = normalizeTitle(req.title)
    // Short titles ("It", "Up") are too ambiguous for substring matching — a
    // torrent named "It Chapter Two" would otherwise match a request for "It".
    if (normTitle.length < 4) return null
    const match = torrents.find((t) => {
      const name = normalizeTitle(t.name)
      if (normTitle.length >= 6) return name.includes(normTitle)
      return name.split(" ").includes(normTitle)
    })
    if (match) {
      return {
        progress: match.progress * 100,
        dlspeed: match.dlspeed,
        eta: match.eta,
        state: match.state,
        hash: match.hash,
      }
    }

    return null
  }
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

const globalForTracker = globalThis as unknown as {
  __umrflixDownloadTracker?: DownloadTracker
}

export function getDownloadTracker(): DownloadTracker {
  let tracker = globalForTracker.__umrflixDownloadTracker
  if (!tracker) {
    tracker = new DownloadTracker()
    tracker.start()
    globalForTracker.__umrflixDownloadTracker = tracker
  }
  return tracker
}
