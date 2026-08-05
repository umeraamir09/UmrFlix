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
    posterPath: v.optional(v.union(v.string(), v.null())),
    backdropPath: v.optional(v.union(v.string(), v.null())),
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
    requestId: v.optional(v.string()),
    partyId: v.optional(v.string()),
    title: v.string(),
    message: v.string(),
    type: v.string(),
    read: v.boolean(),
    createdAt: v.string(),
    jellyfinItemId: v.optional(v.string()),
    mediaType: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"]),

  cacheStore: defineTable({
    key: v.string(),
    dataJson: v.string(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_updatedAt", ["updatedAt"]),

  tmdbToTvdb: defineTable({
    tmdbId: v.number(),
    tvdbId: v.number(),
    updatedAt: v.number(),
  }).index("by_tmdb", ["tmdbId"]),

  partyRooms: defineTable({
    partyId: v.string(),
    ownerId: v.string(),
    createdAt: v.number(),
    stateJson: v.optional(v.string()),
    membersJson: v.string(),
    pendingInvitesJson: v.string(),
    updatedAt: v.number(),
  }).index("by_party_id", ["partyId"]),

  userProfiles: defineTable({
    userId: v.string(),
    avatarUrl: v.string(),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  // ── Discovery engine (personalized home/genre feed) ──

  // Immutable signal log: implicit playback events, explicit favorites and
  // impression/click tracking rows. `weight` is precomputed at ingestion time
  // using the Module 1 weighting matrix; `title`/`mediaType` are denormalized
  // to avoid re-fetching item detail when building profile vectors.
  userEvents: defineTable({
    userId: v.string(),
    profileId: v.string(),
    itemId: v.string(),
    tmdbId: v.optional(v.number()),
    mediaType: v.optional(v.string()),
    title: v.optional(v.string()),
    eventType: v.string(), // "play_complete", "partial_play", "abandonment", "rewatch", "favorite", "unfavorite", "request", "scroll_pass", "rating"
    weight: v.optional(v.number()),
    completionPct: v.optional(v.number()),
    watchDurationSec: v.optional(v.number()),
    context: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_user_profile", ["userId", "profileId"])
    .index("by_user_item", ["userId", "itemId"])
    .index("by_timestamp", ["timestamp"]),

  userFeatureProfiles: defineTable({
    userId: v.string(),
    profileId: v.string(),
    shortTermVectorJson: v.string(), // 64-D float array JSON
    longTermVectorJson: v.string(),  // 64-D float array JSON
    lastActiveTimestamp: v.number(),
    updatedAt: v.number(),
  }).index("by_user_profile", ["userId", "profileId"]),

  // Global (cross-user) bandit statistics per row category for UCB1.
  rowImpressionStats: defineTable({
    rowCategoryKey: v.string(),
    totalImpressions: v.number(),
    totalClicks: v.number(),
    totalPlays: v.number(),
    lastUpdated: v.number(),
  }).index("by_category", ["rowCategoryKey"]),

  userRowFatigue: defineTable({
    userId: v.string(),
    profileId: v.string(),
    rowCategoryKey: v.string(),
    unclickedImpressions: v.number(),
    lastSeenTimestamp: v.number(),
  }).index("by_user_row", ["userId", "profileId", "rowCategoryKey"]),

  itemFeatures: defineTable({
    itemKey: v.string(), // "movie:550" | "tv:1399"
    dataJson: v.string(), // serialized ItemProfile (vector + scoring meta)
    updatedAt: v.number(),
  }).index("by_itemKey", ["itemKey"]),

  userServeLog: defineTable({
    userId: v.string(),
    profileId: v.string(),
    servesJson: v.string(), // { [itemKey]: { count: number, lastServedAt: number } }
    updatedAt: v.number(),
  }).index("by_user_profile", ["userId", "profileId"]),
})


