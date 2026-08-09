import { query, mutation } from "./_generated/server"
import { v } from "convex/values"

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000

export const getSession = query({
  args: { sid: v.string() },
  handler: async (ctx, { sid }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sid", (q) => q.eq("sid", sid))
      .first()

    if (!existing) return null
    if (existing.expiresAt <= Date.now()) return null

    return {
      sid: existing.sid,
      userId: existing.userId,
      sessionDataJson: existing.sessionDataJson,
      expiresAt: existing.expiresAt,
    }
  },
})

export const storeSession = mutation({
  args: {
    sid: v.string(),
    userId: v.string(),
    sessionDataJson: v.string(),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, { sid, userId, sessionDataJson, ttlMs }) => {
    const now = Date.now()
    const expiresAt = now + (ttlMs ?? NINETY_DAYS_MS)

    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sid", (q) => q.eq("sid", sid))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        sessionDataJson,
        expiresAt,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert("sessions", {
        sid,
        userId,
        sessionDataJson,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
    }
  },
})

export const touchSession = mutation({
  args: { sid: v.string() },
  handler: async (ctx, { sid }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sid", (q) => q.eq("sid", sid))
      .first()

    if (existing) {
      const now = Date.now()
      await ctx.db.patch(existing._id, {
        expiresAt: now + NINETY_DAYS_MS,
        updatedAt: now,
      })
    }
  },
})

export const removeSession = mutation({
  args: { sid: v.string() },
  handler: async (ctx, { sid }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sid", (q) => q.eq("sid", sid))
      .first()

    if (existing) {
      await ctx.db.delete(existing._id)
    }
  },
})

export const removeAllUserSessions = mutation({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()

    for (const session of sessions) {
      await ctx.db.delete(session._id)
    }
  },
})

export const updateSessionToken = mutation({
  args: { sid: v.string(), newAccessToken: v.string() },
  handler: async (ctx, { sid, newAccessToken }) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sid", (q) => q.eq("sid", sid))
      .first()

    if (existing) {
      try {
        const parsed = JSON.parse(existing.sessionDataJson)
        parsed.accessToken = newAccessToken
        const now = Date.now()
        await ctx.db.patch(existing._id, {
          sessionDataJson: JSON.stringify(parsed),
          expiresAt: now + NINETY_DAYS_MS,
          updatedAt: now,
        })
      } catch {
        /* ignore invalid json */
      }
    }
  },
})
