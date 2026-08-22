import { cronJobs } from "convex/server"
import { api } from "./_generated/api"

const crons = cronJobs()

// Run daily cache cleanup for entries older than 7 days (604,800,000 ms)
crons.daily(
  "cleanup stale cache",
  { hourUTC: 3, minuteUTC: 0 },
  api.cache.clearStaleCache,
  { olderThanMs: 7 * 24 * 60 * 60 * 1000 }
)

// Discovery engine: prune signal events older than 90 days every 6 hours so
// the event log stays bounded (profile builds read the last 90 days).
crons.interval(
  "prune discovery events",
  { hours: 6 },
  api.discovery.pruneOldEvents,
  { olderThanMs: 90 * 24 * 60 * 60 * 1000 }
)

// Discovery engine (R2-1): nightly item-feature cache hygiene. The cache is
// re-warmed by POST /api/discovery/precompute (external scheduler); rows not
// refreshed in 14 days are stale catalog and get dropped.
crons.daily(
  "prune stale item features",
  { hourUTC: 4, minuteUTC: 30 },
  api.discovery.pruneItemFeatures,
  { olderThanMs: 14 * 24 * 60 * 60 * 1000 }
)

export default crons
