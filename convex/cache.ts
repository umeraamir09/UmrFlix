import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

export const getCacheEntry = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("cacheStore")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first()
    return entry
  },
})

export const setCacheEntry = mutation({
  args: { key: v.string(), dataJson: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cacheStore")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        dataJson: args.dataJson,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("cacheStore", {
      key: args.key,
      dataJson: args.dataJson,
      updatedAt: now,
    })
  },
})

export const getTmdbToTvdb = query({
  args: { tmdbId: v.number() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("tmdbToTvdb")
      .withIndex("by_tmdb", (q) => q.eq("tmdbId", args.tmdbId))
      .first()
    return entry?.tvdbId ?? null
  },
})

export const setTmdbToTvdb = mutation({
  args: { tmdbId: v.number(), tvdbId: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tmdbToTvdb")
      .withIndex("by_tmdb", (q) => q.eq("tmdbId", args.tmdbId))
      .first()

    const now = Date.now()
    if (existing) {
      await ctx.db.patch(existing._id, {
        tvdbId: args.tvdbId,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("tmdbToTvdb", {
      tmdbId: args.tmdbId,
      tvdbId: args.tvdbId,
      updatedAt: now,
    })
  },
})

export const clearStaleCache = mutation({
  args: { olderThanMs: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanMs
    const entries = await ctx.db.query("cacheStore").collect()
    let deletedCount = 0

    for (const entry of entries) {
      if (entry.updatedAt < cutoff) {
        await ctx.db.delete(entry._id)
        deletedCount++
      }
    }
    return deletedCount
  },
})
