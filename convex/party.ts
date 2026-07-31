import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const upsertRoom = mutation({
  args: {
    partyId: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
    stateJson: v.optional(v.string()),
    membersJson: v.string(),
    pendingInvitesJson: v.string(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("partyRooms")
      .withIndex("by_party_id", (q) => q.eq("partyId", args.partyId))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        ownerId: args.ownerId,
        stateJson: args.stateJson,
        membersJson: args.membersJson,
        pendingInvitesJson: args.pendingInvitesJson,
        updatedAt: args.updatedAt,
      })
      return existing._id
    } else {
      return await ctx.db.insert("partyRooms", {
        partyId: args.partyId,
        ownerId: args.ownerId,
        createdAt: args.createdAt,
        stateJson: args.stateJson,
        membersJson: args.membersJson,
        pendingInvitesJson: args.pendingInvitesJson,
        updatedAt: args.updatedAt,
      })
    }
  },
})

export const getRoom = query({
  args: { partyId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("partyRooms")
      .withIndex("by_party_id", (q) => q.eq("partyId", args.partyId))
      .first()
  },
})

export const deleteRoom = mutation({
  args: { partyId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("partyRooms")
      .withIndex("by_party_id", (q) => q.eq("partyId", args.partyId))
      .first()

    if (existing) {
      await ctx.db.delete(existing._id)
    }
  },
})

export const listAllRooms = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("partyRooms").collect()
  },
})
