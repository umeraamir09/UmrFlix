import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { env } from "../env"
import { getPool } from "./pool"

/** Typed operation names keep store contracts independent of the SQL driver. */
export type StoreOperation<Args extends Record<string, unknown>, Result> = string & {
  readonly args: Args
  readonly result: Result
}

// The JSONB boundary is deliberately flexible: feature stores own their document
// types. SQL identifiers below are fixed, and all document values are parameters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Document = Record<string, any>
const tables = {
  myList: "umrflix_my_list", requests: "umrflix_requests", notifications: "umrflix_notifications",
  cacheStore: "umrflix_cache_store", tmdbToTvdb: "umrflix_tmdb_to_tvdb", partyRooms: "umrflix_party_rooms",
  userProfiles: "umrflix_user_profiles", userEvents: "umrflix_user_events",
  userFeatureProfiles: "umrflix_user_feature_profiles", rowImpressionStats: "umrflix_row_impression_stats",
  userRowFatigue: "umrflix_user_row_fatigue", itemFeatures: "umrflix_item_features", userServeLog: "umrflix_user_serve_log",
  sessions: "umrflix_sessions",
} as const
type Table = keyof typeof tables
const keys: Record<Table, string[]> = {
  myList: ["userId", "itemId"], requests: ["requestId"], notifications: ["notifId"],
  cacheStore: ["key"], tmdbToTvdb: ["tmdbId"], partyRooms: ["partyId"], userProfiles: ["userId"],
  userEvents: [], userFeatureProfiles: ["userId", "profileId"], rowImpressionStats: ["rowCategoryKey"],
  userRowFatigue: ["userId", "profileId", "rowCategoryKey"], itemFeatures: ["itemKey"],
  userServeLog: ["userId", "profileId"], sessions: ["sid"],
}

const DAY = 86_400_000
const nowIso = () => new Date().toISOString()
const identity = (table: Table, data: Document) => keys[table].length
  ? JSON.stringify(keys[table].map(key => {
      if (data[key] === undefined || data[key] === null) throw new Error(`Missing ${table} key: ${key}`)
      return String(data[key])
    }))
  : randomUUID()

class Documents {
  constructor(private client: PoolClient) {}

  async list(table: Table, filter: Document = {}): Promise<Document[]> {
    const result = await this.client.query(`SELECT id, data FROM ${tables[table]} WHERE data @> $1::jsonb`, [JSON.stringify(filter)])
    return result.rows.map(row => ({ ...row.data, _id: row.id }))
  }

  async recentEvents(filter: Document, sinceTimestamp: number, limit: number): Promise<Document[]> {
    const result = await this.client.query(`SELECT id, data FROM umrflix_user_events
      WHERE data @> $1::jsonb AND (data->>'timestamp')::bigint >= $2
      ORDER BY (data->>'timestamp')::bigint DESC LIMIT $3`,
      [JSON.stringify(filter), sinceTimestamp, Math.max(0, Math.floor(limit))])
    return result.rows.map(row => ({ ...row.data, _id: row.id }))
  }

  async first(table: Table, filter: Document): Promise<Document | null> {
    const result = await this.client.query(`SELECT id, data FROM ${tables[table]} WHERE data @> $1::jsonb LIMIT 1`, [JSON.stringify(filter)])
    const row = result.rows[0]
    return row ? { ...row.data, _id: row.id } : null
  }

  async save(table: Table, data: Document): Promise<string> {
    const id = identity(table, data)
    await this.client.query(`INSERT INTO ${tables[table]} (id, data) VALUES ($1, $2::jsonb)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`, [id, JSON.stringify(data)])
    return id
  }

  async patch(table: Table, filter: Document, patch: Document): Promise<boolean> {
    const result = await this.client.query(`UPDATE ${tables[table]} SET data = data || $2::jsonb WHERE data @> $1::jsonb`,
      [JSON.stringify(filter), JSON.stringify(patch)])
    return (result.rowCount ?? 0) > 0
  }

  async remove(table: Table, filter: Document): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM ${tables[table]} WHERE data @> $1::jsonb`, [JSON.stringify(filter)])
    return (result.rowCount ?? 0) > 0
  }

  async prune(table: "cacheStore" | "userEvents" | "sessions", field: "timestamp" | "updatedAt" | "expiresAt", cutoff: number) {
    const result = await this.client.query(`DELETE FROM ${tables[table]} WHERE (data->>'${field}')::bigint < $1`, [cutoff])
    return result.rowCount ?? 0
  }
}

async function readOperation(db: Documents, operation: string, a: Document): Promise<unknown> {
  const user = { userId: a.userId }
  const profile = { ...user, profileId: a.profileId }
  switch (operation) {
    case "myList:getUserList": return db.list("myList", user)
    case "myList:isInList": return Boolean(await db.first("myList", { ...user, itemId: a.itemId }))
    case "userProfiles:getUserAvatar": return (await db.first("userProfiles", user))?.avatarUrl ?? null
    case "requests:getAllRequests": return db.list("requests")
    case "requests:getUserRequests": return db.list("requests", { requestedByUserId: a.userId })
    case "requests:getRequestById": return db.first("requests", { requestId: a.requestId })
    case "requests:getUserNotifications": return db.list("notifications", user)
    case "cache:getCacheEntry": return db.first("cacheStore", { key: a.key })
    case "cache:getTmdbToTvdb": return (await db.first("tmdbToTvdb", { tmdbId: a.tmdbId }))?.tvdbId ?? null
    case "party:listAllRooms": return db.list("partyRooms")
    case "party:getRoom": return db.first("partyRooms", { partyId: a.partyId })
    case "sessions:getSession": {
      const session = await db.first("sessions", { sid: a.sid })
      return session && session.expiresAt > Date.now() ? session : null
    }
    case "discovery:getRecentEvents": return db.recentEvents(profile, a.sinceTimestamp, a.limit ?? 500)
    case "discovery:getFeatureProfile": return db.first("userFeatureProfiles", profile)
    case "discovery:getRowStats": return db.list("rowImpressionStats")
    case "discovery:getRowFatigue": return db.list("userRowFatigue", profile)
    case "discovery:getItemFeature": return db.first("itemFeatures", { itemKey: a.itemKey })
    case "discovery:getServeLog": return db.first("userServeLog", profile)
    default: throw new Error(`Unknown Postgres read operation: ${operation}`)
  }
}

async function writeOperation(db: Documents, operation: string, a: Document): Promise<unknown> {
  const now = Date.now()
  const user = { userId: a.userId }
  const profile = { ...user, profileId: a.profileId }
  const row = { ...profile, rowCategoryKey: a.rowCategoryKey }
  const sid = { sid: a.sid }
  switch (operation) {
    case "myList:addItem": {
      const existing = await db.first("myList", { ...user, itemId: a.itemId })
      return db.save("myList", { ...a, addedAt: existing?.addedAt ?? nowIso() })
    }
    case "myList:removeItem": return db.remove("myList", { ...user, itemId: a.itemId })
    case "userProfiles:setUserAvatar": return db.save("userProfiles", { ...a, updatedAt: nowIso() })
    case "requests:createRequest": {
      const existing = await db.first("requests", { requestId: a.requestId })
      return existing?._id ?? db.save("requests", { ...a, requestedAt: nowIso() })
    }
    case "requests:updateRequestStatus": {
      const existing = await db.first("requests", { requestId: a.requestId })
      if (!existing) return false
      const updated: Document = { ...existing, status: a.status }
      delete updated._id
      // A new decision clears metadata from the previous decision.
      for (const key of ["approvedBy", "approvedAt", "deniedBy", "deniedAt", "denialReason"]) {
        if (a[key] === undefined) delete updated[key]
        else updated[key] = a[key]
      }
      await db.save("requests", updated)
      return true
    }
    case "requests:addNotification": {
      const existing = await db.first("notifications", { notifId: a.notifId })
      return existing?._id ?? db.save("notifications", { ...a, read: false, createdAt: nowIso() })
    }
    case "requests:updateNotification": return db.patch("notifications", { ...user, notifId: a.notifId }, a)
    case "requests:markNotificationRead": return db.patch("notifications", { ...user, notifId: a.notifId }, { read: true })
    case "requests:markAllNotificationsRead": return db.patch("notifications", user, { read: true })
    case "requests:markRequestNotificationsRead": return db.patch("notifications", { requestId: a.requestId, type: "admin_request" }, { read: true })
    case "cache:setCacheEntry": return db.save("cacheStore", { ...a, updatedAt: now })
    case "cache:setTmdbToTvdb": return db.save("tmdbToTvdb", { ...a, updatedAt: now })
    case "cache:clearStaleCache": return db.prune("cacheStore", "updatedAt", now - a.olderThanMs)
    case "party:upsertRoom": return db.save("partyRooms", a)
    case "party:deleteRoom": return db.remove("partyRooms", { partyId: a.partyId })
    case "sessions:storeSession": {
      const existing = await db.first("sessions", sid)
      return db.save("sessions", { ...sid, userId: a.userId, sessionDataJson: a.sessionDataJson,
        expiresAt: now + (a.ttlMs ?? 90 * DAY), createdAt: existing?.createdAt ?? now, updatedAt: now })
    }
    case "sessions:touchSession": return db.patch("sessions", sid, { expiresAt: now + 90 * DAY, updatedAt: now })
    case "sessions:removeSession": return db.remove("sessions", sid)
    case "sessions:removeAllUserSessions": return db.remove("sessions", user)
    case "sessions:updateSessionToken": {
      const existing = await db.first("sessions", sid)
      if (!existing) return
      const data = JSON.parse(existing.sessionDataJson)
      data.accessToken = a.newAccessToken
      return db.patch("sessions", sid, { sessionDataJson: JSON.stringify(data), expiresAt: now + 90 * DAY, updatedAt: now })
    }
    case "discovery:logEvent": return db.save("userEvents", a)
    case "discovery:pruneOldEvents": return db.prune("userEvents", "timestamp", now - a.olderThanMs)
    case "discovery:saveFeatureProfile": return db.save("userFeatureProfiles", { ...a, updatedAt: now })
    case "discovery:recordRowImpression": {
      const existing = await db.first("rowImpressionStats", { rowCategoryKey: a.rowCategoryKey })
      return db.save("rowImpressionStats", { rowCategoryKey: a.rowCategoryKey,
        totalImpressions: (existing?.totalImpressions ?? 0) + 1,
        totalClicks: (existing?.totalClicks ?? 0) + (a.clicked ? 1 : 0),
        totalPlays: (existing?.totalPlays ?? 0) + (a.played ? 1 : 0), lastUpdated: now })
    }
    case "discovery:recordRowFatigueImpression": {
      const existing = await db.first("userRowFatigue", row)
      return db.save("userRowFatigue", { ...row,
        unclickedImpressions: (existing?.unclickedImpressions ?? 0) + 1, lastSeenTimestamp: now })
    }
    case "discovery:resetRowFatigue": return db.patch("userRowFatigue", row, { unclickedImpressions: 0 })
    case "discovery:setItemFeature": return db.save("itemFeatures", { ...a, updatedAt: now })
    case "discovery:recordServeLog": {
      const existing = await db.first("userServeLog", profile)
      const serves: Record<string, { count: number; lastServedAt: number }> = existing ? JSON.parse(existing.servesJson) : {}
      for (const key of Object.keys(serves)) if (now - serves[key].lastServedAt > 7 * DAY) delete serves[key]
      for (const key of a.itemKeys as string[]) serves[key] = { count: (serves[key]?.count ?? 0) + 1, lastServedAt: now }
      return db.save("userServeLog", { ...profile, servesJson: JSON.stringify(serves), updatedAt: now })
    }
    default: throw new Error(`Unknown Postgres write operation: ${operation}`)
  }
}

/** Serialize read/modify/write operations per feature, including insert races.
 * Shared locks on reads are unnecessary: each write commits atomically. */
export class PostgresStore {
  async read<A extends Record<string, unknown>, R>(operation: StoreOperation<A, R>, args: A): Promise<R> {
    const client = await getPool().connect()
    try { return await readOperation(new Documents(client), operation, args) as R }
    finally { client.release() }
  }

  async write<A extends Record<string, unknown>, R>(operation: StoreOperation<A, R>, args: A): Promise<R> {
    const client = await getPool().connect()
    try {
      await client.query("BEGIN")
      // Per-feature locks also coordinate bulk updates with single-record writes.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`umrflix:${operation.split(":")[0]}`])
      const result = await writeOperation(new Documents(client), operation, args)
      await client.query("COMMIT")
      return result as R
    } catch (error) {
      await client.query("ROLLBACK")
      throw error
    } finally { client.release() }
  }
}

const store = new PostgresStore()
/** File/memory development mode is retained only when DATABASE_URL is unset. */
export function getPostgresStore(): PostgresStore | null {
  return env("DATABASE_URL") ? store : null
}
