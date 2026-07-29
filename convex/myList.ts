import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

export const getUserList = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("myList")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
  },
})

export const isInList = query({
  args: { userId: v.string(), itemId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_item", (q) =>
        q.eq("userId", args.userId).eq("itemId", args.itemId)
      )
      .first()
    return Boolean(existing)
  },
})

export const addItem = mutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
    tmdbId: v.optional(v.number()),
    tvdbId: v.optional(v.number()),
    jellyfinId: v.optional(v.string()),
    mediaType: v.string(),
    title: v.string(),
    posterPath: v.optional(v.union(v.string(), v.null())),
    overview: v.optional(v.string()),
    releaseYear: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_item", (q) =>
        q.eq("userId", args.userId).eq("itemId", args.itemId)
      )
      .first()

    const now = new Date().toISOString()

    if (existing) {
      await ctx.db.patch(existing._id, {
        tmdbId: args.tmdbId,
        tvdbId: args.tvdbId,
        jellyfinId: args.jellyfinId,
        mediaType: args.mediaType,
        title: args.title,
        posterPath: args.posterPath,
        overview: args.overview,
        releaseYear: args.releaseYear,
      })
      return existing._id
    }

    return await ctx.db.insert("myList", {
      userId: args.userId,
      itemId: args.itemId,
      tmdbId: args.tmdbId,
      tvdbId: args.tvdbId,
      jellyfinId: args.jellyfinId,
      mediaType: args.mediaType,
      title: args.title,
      posterPath: args.posterPath,
      overview: args.overview,
      releaseYear: args.releaseYear,
      addedAt: now,
    })
  },
})

export const removeItem = mutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("myList")
      .withIndex("by_user_item", (q) =>
        q.eq("userId", args.userId).eq("itemId", args.itemId)
      )
      .first()

    if (existing) {
      await ctx.db.delete(existing._id)
      return true
    }

    return false
  },
})
