import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

/**
 * Discovery engine persistence: signal event log, 64-D user feature profiles,
 * global row bandit stats (UCB1) and per-user row fatigue counters.
 */

// ── Signal ingestion ──

export const logEvent = mutation({
  args: {
    userId: v.string(),
    profileId: v.string(),
    itemId: v.string(),
    tmdbId: v.optional(v.number()),
    mediaType: v.optional(v.string()),
    title: v.optional(v.string()),
    eventType: v.string(),
    weight: v.optional(v.number()),
    completionPct: v.optional(v.number()),
    watchDurationSec: v.optional(v.number()),
    context: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("userEvents", args)
  },
})

export const getRecentEvents = query({
  args: {
    userId: v.string(),
    profileId: v.string(),
    sinceTimestamp: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("userEvents")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .filter((q) => q.gte(q.field("timestamp"), args.sinceTimestamp))
      .collect()

    events.sort((a, b) => b.timestamp - a.timestamp)
    return events.slice(0, args.limit ?? 500)
  },
})

export const pruneOldEvents = mutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs
    let deleted = 0
    let cursor: string | null = null
    do {
      const page = await ctx.db
        .query("userEvents")
        .withIndex("by_timestamp")
        .filter((q) => q.lt(q.field("timestamp"), cutoff))
        .paginate({ numItems: 100, cursor })
      for (const event of page.page) {
        await ctx.db.delete(event._id)
        deleted++
      }
      cursor = page.continueCursor ?? null
      // isDone signals the filtered scan reached the end of the cutoff range
      if (page.isDone) cursor = null
    } while (cursor)
    return deleted
  },
})

// ── 64-D feature profiles ──

export const saveFeatureProfile = mutation({
  args: {
    userId: v.string(),
    profileId: v.string(),
    shortTermVectorJson: v.string(),
    longTermVectorJson: v.string(),
    lastActiveTimestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userFeatureProfiles")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        shortTermVectorJson: args.shortTermVectorJson,
        longTermVectorJson: args.longTermVectorJson,
        lastActiveTimestamp: args.lastActiveTimestamp,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("userFeatureProfiles", {
      ...args,
      updatedAt: now,
    })
  },
})

export const getFeatureProfile = query({
  args: { userId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userFeatureProfiles")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .first()
  },
})

// ── Global row bandit statistics (UCB1) ──

export const recordRowImpression = mutation({
  args: {
    rowCategoryKey: v.string(),
    clicked: v.optional(v.boolean()),
    played: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("rowImpressionStats")
      .withIndex("by_category", (q) => q.eq("rowCategoryKey", args.rowCategoryKey))
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        totalImpressions: existing.totalImpressions + 1,
        totalClicks: existing.totalClicks + (args.clicked ? 1 : 0),
        totalPlays: existing.totalPlays + (args.played ? 1 : 0),
        lastUpdated: now,
      })
      return existing._id
    }

    return await ctx.db.insert("rowImpressionStats", {
      rowCategoryKey: args.rowCategoryKey,
      totalImpressions: 1,
      totalClicks: args.clicked ? 1 : 0,
      totalPlays: args.played ? 1 : 0,
      lastUpdated: now,
    })
  },
})

export const getRowStats = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("rowImpressionStats").collect()
  },
})

// ── Per-user row fatigue ──

export const recordRowFatigueImpression = mutation({
  args: {
    userId: v.string(),
    profileId: v.string(),
    rowCategoryKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userRowFatigue")
      .withIndex("by_user_row", (q) =>
        q
          .eq("userId", args.userId)
          .eq("profileId", args.profileId)
          .eq("rowCategoryKey", args.rowCategoryKey)
      )
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        unclickedImpressions: existing.unclickedImpressions + 1,
        lastSeenTimestamp: now,
      })
      return existing._id
    }

    return await ctx.db.insert("userRowFatigue", {
      userId: args.userId,
      profileId: args.profileId,
      rowCategoryKey: args.rowCategoryKey,
      unclickedImpressions: 1,
      lastSeenTimestamp: now,
    })
  },
})

export const resetRowFatigue = mutation({
  args: {
    userId: v.string(),
    profileId: v.string(),
    rowCategoryKey: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userRowFatigue")
      .withIndex("by_user_row", (q) =>
        q
          .eq("userId", args.userId)
          .eq("profileId", args.profileId)
          .eq("rowCategoryKey", args.rowCategoryKey)
      )
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, { unclickedImpressions: 0 })
      return true
    }
    return false
  },
})

export const getRowFatigue = query({
  args: { userId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userRowFatigue")
      .withIndex("by_user_row", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .collect()
  },
})

// ── Item feature memory ──

export const getItemFeature = query({
  args: { itemKey: v.string() },
  handler: async (ctx, args) =>
    (await ctx.db.query("itemFeatures").withIndex("by_itemKey", (q) => q.eq("itemKey", args.itemKey)).first()) ?? null,
})

export const setItemFeature = mutation({
  args: { itemKey: v.string(), dataJson: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("itemFeatures")
      .withIndex("by_itemKey", (q) => q.eq("itemKey", args.itemKey))
      .first()
    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, { dataJson: args.dataJson, updatedAt: now })
      return existing._id
    }
    return await ctx.db.insert("itemFeatures", { itemKey: args.itemKey, dataJson: args.dataJson, updatedAt: now })
  },
})

// ── Serve log ──

export const getServeLog = query({
  args: { userId: v.string(), profileId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("userServeLog")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .first()
  },
})

export const recordServeLog = mutation({
  args: {
    userId: v.string(),
    profileId: v.string(),
    itemKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userServeLog")
      .withIndex("by_user_profile", (q) =>
        q.eq("userId", args.userId).eq("profileId", args.profileId)
      )
      .first()

    const now = Date.now()
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
    const map: Record<string, { count: number; lastServedAt: number }> = existing
      ? JSON.parse(existing.servesJson)
      : {}

    for (const key of Object.keys(map)) {
      if (now - map[key].lastServedAt > SEVEN_DAYS_MS) {
        delete map[key]
      }
    }

    for (const itemKey of args.itemKeys) {
      const prev = map[itemKey]
      map[itemKey] = {
        count: (prev?.count ?? 0) + 1,
        lastServedAt: now,
      }
    }

    const servesJson = JSON.stringify(map)
    if (existing) {
      await ctx.db.patch(existing._id, { servesJson, updatedAt: now })
      return existing._id
    }
    return await ctx.db.insert("userServeLog", {
      userId: args.userId,
      profileId: args.profileId,
      servesJson,
      updatedAt: now,
    })
  },
})
