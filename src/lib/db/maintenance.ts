import type { Pool } from "pg"

const DAY = 86_400_000

export async function cleanupDatabase(pool: Pool): Promise<void> {
  const now = Date.now()
  await pool.query("DELETE FROM umrflix_cache_store WHERE (data->>'updatedAt')::bigint < $1", [now - 7 * DAY])
  await pool.query("DELETE FROM umrflix_user_events WHERE (data->>'timestamp')::bigint < $1", [now - 90 * DAY])
  await pool.query("DELETE FROM umrflix_sessions WHERE (data->>'expiresAt')::bigint <= $1", [now])
}

/** Replacement for backend cron jobs; runs within the single app process. */
export function startDatabaseMaintenance(pool: Pool): void {
  const cleanup = () => { void cleanupDatabase(pool).catch(() => console.error("[Postgres] Retention cleanup failed")) }
  const timer = setInterval(cleanup, 6 * 60 * 60 * 1000)
  timer.unref()
}
