import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { loadEnvConfig } from "@next/env"
import { Pool } from "pg"
import { PostgresStore, type StoreOperation } from "../store"
import { getPool } from "../pool"
import { cleanupDatabase } from "../maintenance"
import { persistRoomToPostgres, deleteRoomFromPostgres, loadAllRoomsFromPostgres } from "../../party/party-postgres-store"
import type { PartyRoom } from "../../party/room-manager"

loadEnvConfig(process.cwd())

// Integration tests use a unique, disposable schema on the configured server.
// They never read or modify the application's public schema.
test("Postgres persistence", { skip: !process.env.DATABASE_URL }, async t => {
  const admin = new Pool({ connectionString: process.env.DATABASE_URL })
  const schema = `umrflix_test_${randomUUID().replaceAll("-", "")}`
  const originalUrl = process.env.DATABASE_URL!
  await admin.query(`CREATE SCHEMA ${schema}`)
  const url = new URL(originalUrl)
  url.searchParams.set("options", `-c search_path=${schema}`)
  process.env.DATABASE_URL = url.toString()
  const pool = getPool()
  const store = new PostgresStore()
  // Test operations deliberately use open document types to exercise the actual
  // database implementation rather than mocked driver calls.
  type Doc = Record<string, unknown>
  const read = <R>(name: string, args: Doc) => store.read(name as StoreOperation<Doc, R>, args)
  const write = (name: string, args: Doc) => store.write(name as StoreOperation<Doc, unknown>, args)
  try {
    const sql = await readFile(new URL("../schema.sql", import.meta.url), "utf8")
    await pool.query(sql)
    await pool.query(sql) // Schema initialization is safe to repeat.

    await t.test("watchlist upsert preserves time and isolates users", async () => {
      await write("myList:addItem", { userId: "alice", itemId: "movie:1", title: "First", posterPath: null })
      const first = await read<Doc[]>("myList:getUserList", { userId: "alice" })
      await write("myList:addItem", { userId: "alice", itemId: "movie:1", title: "Updated", posterPath: null })
      const second = await read<Doc[]>("myList:getUserList", { userId: "alice" })
      assert.equal(second.length, 1)
      assert.equal(second[0].addedAt, first[0].addedAt)
      assert.equal(second[0].title, "Updated")
      assert.equal(second[0].posterPath, null)
      assert.deepEqual(await read("myList:getUserList", { userId: "bob" }), [])
      assert.equal(await write("myList:removeItem", { userId: "bob", itemId: "movie:1" }), false)
      assert.equal(await read("myList:isInList", { userId: "alice", itemId: "movie:1" }), true)
      assert.equal(await write("myList:removeItem", { userId: "alice", itemId: "movie:1" }), true)
    })

    await t.test("request metadata and notifications persist with scoped updates", async () => {
      await write("requests:createRequest", { requestId: "r1", requestedByUserId: "alice", title: "Movie", status: "pending", posterPath: null, tags: [1], minimumAvailability: "released" })
      await write("requests:createRequest", { requestId: "r1", requestedByUserId: "alice", title: "Duplicate" })
      await write("requests:updateRequestStatus", { requestId: "r1", status: "approved", approvedBy: "admin" })
      const request = await read<Doc>("requests:getRequestById", { requestId: "r1" })
      assert.equal(request.title, "Movie")
      assert.equal(request.status, "approved")
      assert.deepEqual(request.tags, [1])
      await write("requests:updateRequestStatus", { requestId: "r1", status: "denied", deniedBy: "admin", denialReason: "Denied" })
      const denied = await read<Doc>("requests:getRequestById", { requestId: "r1" })
      assert.equal(denied.approvedBy, undefined)
      assert.equal(denied.denialReason, "Denied")
      const { getRequestById } = await import("../../requests-store")
      const mapped = await getRequestById("r1")
      assert.equal(mapped?.minimumAvailability, "released")
      assert.deepEqual(mapped?.tags, [1])
      assert.deepEqual(await read("requests:getUserRequests", { userId: "bob" }), [])
      await write("requests:addNotification", { notifId: "n1", userId: "alice", requestId: "r1", type: "admin_request", message: "Pending" })
      await write("requests:markNotificationRead", { notifId: "n1", userId: "bob" })
      let notifications = await read<Doc[]>("requests:getUserNotifications", { userId: "alice" })
      assert.equal(notifications[0].read, false)
      await write("requests:updateNotification", { notifId: "n1", userId: "alice", message: "Ready", jellyfinItemId: "j1" })
      await write("requests:markRequestNotificationsRead", { requestId: "r1" })
      notifications = await read<Doc[]>("requests:getUserNotifications", { userId: "alice" })
      assert.equal(notifications[0].message, "Ready")
      assert.equal(notifications[0].jellyfinItemId, "j1")
      assert.equal(notifications[0].read, true)
    })

    await t.test("sessions survive a new store instance, expire, update and revoke", async () => {
      await write("sessions:storeSession", { sid: "s1", userId: "alice", sessionDataJson: '{"accessToken":"old"}' })
      const restarted = new PostgresStore()
      const record = await restarted.read("sessions:getSession" as StoreOperation<{ sid: string }, Doc>, { sid: "s1" })
      assert.equal(record.userId, "alice")
      await write("sessions:updateSessionToken", { sid: "s1", newAccessToken: "new" })
      const updated = await read<Doc>("sessions:getSession", { sid: "s1" })
      assert.equal(JSON.parse(updated.sessionDataJson as string).accessToken, "new")
      await write("sessions:storeSession", { sid: "expired", userId: "alice", sessionDataJson: "{}", ttlMs: -1 })
      assert.equal(await read("sessions:getSession", { sid: "expired" }), null)
      await write("sessions:removeAllUserSessions", { userId: "alice" })
      assert.equal(await read("sessions:getSession", { sid: "s1" }), null)
    })

    await t.test("avatar, cache, mapping and party snapshots round trip", async () => {
      await write("userProfiles:setUserAvatar", { userId: "alice", avatarUrl: "/avatars/1.png" })
      assert.equal(await read("userProfiles:getUserAvatar", { userId: "alice" }), "/avatars/1.png")
      await write("cache:setCacheEntry", { key: "movies", dataJson: "[]" })
      assert.equal((await read<Doc>("cache:getCacheEntry", { key: "movies" })).dataJson, "[]")
      await write("cache:setTmdbToTvdb", { tmdbId: 1, tvdbId: 2 })
      assert.equal(await read("cache:getTmdbToTvdb", { tmdbId: 1 }), 2)
      await write("party:upsertRoom", { partyId: "p1", ownerId: "alice", membersJson: "[]", stateJson: '{"positionSec":42}', createdAt: 1, updatedAt: 2 })
      assert.equal((await read<Doc>("party:getRoom", { partyId: "p1" })).stateJson, '{"positionSec":42}')
      await write("party:deleteRoom", { partyId: "p1" })
      assert.deepEqual(await read("party:listAllRooms", {}), [])
    })

    await t.test("party hydration preserves snapshots and ordered deletion prevents resurrection", async () => {
      const room: PartyRoom = {
        id: "queued-party", ownerId: "alice", createdAt: 100,
        state: null, members: new Map(), pendingInvites: new Set(["bob"]),
        lastSeenAt: new Map(), pausedForBuffering: false,
      }
      await persistRoomToPostgres(room)
      const loaded = await loadAllRoomsFromPostgres()
      assert.equal(loaded[0].ownerId, "alice")
      assert.deepEqual([...loaded[0].pendingInvites], ["bob"])
      const writes = Array.from({ length: 10 }, () => persistRoomToPostgres(room))
      const deletion = deleteRoomFromPostgres(room.id)
      await Promise.all([...writes, deletion])
      assert.equal(await read("party:getRoom", { partyId: room.id }), null)
    })

    await t.test("concurrent discovery updates do not lose counts", async () => {
      await Promise.all(Array.from({ length: 20 }, () => write("discovery:recordRowImpression", { rowCategoryKey: "trending", clicked: true })))
      const stats = await read<Doc[]>("discovery:getRowStats", {})
      assert.equal(stats[0].totalImpressions, 20)
      assert.equal(stats[0].totalClicks, 20)
      const profile = { userId: "alice", profileId: "default" }
      await Promise.all(Array.from({ length: 10 }, () => write("discovery:recordServeLog", { ...profile, itemKeys: ["movie:1"] })))
      const serves = await read<Doc>("discovery:getServeLog", profile)
      assert.equal(JSON.parse(serves.servesJson as string)["movie:1"].count, 10)
      await write("discovery:recordRowFatigueImpression", { ...profile, rowCategoryKey: "trending" })
      await write("discovery:resetRowFatigue", { ...profile, rowCategoryKey: "trending" })
      assert.equal((await read<Doc[]>("discovery:getRowFatigue", profile))[0].unclickedImpressions, 0)
      await write("discovery:saveFeatureProfile", { ...profile, shortTermVectorJson: "[1]", longTermVectorJson: "[2]", lastActiveTimestamp: 1 })
      assert.equal((await read<Doc>("discovery:getFeatureProfile", profile)).shortTermVectorJson, "[1]")
      await write("discovery:setItemFeature", { itemKey: "movie:1", dataJson: "{}" })
      assert.equal((await read<Doc>("discovery:getItemFeature", { itemKey: "movie:1" })).dataJson, "{}")
      for (const timestamp of [1, 3, 2]) await write("discovery:logEvent", { ...profile, itemId: "movie:1", timestamp })
      const events = await read<Doc[]>("discovery:getRecentEvents", { ...profile, sinceTimestamp: 2, limit: 1 })
      assert.deepEqual(events.map(e => e.timestamp), [3])
    })

    await t.test("retention removes expired records and keeps fresh records", async () => {
      await pool.query("UPDATE umrflix_cache_store SET data = data || '{\"updatedAt\":1}'::jsonb")
      await write("cache:setCacheEntry", { key: "fresh", dataJson: "{}" })
      await write("sessions:storeSession", { sid: "old", userId: "alice", sessionDataJson: "{}", ttlMs: -1 })
      await cleanupDatabase(pool)
      assert.equal(await read("cache:getCacheEntry", { key: "movies" }), null)
      assert.notEqual(await read("cache:getCacheEntry", { key: "fresh" }), null)
      assert.deepEqual(await read("discovery:getRecentEvents", { userId: "alice", profileId: "default", sinceTimestamp: 0 }), [])
      assert.equal((await pool.query("SELECT count(*) FROM umrflix_sessions")).rows[0].count, "0")
    })

    await t.test("SQL failure rolls back and returns the connection", async () => {
      await assert.rejects(write("unknown:operation", {}), /Unknown Postgres write/)
      await write("cache:setCacheEntry", { key: "after-failure", dataJson: "{}" })
      assert.notEqual(await read("cache:getCacheEntry", { key: "after-failure" }), null)
    })
  } finally {
    await pool.end()
    process.env.DATABASE_URL = originalUrl
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
