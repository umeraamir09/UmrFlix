import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

export default defineSchema({
  myList: defineTable({
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
    addedAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_item", ["userId", "itemId"]),
})
