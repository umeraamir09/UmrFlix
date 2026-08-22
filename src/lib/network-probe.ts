/**
 * Network capability scan for CinemaPlayer startup (Phase 2).
 *
 * Goal: know the user's real throughput BEFORE choosing the initial streaming
 * quality, so auto mode starts at a sustainable bitrate instead of blindly
 * requesting full source quality and stalling on slow links — and so direct
 * play can be skipped when the source bitrate exceeds what the network can
 * sustain (it has no ABR to fall back on).
 *
 * Signals (strongest first):
 * 1. probe      — one-shot throughput measurement through the same proxy path
 *                 the video uses (Jellyfin /Playback/BitrateTest), deadline-bounded
 * 2. connection — navigator.connection.downlink (browser's own estimate)
 * 3. persisted  — last session's measured estimate (localStorage, 24h TTL)
 *
 * The decision logic is pure and unit-tested; the browser glue degrades to
 * null on every failure path so playback never depends on it.
 */

export type BandwidthSources = {
  probed?: number | null
  connection?: number | null
  persisted?: number | null
}

export type CombinedEstimate = {
  /** Estimated sustained throughput in bits per second. */
  bps: number
  /** Which signals produced the estimate, strongest-first. */
  sources: string[]
}

/** Startup cap uses only this fraction of measured capacity. */
export const STARTUP_SAFETY_FACTOR = 0.8
/** Direct play needs this much headroom over estimated capacity. */
export const DIRECT_PLAY_HEADROOM = 1.15
/** Never transcode below this — unwatchable slideshow territory. */
export const MIN_STREAM_BITRATE = 400_000
/** Absolute ceiling for any stream request. */
export const MAX_STREAM_BITRATE = 120_000_000
/** Persisted estimates older than this are ignored. */
const PERSIST_TTL_MS = 24 * 60 * 60 * 1000
const STORAGE_KEY = "umrflix.net-estimate"
/** Probe request size + hard deadline: bounded worst-case startup delay. */
const PROBE_BYTES = 3_000_000
const PROBE_DEADLINE_MS = 6_000

// ── Pure decision logic ────────────────────────────────────────────────────

function isValidBps(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0
}

/**
 * Combine available signals into one estimate.
 * A fresh probe wins outright (measured THIS session over the video path).
 * Otherwise take the most conservative of connection/persisted —
 * underestimating just starts lower and upgrades quickly via ABR;
 * overestimating causes an immediate stall.
 */
export function combineBandwidthEstimates(s: BandwidthSources): CombinedEstimate | null {
  if (isValidBps(s.probed)) {
    return { bps: s.probed, sources: ["probe"] }
  }
  const candidates: Array<[string, number]> = []
  if (isValidBps(s.connection)) candidates.push(["connection", s.connection])
  if (isValidBps(s.persisted)) candidates.push(["persisted", s.persisted])
  if (candidates.length === 0) return null
  const weakest = candidates.reduce((a, b) => (b[1] < a[1] ? b : a))
  return { bps: weakest[1], sources: candidates.map(([name]) => name) }
}

/**
 * Initial maxStreamingBitrate for the auto-quality stream URL.
 * Falls back to the legacy behavior (source × 1.2) when no estimate exists.
 */
export function initialAutoCapBps(
  estimateBps: number | null | undefined,
  sourceBitrate: number,
): number {
  if (!isValidBps(estimateBps)) {
    return sourceBitrate > 0
      ? Math.min(Math.round(sourceBitrate * 1.2), MAX_STREAM_BITRATE)
      : MAX_STREAM_BITRATE
  }
  let cap = Math.round(estimateBps * STARTUP_SAFETY_FACTOR)
  cap = Math.max(MIN_STREAM_BITRATE, Math.min(cap, MAX_STREAM_BITRATE))
  // Never ask Jellyfin to transcode above the source.
  if (sourceBitrate > 0) cap = Math.min(cap, Math.round(sourceBitrate * 1.2))
  return cap
}

/**
 * True when direct play would stall: the source needs more sustained
 * throughput than we believe the network can deliver. Unknown inputs → false
 * (never block direct play on missing data).
 */
export function shouldPreferTranscodeForBandwidth(
  estimateBps: number | null | undefined,
  sourceBitrate: number | undefined,
): boolean {
  if (!isValidBps(estimateBps) || !isValidBps(sourceBitrate)) return false
  return sourceBitrate > estimateBps * DIRECT_PLAY_HEADROOM
}

// ── Browser glue ───────────────────────────────────────────────────────────

type NetworkInformation = {
  downlink?: number
  effectiveType?: string
  saveData?: boolean
}

function getConnection(): NetworkInformation | null {
  if (typeof navigator === "undefined") return null
  return (navigator as unknown as { connection?: NetworkInformation }).connection ?? null
}

export function isSaveDataEnabled(): boolean {
  return getConnection()?.saveData === true
}

/**
 * Browser-reported capacity in bits/second, or null.
 * effectiveType ceilings per the Network Information spec ("4g" has no useful
 * ceiling → null rather than a made-up number).
 */
export function readConnectionBandwidth(): number | null {
  const conn = getConnection()
  if (!conn) return null
  if (isValidBps(conn.downlink)) return conn.downlink * 1_000_000
  switch (conn.effectiveType) {
    case "slow-2g":
      return 40_000
    case "2g":
      return 60_000
    case "3g":
      return 600_000
    default:
      return null
  }
}

// ── Persistence ────────────────────────────────────────────────────────────

export type PersistedEstimate = { bps: number; at: number }

export function loadPersistedBandwidth(now = Date.now()): PersistedEstimate | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedEstimate>
    if (!isValidBps(parsed.bps) || typeof parsed.at !== "number") return null
    if (now - parsed.at > PERSIST_TTL_MS) return null
    return { bps: parsed.bps, at: parsed.at }
  } catch {
    return null
  }
}

/** Best-effort persistence — storage failures are silently ignored. */
export function savePersistedBandwidth(bps: number, at = Date.now()): void {
  if (typeof window === "undefined" || !isValidBps(bps)) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ bps: Math.round(bps), at }))
  } catch {
    /* storage unavailable */
  }
}

// ── Throughput probe ───────────────────────────────────────────────────────

export type ProbeOptions = {
  bytes?: number
  deadlineMs?: number
  fetchImpl?: typeof fetch
  url?: string
}

/**
 * One-shot throughput probe against Jellyfin's BitrateTest endpoint, routed
 * through the same-origin proxy the video segments use. Reads the response
 * incrementally so even a timed-out probe yields a valid partial sample.
 *
 * Guarded by fetch availability (not `window`) so tests can inject fetchImpl;
 * SSR callers are protected by runNetworkScan's own window guard.
 */
export async function probeThroughput(opts: ProbeOptions = {}): Promise<number | null> {
  if (typeof fetch === "undefined") return null
  const bytes = opts.bytes ?? PROBE_BYTES
  const deadlineMs = opts.deadlineMs ?? PROBE_DEADLINE_MS
  const doFetch = opts.fetchImpl ?? fetch
  const url = opts.url ?? `/api/jellyfin/proxy/Playback/BitrateTest?size=${bytes}`

  const started = performance.now()
  try {
    const res = await doFetch(url, { cache: "no-store" })
    if (!res.ok || !res.body) return null
    const reader = res.body.getReader()
    let received = 0
    for (;;) {
      const remaining = deadlineMs - (performance.now() - started)
      if (remaining <= 0) break
      let chunk: ReadableStreamReadResult<Uint8Array>
      let timerId: ReturnType<typeof setTimeout> | undefined
      try {
        chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timerId = setTimeout(() => reject(new Error("probe deadline")), remaining)
          }),
        ])
      } catch {
        break // deadline hit mid-read — the partial sample is still usable
      } finally {
        if (timerId !== undefined) clearTimeout(timerId)
      }
      if (chunk.done) break
      received += chunk.value.byteLength
      if (received >= bytes) break
    }
    try {
      await reader.cancel()
    } catch {
      /* already closed */
    }
    const elapsedMs = performance.now() - started
    // Too little data to trust as a capacity measurement.
    if (elapsedMs <= 0 || received < 50_000) return null
    return Math.round((received * 8) / (elapsedMs / 1000))
  } catch {
    return null
  }
}

// ── Scan orchestration ─────────────────────────────────────────────────────

export type ScanOptions = {
  /** Pass false to skip the probe (signal-only scan). */
  probe?: ProbeOptions | false
}

/**
 * Run one scan: gather connection + persisted signals, then (unless save-data
 * is on or probing is disabled) take a fresh throughput measurement and
 * refresh the persisted value with it.
 */
export async function runNetworkScan(opts: ScanOptions = {}): Promise<CombinedEstimate | null> {
  if (typeof window === "undefined") return null
  const connection = readConnectionBandwidth()
  const persisted = loadPersistedBandwidth()
  let probed: number | null = null
  if (opts.probe !== false && !isSaveDataEnabled()) {
    probed = await probeThroughput(opts.probe ?? {})
    if (probed != null) savePersistedBandwidth(probed)
  }
  return combineBandwidthEstimates({ probed, connection, persisted: persisted?.bps ?? null })
}

let scanPromise: Promise<CombinedEstimate | null> | null = null

/**
 * Once-per-page-load scan; concurrent callers share a single run. The result
 * must settle before the first stream build so engine selection and the
 * initial quality cap are correct from the start.
 */
export function ensureNetworkScan(): Promise<CombinedEstimate | null> {
  scanPromise ??= runNetworkScan().catch(() => null)
  return scanPromise
}

/** Test hook / forced rescan. */
export function resetNetworkScanCache(): void {
  scanPromise = null
}
