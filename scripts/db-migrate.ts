import { loadEnvConfig } from "@next/env"
import { readFile } from "node:fs/promises"
import { getPool } from "../src/lib/db/pool"

loadEnvConfig(process.cwd())

async function main() {
  const pool = getPool()
  try {
    const sql = await readFile(new URL("../src/lib/db/schema.sql", import.meta.url), "utf8")
    await pool.query(sql)
    console.log("Postgres schema is ready.")
  } finally { await pool.end() }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown error"
  console.error(`Schema initialization failed: ${message}`)
  process.exitCode = 1
})
