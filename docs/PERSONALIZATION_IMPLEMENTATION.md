# UmrFlix Discovery Engine - Implementation Plan (Self-Contained)

**Audience:** an implementer (human or LLM) with **no prior context**. Everything needed is in this file plus the repo itself.
**Design rationale:** `PERSONALIZATION.md` (same directory). This plan is the **authoritative build order**; where the two disagree, this file wins (deltas in section 2).
**Repo:** Next.js 16 (App Router, TypeScript) + Convex (self-hosted or cloud) + TMDB + Jellyfin + Radarr/Sonarr.

## 0. How to use this document

- Work through Phases 0-5 **strictly in order**. Each phase is independently shippable: never leave `npm run lint`, `npm run build`, and `npm run test:discovery` broken between steps.
- Every step names exact files. Read each file before editing it. Match existing code style (no new dependencies, no new styling system, Tailwind v4 for UI).
- Secrets stay server-side. New env vars go through `src/lib/env.ts` and get documented in README if added.
- Do NOT rewrite modules marked "keep as-is". The codebase contains a partially-built engine; this plan corrects and completes it. Wholesale rewrites are the failure mode.

## 1. Project facts

- Commands: `npm run dev`, `npm run lint`, `npm run build`, `npm run test:party`, `npm run test:discovery` (tsx/node:test).
- Deployment: single Node process (PM2 fork mode) on a VPS - **in-process caches are valid** (same constraint the party engine relies on; see AGENTS.md).
- Session auth: `getSession()` from `src/lib/auth.ts` returns `{ userId, username, maxParentalRating, ... }` from an encrypted cookie. API routes derive `userId` from this - never from client payloads.
- Convex access from Next.js server code: `ConvexHttpClient` via `getConvexClient()` in `src/lib/discovery/store.ts` (env: `CONVEX_SELF_HOSTED_URL` / `NEXT_PUBLIC_CONVEX_SELF_HOSTED_URL` / `CONVEX_URL` / `NEXT_PUBLIC_CONVEX_URL`, optional `CONVEX_SELF_HOSTED_ADMIN_KEY`). When Convex is unreachable, discovery degrades to an in-memory buffer - preserve that pattern.
- Convex function refs are **string-based** (e.g. `"discovery:logEvent"` cast to FunctionReference) - the generated `api` object is not used; follow the same style when adding functions in `convex/discovery.ts`.
- Home page `/` is a shared ISR shell (`revalidate = 3600` in `src/app/page.tsx`). Anything per-user must hydrate client-side via SWR (pattern: `src/components/ContinueWatchingSection.tsx`).
- TMDB access: server-side only via `src/lib/tmdb.ts` (`tmdbFetch`, `discoverMovies`, `discoverTv`, `trending`, `getItemLogo`). Rate headroom ~40-50 req/s, single IP.
- Jellyfin playback heartbeats arrive at `POST /api/jellyfin/playback/progress` (`src/app/api/jellyfin/playback/progress/route.ts`, body `{ itemId, positionTicks, event: "start"|"progress"|"stopped" }`).

## 2. Current state map (read before touching anything)

A prior builder already implemented ~60% of an earlier draft of this spec. Here is exactly what exists and its disposition:

| Component | Where | Status in this plan |
|---|---|---|
| Signal schema (userEvents, userFeatureProfiles, rowImpressionStats, userRowFatigue) | `convex/schema.ts` | Keep; add new tables per Phase 0/2 |
| Convex functions (logEvent, getRecentEvents, saveFeatureProfile, row stats/fatigue) | `convex/discovery.ts` | Keep; extend |
| 64-D item/user vectors (genres, decade, runtime, hashed credits, hashed keywords) | `src/lib/discovery/vector.ts` | **Keep the 64-D format.** (PERSONALIZATION.md's "30-D" was written before this module existed; candidates use sparse no-detail-fetch vectors, so the cost concern never materializes. Do NOT shrink the format.) |
| Profile builder (dual decay 7d/90d, fast-adapt x3, seed extraction, peak-hour histogram) | `src/lib/discovery/profile.ts` | Keep; fix alpha per P0 |
| Row synthesis (top-picks, micro-genre, keyword, BYW seeds, contextual, cold-start) | `src/lib/discovery/rows.ts` | Keep; add pool depth + global dedupe (P2/P4) |
| Ranking (S_item, fatigue, MMR, UCB1) | `src/lib/discovery/ranking.ts` | Fix weights (P0); **rip UCB1 out of the serve path** (P2) |
| Feed orchestrator | `src/lib/discovery/engine.ts` | Keep; add floor, dedupe, demotion, cache (P2/P3) |
| Persistence + in-memory fallback | `src/lib/discovery/store.ts` | Fix item-profile storage (P0); add serve log (P2) |
| Ingestion (playback stopped, favorite toggle) | `src/lib/discovery/ingest.ts` | Fix formulas (P0); add requests/party (P1) |
| `npm run test:discovery` | `src/lib/discovery/__tests__/discovery.test.ts` | Keep green; update where formulas change |
| `POST /api/jellyfin/playback/progress` emits events on `stopped` | already wired | Keep |
| `POST /api/my-list` calls `ingestFavoriteToggle` | already wired | Keep |
| `GET /api/discovery/home`, `POST /api/discovery/impression` | exist, currently unused by UI | Wire up (P3) |
| Home page SSR `generateRecommendations("default")` + hourly-rotating BYW | `src/app/page.tsx` + `src/lib/recommendations.ts` | Replaced by PersonalizedFeed (P3) |
| Genre pages legacy personalization (`hasEnoughSignals`, `getGenreTopPicks`, `getBecauseYouWatched`) | `src/lib/genre-catalog.ts` | Rewire onto the discovery profile (P4) |
| `/movie`, `/tvshows`: static rows via `/api/tmdb/*` endpoints | `src/app/movie/page.tsx`, `src/app/tvshows/page.tsx` | Swap to pooled personalized endpoint (P4) |

---

# Phase 0 - Correctness hotfixes to the existing engine

**Goal:** the already-built engine matches the v1 math. No new features, no UI changes. Small diffs only.

**Why first:** four review-flagged bugs are live in the code right now; everything later builds on these formulas.

## Step 0.1 - Fix the re-watch weight (was: unbounded formula)

File: `src/lib/discovery/ingest.ts`

Current `computeRewatchWeight` implements `0.90 * (1 + 1/ln(1+dt))`, which returns ~2.2 at dt=1 and never fits the documented [-1, 1] weight invariant. Replace the whole function with the spec's flat constant:

```ts
/** Re-watch signal: flat +0.80 for a second completion within 30 days (spec: Module 1). */
export function computeRewatchWeight(_daysSinceLastCompletion: number): number {
  return 0.8
}
```

Keep the 30-day detection logic in `ingestPlaybackStopped` unchanged. Update the rewatch test in `src/lib/discovery/__tests__/discovery.test.ts` to assert `0.8` (and that it does not overflow for any dt).

## Step 0.2 - Fix the profile blend alpha (was: 48h discontinuity)

File: `src/lib/discovery/vector.ts`, function `blendUserVectors`

The 0.65/0.40 flip at 48h inactivity makes the whole feed jump across an invisible boundary. Replace with a fixed blend:

```ts
const ALPHA_SHORT = 0.6
export function blendUserVectors(shortTerm: number[], longTerm: number[], _inactiveMs: number): number[] {
  const s = l2Normalize(shortTerm)
  const l = l2Normalize(longTerm)
  const blended = zeroVector()
  for (let i = 0; i < FEATURE_DIM; i++) blended[i] = ALPHA_SHORT * s[i] + (1 - ALPHA_SHORT) * l[i]
  return blended
}
```

`l2Normalize` already returns a zero vector copy on zero input, so the zero-vector / NaN guard is satisfied - add a test asserting the blend of two zero vectors is a zero vector (not NaN). Update existing blend tests to the 0.6 constant. Leave the `_inactiveMs` parameter in the signature (callers pass it; removing it is churn for no gain).

## Step 0.3 - Fix the partial-play formula bounds

File: `src/lib/discovery/ingest.ts`, `classifyPlaybackStop`

Change `weight: 0.15 + 0.7 * pct` to `weight: 0.10 + 0.70 * pct` (spec range [0.17, 0.72]; the 0.72 -> 1.0 cliff at 90% deliberately rewards finishing). Update the test's expected partial weight accordingly.

## Step 0.4 - Move item-profile cache OUT of cacheStore

**Bug:** `setCachedItemProfile`/`getCachedItemProfile` store resolved TMDB item profiles (with vectors) in Convex `cacheStore` under keys `discovery-item:*`. The daily cron `convex/crons.ts -> cache.clearStaleCache` deletes any cacheStore doc older than 7 days, so the engine's whole item-feature memory evaporates weekly and profile rebuilds re-fetch up to 25 TMDB detail calls per user.

Files: `convex/schema.ts`, `convex/discovery.ts`, `src/lib/discovery/store.ts`

1. Add a dedicated table to `convex/schema.ts` (inside `defineSchema({...})`, before the closing `})`):

```ts
itemFeatures: defineTable({
  itemKey: v.string(),              // "movie:550" | "tv:1399"
  dataJson: v.string(),             // serialized ItemProfile (vector + scoring meta)
  updatedAt: v.number(),
}).index("by_itemKey", ["itemKey"]),
```

2. In `convex/discovery.ts` add two functions matching the existing string-ref style:

```ts
export const getItemFeature = query({
  args: { itemKey: v.string() },
  handler: async (ctx, args) =>
    (await ctx.db.query("itemFeatures").withIndex("by_itemKey", q => q.eq("itemKey", args.itemKey)).first()) ?? null,
})

export const setItemFeature = mutation({
  args: { itemKey: v.string(), dataJson: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("itemFeatures").withIndex("by_itemKey", q => q.eq("itemKey", args.itemKey)).first()
    if (existing) { await ctx.db.patch(existing._id, { dataJson: args.dataJson, updatedAt: Date.now() }); return existing._id }
    return await ctx.db.insert("itemFeatures", { itemKey: args.itemKey, dataJson: args.dataJson, updatedAt: Date.now() })
  },
})
```

3. In `store.ts` replace the `getCacheEntryRef`/`setCacheEntryRef` usage inside `getCachedItemProfile`/`setCachedItemProfile` with `"discovery:getItemFeature"` / `"discovery:setItemFeature"` refs (args `{ itemKey }` / `{ itemKey, dataJson }`). Keep the 6h in-memory layer as-is. Do not touch `src/lib/cache.ts` or the cache cron.

4. Deploy: `npx convex dev` (or the project's self-hosted deploy flow) so the schema/functions exist before testing.

## Step 0.5 - Event retention (90 days)

Files: `convex/discovery.ts`, `convex/crons.ts`

Add a mutation `purgeOldEvents` in `convex/discovery.ts` that deletes `userEvents` docs with `timestamp < Date.now() - olderThanMs` in batches of ~500 (use the `by_timestamp` index, loop `first()` + delete until empty or batch cap). Register in `convex/crons.ts` next to the existing cleanup:

```ts
crons.daily("purge old discovery events", { hourUTC: 3, minuteUTC: 30 }, internal.discovery.purgeOldEvents, { olderThanMs: 90 * 24 * 60 * 60 * 1000 })
```

(If `internal.` refs are awkward with the string-ref pattern, export a public mutation and reference it as `api.discovery.purgeOldEvents` like the existing `api.cache.clearStaleCache`.)

## Step 0.6 - Neutral quality for low-vote items

File: `src/lib/discovery/ranking.ts`, `scoreItem`

Replace `const quality = Math.min(1, Math.max(0, input.voteAverage / 10))` with:

```ts
const quality = input.voteCount != null && input.voteCount < 50 ? 0.5 : Math.min(1, Math.max(0, input.voteAverage / 10))
```

Plumb `voteCount` through `ItemScoreInput` and the call site in `engine.ts` (`ScoredRowItem` in `rows.ts` already carries `voteAverage`; add `voteCount` from `item.vote_count` in `toScoredItem`).

## Step 0.7 - Retune the Tier-1 weights to spec

File: `src/lib/discovery/ranking.ts`

`ITEM_SCORE_WEIGHTS` becomes `{ similarity: 0.50, quality: 0.20, popularity: 0.15, recency: 0.15 }`. Remove the entire time-slot boost block (`peakViewingHour`/`nowHour` handling) from `scoreItem` and its input type; drop `peakViewingHour`/`nowHour` from the call site in `engine.ts`. (The learned peak-window idea was cut from v1; the histogram fields in `profile.ts` may stay, harmlessly unused.) Delete the corresponding test cases or rewrite them; `npm run test:discovery` must stay green.

**Phase 0 verification:**
- `npm run test:discovery`, `npm run lint`, `npm run build` all pass.
- `npx convex dev` deployed: `itemFeatures` exists; `discovery:getItemFeature`/`setItemFeature`/`purgeOldEvents` callable.
- Manual: watch >90% of something twice within the window and confirm a `rewatch` event with `weight: 0.8` lands in `userEvents`.
- Manual: write an item profile, wait for the next cache cleanup run (or run `cache.clearStaleCache` manually) and confirm `itemFeatures` content is untouched.

**Acceptance:** no formula in `src/lib/discovery/` may produce a weight outside [-1, 1]; no discovery data except ephemeral UI caches lives in `cacheStore`.

---

# Phase 1 - Signal coverage

**Goal:** all six v1 signals flow into `userEvents`. Today only playback + favorites are ingested; requests (the strongest proprietary signal) and watch-party context are missing; episode roll-up is partial.

## Step 1.1 - Request signal at +1.0

File: `src/lib/requests-store.ts` (exports `createRequest` around line 276)

After a successful request creation, fire-and-forget a discovery event (mirror the pattern used by `POST /api/my-list`):

```ts
void import("@/lib/discovery/ingest").then(({ ingestRequestCreated }) =>
  ingestRequestCreated({
    userId: payload.requestedByUserId,
    itemId: `${payload.mediaType}:${payload.tmdbId}`,
    tmdbId: payload.tmdbId,
    mediaType: payload.mediaType === "tv" ? "tv" : "movie",
    title: payload.title,
  })
).catch(() => { /* ingestion must never break requests */ })
```

Add `ingestRequestCreated` to `src/lib/discovery/ingest.ts` (copy `ingestFavoriteToggle`'s shape):

```ts
export async function ingestRequestCreated(params: {
  userId: string; profileId?: string; itemId: string; tmdbId?: number;
  mediaType?: "movie" | "tv"; title?: string;
}): Promise<void> {
  try {
    await logDiscoveryEvent({
      userId: params.userId, profileId: params.profileId ?? "default",
      itemId: params.itemId, tmdbId: params.tmdbId, mediaType: params.mediaType,
      title: params.title, eventType: "request", weight: 1.0, timestamp: Date.now(),
    })
    invalidateDiscoveryProfile(params.userId, params.profileId ?? "default")
  } catch (err) { console.error("[Discovery] Request ingestion failed:", err) }
}
```

Add `"request"` to the `DiscoveryEvent["eventType"]` union in `src/lib/discovery/store.ts`, to the schema comment in `convex/schema.ts`, and to `SIGNAL_EVENT_TYPES` in `src/lib/discovery/profile.ts`. (`SIGNAL_EVENT_TYPES` already contains `"rating"`; confirm `"request"` is added, not replacing it.)

## Step 1.2 - Watch-party context dampener

Files: `src/lib/jellyfin.ts` (`PlaybackReport` type), the player's progress posting code (find where `playback/progress` is POSTed: search `event: "stopped"` / `playback/progress` under `src/components/player/`), `src/app/api/jellyfin/playback/progress/route.ts`, `src/lib/discovery/ingest.ts`

1. Add optional `context?: string` to `PlaybackReport`. The player knows it is in a party from the URL (`/watch?party=...`); have it send `context: "party"` on every report when the query param is present.
2. In the progress route, pass `body.context` through to `ingestPlaybackStopped`.
3. In `ingest.ts`, extend `DiscoveryEvent` flow: when `context === "party"`, multiply the computed weight by `0.25` before logging (group viewing is not individual taste) and store `context: "party"` on the event (add optional `context: v.optional(v.string())` to the `userEvents` schema, the `logEvent` mutation args, and `DiscoveryEvent` type).

## Step 1.3 - Episode -> series roll-up

File: `src/lib/discovery/ingest.ts`, function `ingestPlaybackStopped`

Today `itemId` is the raw Jellyfin id and the profile attributes episode-level vectors via the episode's own TMDB id, which dilutes series taste. Fix: when `detail.Type === "Episode"`, use `detail.SeriesId` (Jellyfin) or, better, the series' TMDB id: fetch the parent series detail once (`getItemDetail(detail.SeriesId)`) and use its `ProviderIds.Tmdb` + its title for `tmdbId`, `mediaType: "tv"`, `title`, and set `itemId` to the **series** Jellyfin id. Cache the episode->series mapping in-process (`Map<string, string>`, no TTL needed beyond restarts) so back-to-back episode stops cost one lookup per series per process.

**Phase 1 verification:**
- `npm run test:discovery`, `npm run lint`, `npm run build` pass; add/adjust unit tests for the party dampener and request event type.
- Manual: create a request -> a `request` event with weight 1.0 appears in `userEvents`.
- Manual: stop playback mid-episode of a series -> event's `tmdbId`/`mediaType`/`title` are the SERIES, not the episode.
- Manual: an event recorded during a `?party=` session carries `context: "party"` and quartered magnitude.

**Acceptance:** all six event types (`play_complete`, `partial_play`, `abandonment`, `rewatch`, `favorite`, `unfavorite`, `request`) are producible from the running app.

---

# Phase 2 - Ranking alignment (Tier 1 + Tier 2 + freshness)

**Goal:** the ranking math matches v1 spec - no population bandit in the serve path, watched items hard-filtered, repetitions decayed, feed floor guaranteed.

## Step 2.1 - Remove UCB1 from the serve path

Files: `src/lib/discovery/ranking.ts`, `src/lib/discovery/engine.ts`

- Delete `ucb1`, `ucb1Boost`, and every reference to them (including `statsByKey` threading in `engine.ts`).
- `rowUtility(row, fatigue)` becomes `row.topItemScore * row.relevance * fatiguePenalty(fatigue?.unclickedImpressions ?? 0)`.
- **Keep** the schema table `rowImpressionStats` and the `recordRowImpression` writes from `/api/discovery/impression`. Rename it mentally to "rowEngagement": it is OFFLINE evaluation data only, never read at serve time.
- Update tests: remove `ucb1` imports/cases.

## Step 2.2 - Hard filter watched and interacted items

File: `src/lib/discovery/ranking.ts`, `src/lib/discovery/engine.ts`

- Remove the `isWatched`/`allowWatched` penalty logic from `scoreItem` (delete the `score -= 1.0` branch and the `allowWatched` input).
- In `engine.ts`: after computing `scored.sort(...)`, filter before slicing: keep items NOT in `profile.interactedKeys`. Exception: rows whose key starts with `byw:` may keep interacted-but-not-completed items (a favorite you have not finished should not be re-recommended, so prefer NOT special-casing unless BYW rows get too thin).
- Update tests that rely on the watched penalty.

## Step 2.3 - Cross-row dedupe within one feed

File: `src/lib/discovery/engine.ts`

Items must not repeat across rows of one feed. Maintain `const seenItems = new Set<string>()`; while building `renderedRows`, drop items already emitted by a higher-ranked row. Apply in final row order, not candidate order, i.e., during the `orderedKeys` walk: for each selected row, filter its 20 items through `seenItems`; if it falls below `MIN_ROW_ITEMS` afterwards, skip the row and add its key back nowhere. (Note: `rows.ts` `dedupeItems` only dedupes WITHIN a row.)

## Step 2.4 - Feed floor (minimum 6 rows or everything available)

File: `src/lib/discovery/engine.ts`

After the MMR ordering walk, if `ordered.length < Math.min(6, rankable.size)`: re-walk suppressed/skipped candidate rows in utility order, undo suppression, and append until floor is reached or candidates exhausted. Floor rule: never fewer than 6 personalized rows when candidates exist.

## Step 2.5 - Cross-surface serve memory + demotion

Files: `convex/schema.ts`, `convex/discovery.ts`, `src/lib/discovery/store.ts`, `src/lib/discovery/engine.ts`

1. Schema:

```ts
userServeLog: defineTable({
  userId: v.string(),
  profileId: v.string(),
  servesJson: v.string(),            // { [itemKey]: { count, lastServedAt } }, pruned > 7 days on write
  updatedAt: v.number(),
}).index("by_user_profile", ["userId", "profileId"]),
```

2. `convex/discovery.ts`: `getServeLog` (query by user/profile) and `recordServeLog` (mutation: upsert the single doc, merge the incoming batch of served item keys, prune entries older than 7 days).
3. `store.ts`: `getServeLog(userId, profileId)` and `recordServeLog(userId, profileId, itemKeys)` wrappers, fire-and-forget safe like the rest of the module.
4. `engine.ts`: load the serve log alongside `getRowFatigueMap`. For each item, `serves` = number of times served in the last 72h; multiply the Tier-1 score by `0.85^serves` AFTER `scoreItem`. Add `serveDemotion` helper in `ranking.ts` with a test.

**Phase 2 verification:** `npm run test:discovery`, `npm run lint`; unit tests demonstrate (a) no UCB1 symbols remain in the serve path, (b) a completed item never appears in any row, (c) no item id appears twice in a generated feed, (d) with 20+ suppressed rows the feed still returns the floor's worth of rows, (e) an item served twice in 72h scores 0.7225x.

---

# Phase 3 - Home page integration

**Goal:** `/` shows the personalized feed per user while keeping the ISR shell cached; beacons wired; no server-timezone bugs.

## Step 3.1 - PersonalizedFeed client component

New file: `src/components/discovery/PersonalizedFeed.tsx`

- `"use client"` component; SWR fetch of `/api/discovery/home?hour={new Date().getHours()}&mediaType=` (mediaType only when requested, e.g. from props).
- Renders each returned row with the existing `MovieRow` component: `<MovieRow title={row.title} subtitle={row.subtitle} type={row.type} customItems={row.items} rowKey={row.key} />` (rowKey added in Step 3.3).
- On error/empty: render nothing (the shell's static rows below cover the cold state).
- Add `hour` support in `src/app/api/discovery/home/route.ts`: parse `hour` param 0-23 and pass into `getPersonalizedFeed(userId, "default", { mediaType, clientHour })`; thread `clientHour` into `buildContextualRows` instead of `new Date().getHours()` (current code uses server timezone - bug when the VPS TZ differs from the viewer's).

## Step 3.2 - Home page surgery

File: `src/app/page.tsx`

- Delete the `generateRecommendations("default", ...)` block and the entire `becauseYouWatchedSeed` block (steps 4-5 in the current file). The ISR shell keeps: hero, Continue Watching (client), Trending Right Now, Something New, Critically Acclaimed, Global Hits, Recently Added, spotlights, and the rotated `DYNAMIC_CATEGORY_POOL` rows.
- Render `<PersonalizedFeed />` directly after `HeroBillboard` (inside the `max-w-[1600px]` container, before `ContinueWatchingSection`).
- `src/lib/recommendations.ts`: keep `toRowItem`, `dedupeByTmdbId`, `getTmdbRecommendations` (used by discovery rows); `generateRecommendations`/`getForYouRecommendations`/`getGenreRecommendations` become unused - remove them and their call sites ONLY if lint flags them as dead; otherwise mark deprecated with a comment. (Minimal churn.)

## Step 3.3 - MovieRow beacons

File: `src/components/MovieRow.tsx`

- Add optional prop `rowKey?: string`.
- Click beacon: in the card's click handler (or wrap `MovieCard`'s link), `void fetch("/api/discovery/impression", { method: "POST", body: JSON.stringify({ rowCategoryKey: rowKey, action: "click" }) })` when `rowKey` is set. Fire-and-forget; never block navigation.
- View/serve logging is server-side (Step 1 in Phase 2.5 covers the data; `GET /api/discovery/home` ALSO calls `recordServeLog(userId, "default", rows.flatMap(r => r.items.map(i => key)))` and `recordRowFatigueImpression` per served row key, batched into one promise and `void`-ed). No IntersectionObserver.

## Step 3.4 - In-memory feed cache

File: `src/lib/discovery/engine.ts`

Wrap `getPersonalizedFeed` with a per-user in-process cache: `Map<string, { rows, timestamp }>`, TTL 10 minutes, key `${userId}:${mediaType}:${clientHour<12?'am':'pm'}`. Invalidate on `invalidateDiscoveryProfile` (import the same key or export an `invalidateFeedCache(userId)` and call it from `invalidateDiscoveryProfile` in `profile.ts`). Rationale (also a documented delta): the spec proposed Convex-materialized feeds; an in-process cache is the valid equivalent here because deployment is a single PM2 process and profile memory cache is already 15 minutes.

## Step 3.5 - Late Night row via client hour

Already covered by 3.1 (`clientHour`). The existing `buildContextualRows` late-night block changes only its hour source. "Bite-Sized Stories" stays as-is (mean watch minutes is already computed).

**Phase 3 verification:**
- `npm run lint`, `npm run build` pass; `npm run test:discovery` green.
- Two different sessions on the same server see different home feeds above Continue Watching (use two browsers).
- Home ISR shell TTFB unchanged (`curl -w '%{time_total}' /` before/after, warm).
- Clicking a card in a personalized row issues the beacon (DevTools network tab) and `userRowFatigue` resets for that row key.
- Server set to a different timezone: "Late Night Thrillers" appears according to the BROWSER hour, not server hour.

---

# Phase 4 - All browse surfaces (fix repetition + shallow pools)

**Goal:** the "same ~40 posters everywhere" problem dies. Genre pages, `/movie`, `/tvshows` all get different, personally-ranked, de-duplicated content.

## Step 4.1 - Deeper candidate pools

File: `src/lib/discovery/rows.ts`

Every discover/trending call currently takes page 1 only (20 items). Add paging support:

```ts
async function safeDiscoverPages(mediaType: "movie" | "tv", params: Record<string, string>, pages = 3): Promise<CatalogLike[]> {
  const out: CatalogLike[] = []
  for (let page = 1; page <= pages; page++) {
    const data = mediaType === "movie"
      ? await discoverMovies({ ...params, page: String(page) })
      : await discoverTv({ ...params, page: String(page) })
    out.push(...toDisplayable((data?.results ?? []) as CatalogLike[]))
  }
  return out
}
```

Swap the hottest builders (`buildTopPicksRow`, `buildMicroGenreRows`, cold-start specs) to `safeDiscoverPages(..., 3)`. `ROW_ITEM_LIMIT` stays 20 - the extra depth exists for the ranking + dedupe + demotion to have real material to work with, not to grow rows.

Add an in-process candidate-pool cache in `rows.ts`: `Map<string, { items: ScoredRowItem[]; timestamp: number }>`, TTL 6h, keyed by mediaType + sorted params. This is the "shared candidate pool" from the spec, minus the Convex table (delta: in-process is fine on the single-process PM2 deployment).

## Step 4.2 - Facet row API for static pages

New file: `src/app/api/discovery/row/route.ts`

`GET /api/discovery/row?facet={facetKey}` - returns `{ results: RowItem[] }` shaped EXACTLY like the existing `/api/tmdb/discover/*` proxies so `MovieRow` consumes it unchanged. Implementation:

- Maintain a facet registry in `src/lib/discovery/rows.ts`: `FACET_REGISTRY: Record<string, { mediaType: "movie" | "tv"; params: Record<string, string> }>` mirroring every hardcoded endpoint used by `/movie` and `/tvshows` pages (e.g. `facet=popular-movies` -> trending; `facet=action-adventure` -> `with_genres=28,12`, etc.).
- Handler: session -> `getUserDiscoveryProfile`; fetch the facet's pool via the Step 4.1 cached pool; apply watched/interacted filter + `scoreItem` + serve-demotion + sort; return top 20. Fall back to pool order if Convex/profile fails.
- Add serve-log recording (same as home feed, Step 3.3) so cross-surface memory covers these pages too.

## Step 4.3 - Swap `/movie` and `/tvshows` endpoints

Files: `src/app/movie/page.tsx`, `src/app/tvshows/page.tsx`

Replace every static `endpoint="/api/tmdb/..."` with `endpoint="/api/discovery/row?facet=<key>"` per the registry. This removes the duplicated trending/popularity heads these pages currently share with the home shell ("Global Hits" etc.) - do not change copy or layout, only endpoints.

## Step 4.4 - Genre pages rewiring

File: `src/lib/genre-catalog.ts`

- Personalization profile: replace the legacy `profile.hasEnoughSignals`/`getGenreTopPicks(uid, ...)`/`getBecauseYouWatched(uid, ...)` sources with the discovery engine: `getUserDiscoveryProfile(userId)` for the profile and `buildSeedRows`-style seeds filtered by the current genre. Keep `getCachedRow` caching keys as-is; add the discovery profile's `eventCount` (or lastActiveTimestamp) to personalized cache keys so they rotate on fresh signals.
- Static rows (trending/acclaimed/new-recent/hidden-gems/decade): after row assembly, pass each row's items through a shared pipeline helper (new `src/lib/discovery/pipeline.ts`): `filterWatchedInteracted(items, profile)` -> `scoreItem` + serve-demote -> sort desc. The existing `pushRow` cross-row `seen`-set dedupe stays as the final pass.
- Reuse `affinityScore` from `engine.ts` only where a cheap [0,1] score is needed; otherwise use `scoreItem`.
- Parental ratings: when `session.maxParentalRating` is set, add `certification_country=US&certification.lte={rating}` to all MOVIE discover params (both facet registry and genre-catalog movie fetches). TV discover has no certification filter on TMDB - in that case exclude TV rows for restricted sessions until TV-side gating exists. `getGenrePageData` already receives `userId`; extend it to accept the session object.

**Phase 4 verification:**
- `npm run lint`, `npm run build`, `npm run test:discovery` pass.
- Manual: open `/`, then `/movie`, then `/genre/action` with the same user - verify (via UI + `userServeLog`) no poster repeats across the three pages in the top 20 of any row, and items you completed never appear.
- Manual: two users on `/genre/action` see different item order in "Trending in Action".
- Manual (TMDB budget): with pools cached, loading home twice within 6h issues zero duplicate discover calls (log or inspect the in-process cache).

---

# Phase 5 - Evaluation loop

**Goal:** evidence that this beats the static shell, and a tuning pass grounded in data.

## Steps

1. Offline stats are already accumulating via `/api/discovery/impression` into `rowImpressionStats` (impressions, clicks). Add `played`: call `recordRowImpression(rowCategoryKey, { played: true })` from the progress route's `start` event IF the playback was initiated from a personalized row - the player does not know the origin row, so pass the row key through the play URL when a card inside a personalized row is clicked (`/movie/[id]` -> `?fromRow=` propagation is OPTIONAL; skip if the plumbing fights you, impressions+CTR suffice).
2. After ~2 weeks of real household use, run a one-off inspection (a small node script or the Convex dashboard): CTR per row key; rows with K>=4 suppression frequency; distribution of event types.
3. Tune the constants (section "Constants" below) in one PR per change; re-run `npm run test:discovery`.
4. Write the decision log entry into `PERSONALIZATION.md` (append a Phase-4-notes section): what was kept, tuned, or rejected, with numbers.

**Acceptance:** a written, data-backed tuning decision exists for at least: `ITEM_SCORE_WEIGHTS`, `FATIGUE_DECAY`/`SUPPRESS_THRESHOLD`, `ALPHA_SHORT`.

---

# Constants (authoritative - change here and in code together)

| Constant | Value | Location |
|---|---|---|
| ITEM_SCORE_WEIGHTS | sim 0.50 / quality 0.20 / pop 0.15 / recency 0.15 | `ranking.ts` |
| ALPHA_SHORT | 0.6 | `vector.ts blendUserVectors` |
| Half-lives | 7 d / 90 d | `vector.ts` (existing) |
| Fast-adaptation | first 3 events x 3 | `profile.ts` (existing) |
| Re-watch weight / window | +0.80 / 30 d | `ingest.ts` |
| Partial play | 0.10 + 0.70*p, p in [0.10, 0.89] | `ingest.ts` |
| Abandonment | -0.40 (< 180 s and p <= 0.05) | `ingest.ts` (existing) |
| Favorite / Unfavorite / Request | +1.0 / -0.6 / +1.0 | `ingest.ts` |
| Party dampener | x 0.25 | `ingest.ts` |
| Fatigue decay / suppression | 0.75^K / K >= 4 for 7 d | `ranking.ts` (existing) |
| MMR mu | 0.7 | `ranking.ts` (existing) |
| Serve demotion | x 0.85 per serve within 72 h | `ranking.ts serveDemotion` |
| Neutral-quality threshold | vote_count < 50 -> quality 0.5 | `ranking.ts` |
| Feed floor / row size / max rows | 6 / 20 / 8 | `engine.ts` |
| Pool depth / pool cache TTL | 3 pages (<=60 items) / 6 h | `rows.ts` |
| Profile memory TTL / feed cache TTL | 15 min / 10 min | `profile.ts` / `engine.ts` |
| Event retention | 90 d | `convex/crons.ts` |
| Item-feature memory TTL | 6 h (in-process layer) | `store.ts` (existing) |

# Out of scope (do not build; reject if suggested)

- UCB1/multi-armed bandits in the serve path (removed in Phase 2; household-scale CTR is noise).
- Clustering-based micro-genre synthesis (K-medoids/agglomerative) and learned row titles.
- IntersectionObserver/viewport/dwell tracking; device-based rows.
- Multi-profile (`profileId` is always "default" - LEAVE the field; a real profile system does not exist yet).
- ANN/vector search infra; materialized `userFeeds` Convex tables (delta: in-process caches instead).

# Global guardrails

- `userId` always comes from `getSession()` server-side; the discovery API must never accept it as input.
- Timestamps are server receipt time; clamp completion into [0, 1]; clamp beacon bursts (the impression route should silently cap at ~1 write/s/user).
- Nothing personalized may live in `cacheStore` (the daily cron purges it) - item features live in `itemFeatures`, fatigue in `userRowFatigue`, serves in `userServeLog`.
- Every ingestion path is fire-and-forget: playback, favorites, and requests work identically with the discovery module down.
- Convex transaction limits (32k docs scanned, 16 MiB read, ~1 s user code): batch `purgeOldEvents`, cap `getRecentEvents` limit at 500, never `.collect()` an unbounded index range.
- If the discovery feed errors, surfaces fall back to today's static behavior - never render an empty page.

# Per-phase acceptance template

Before closing a phase, record in the PR/commit description: (1) files changed, (2) `npm run lint`/`build`/`test:discovery` output, (3) the manual checks listed in that phase with observed results, (4) any deviation from this plan and why. If a step fights the codebase for more than ~30 minutes, prefer the smaller delta and note the deviation rather than restructuring surrounding code.