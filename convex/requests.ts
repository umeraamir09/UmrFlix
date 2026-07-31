import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

export const getAllRequests = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("requests").collect()
  },
})

export const getUserRequests = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_user", (q) => q.eq("requestedByUserId", args.userId))
      .collect()
  },
})

export const getRequestById = query({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("requests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .first()
  },
})

export const createRequest = mutation({
  args: {
    requestId: v.string(),
    tmdbId: v.number(),
    tvdbId: v.optional(v.number()),
    title: v.string(),
    mediaType: v.string(),
    year: v.optional(v.number()),
    posterPath: v.optional(v.string()),
    backdropPath: v.optional(v.string()),
    requestedByUserId: v.string(),
    requestedByUsername: v.string(),
    status: v.string(),
    qualityProfileId: v.number(),
    rootFolderPath: v.string(),
    seasonsJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("requests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .first()

    if (existing) return existing._id

    return await ctx.db.insert("requests", {
      requestId: args.requestId,
      tmdbId: args.tmdbId,
      tvdbId: args.tvdbId,
      title: args.title,
      mediaType: args.mediaType,
      year: args.year,
      posterPath: args.posterPath,
      backdropPath: args.backdropPath,
      requestedByUserId: args.requestedByUserId,
      requestedByUsername: args.requestedByUsername,
      requestedAt: new Date().toISOString(),
      status: args.status,
      qualityProfileId: args.qualityProfileId,
      rootFolderPath: args.rootFolderPath,
      seasonsJson: args.seasonsJson,
    })
  },
})

export const updateRequestStatus = mutation({
  args: {
    requestId: v.string(),
    status: v.string(),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.string()),
    deniedBy: v.optional(v.string()),
    deniedAt: v.optional(v.string()),
    denialReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const req = await ctx.db
      .query("requests")
      .withIndex("by_request_id", (q) => q.eq("requestId", args.requestId))
      .first()

    if (!req) return false

    await ctx.db.patch(req._id, {
      status: args.status,
      approvedBy: args.approvedBy,
      approvedAt: args.approvedAt,
      deniedBy: args.deniedBy,
      deniedAt: args.deniedAt,
      denialReason: args.denialReason,
    })

    return true
  },
})

export const getUserNotifications = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()
  },
})

export const addNotification = mutation({
  args: {
    notifId: v.string(),
    userId: v.string(),
    requestId: v.optional(v.string()),
    partyId: v.optional(v.string()),
    title: v.string(),
    message: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notifications", {
      notifId: args.notifId,
      userId: args.userId,
      requestId: args.requestId,
      partyId: args.partyId,
      title: args.title,
      message: args.message,
      type: args.type,
      read: false,
      createdAt: new Date().toISOString(),
    })
  },
})

export const markNotificationRead = mutation({
  args: { notifId: v.string(), userId: v.string() },
  handler: async (ctx, args) => {
    const notifs = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    for (const n of notifs) {
      if (n.notifId === args.notifId && !n.read) {
        await ctx.db.patch(n._id, { read: true })
      }
    }
  },
})

export const markAllNotificationsRead = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const notifs = await ctx.db
      .query("notifications")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()

    for (const n of notifs) {
      if (!n.read) {
        await ctx.db.patch(n._id, { read: true })
      }
    }
  },
})
