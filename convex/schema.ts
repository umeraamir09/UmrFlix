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

  requests: defineTable({
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
    requestedAt: v.string(),
    status: v.string(),
    qualityProfileId: v.number(),
    rootFolderPath: v.string(),
    seasonsJson: v.optional(v.string()),
    denialReason: v.optional(v.string()),
    approvedAt: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    deniedAt: v.optional(v.string()),
    deniedBy: v.optional(v.string()),
  })
    .index("by_request_id", ["requestId"])
    .index("by_user", ["requestedByUserId"])
    .index("by_status", ["status"]),

  notifications: defineTable({
    notifId: v.string(),
    userId: v.string(),
    requestId: v.string(),
    title: v.string(),
    message: v.string(),
    type: v.string(),
    read: v.boolean(),
    createdAt: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  cacheStore: defineTable({
    key: v.string(),
    dataJson: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  tmdbToTvdb: defineTable({
    tmdbId: v.number(),
    tvdbId: v.number(),
    updatedAt: v.number(),
  }).index("by_tmdb", ["tmdbId"]),
})


