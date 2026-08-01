import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

export const getUserAvatar = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first()
    return profile?.avatarUrl ?? null
  },
})

export const setUserAvatar = mutation({
  args: {
    userId: v.string(),
    avatarUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userProfiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first()

    const now = new Date().toISOString()

    if (existing) {
      await ctx.db.patch(existing._id, {
        avatarUrl: args.avatarUrl,
        updatedAt: now,
      })
      return existing._id
    }

    return await ctx.db.insert("userProfiles", {
      userId: args.userId,
      avatarUrl: args.avatarUrl,
      updatedAt: now,
    })
  },
})
