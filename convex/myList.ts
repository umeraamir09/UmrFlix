import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

export const getUserList = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("myList")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
    return items
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

    const newId = await ctx.db.insert("myList", {
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

    return newId
  },
})

export const removeItem = mutation({
  args: {
    userId: v.string(),
    itemId: v.string(),
  },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("myList")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    let count = 0
    for (const item of items) {
      if (
        item.itemId === args.itemId ||
        (item.jellyfinId && item.jellyfinId === args.itemId) ||
        (item.tmdbId && String(item.tmdbId) === args.itemId)
      ) {
        await ctx.db.delete(item._id)
        count++
      }
    }
    return count > 0
  },
})
