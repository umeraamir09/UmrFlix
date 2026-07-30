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

export default crons
