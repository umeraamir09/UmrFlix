import { Pool } from "pg"
import { startDatabaseMaintenance } from "./maintenance"
import { env } from "../env"

const globalDb = globalThis as typeof globalThis & { umrflixPostgresPool?: Pool }

/** One server-side pool per Node process, including across Next dev reloads. */
export function getPool(): Pool {
  if (typeof window !== "undefined") throw new Error("Postgres is server-only")
  if (globalDb.umrflixPostgresPool) return globalDb.umrflixPostgresPool
  const connectionString = env("DATABASE_URL")
  if (!connectionString) throw new Error("DATABASE_URL is required for Postgres persistence")
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 1500,
    statement_timeout: 5000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  })
  pool.on("error", () => console.error("[Postgres] Idle database connection failed"))
  startDatabaseMaintenance(pool)
  globalDb.umrflixPostgresPool = pool
  return pool
}
