# Implementation Plan — P0 R0-2: Central Quality-Floor Config & Recalibration

> Companion to [`catalog-audit.md`](./catalog-audit.md) (§1.2, §1.6; roadmap Phase P0, R0-2).
> Status: **implemented** · Estimated effort: ~1 focused day · Risk: low (config-only behavior change, graceful degradation built in)

---

## 1. Goal

Replace the ~46 scattered, mis-calibrated TMDB quality-floor literals (`vote_count.gte` 3–300,
`popularity.gte` 1.0–5.0) with **one typed, central config** (`src/lib/catalog-quality.ts`) whose
values match TMDB's actual metric scale, then migrate every call site to it.

**User-visible outcome:** daily soaps, telenovelas, talk shows, and barely-voted filler
(e.g. "Ulice" — 2.2★ / 10 votes / popularity 2518) stop appearing in every browsed and
personalized row. TMDB page-1 popularity sits at ~900–9300 (movies) / ~1300–2700 (TV);
a floor of 1.5 filters out essentially nothing. Raising floors to realistic values is the
single biggest lever against the #1 complaint ("catalog polluted with garbage").

**Non-goals (explicitly out of scope — covered by other roadmap items):**

| Adjacent fix | Roadmap item |
|---|---|
| Bayesian weighted rating replacing `voteCount<50 → 0.5` in `ranking.ts`; `isQualityContent` rewrite in `catalog.ts` | R0-3 |
| Adult/NSFW demotion, keyword denylist, TV `with_type=4` scripted-only bias | R0-4 |
| Empty-`with_genres` guard + `GENRE_DIM_TO_TMDB` corrections | R0-5 |
| Filter-once/over-fetch plumbing, legacy-engine fallback pipeline, per-user cache key | R0-6 |
| True `/tv/on_the_air` endpoint for the airing facet | R1-6 |
| Cold-start vector built from gated lists instead of raw trending (`profile.ts:447`) | R1-2 |

R0-2 attacks §1.6 *indirectly but immediately*: dailies/soaps flood TV discover because they
have huge day-rate popularity but very few votes — vote-count floors alone remove the bulk of
them, without waiting for R0-4's `with_type` work.

---

## 2. Design

### 2.1 New module: `src/lib/catalog-quality.ts`

Pure constants + helpers. **No server-only imports** (no `env.ts`, no `tmdb.ts`) so client
components (`SearchResults.tsx`) and server components can both import it safely.

```ts
/**
 * Central TMDB discover quality floors (audit R0-2).
 *
 * TMDB `popularity` is an unbounded, decaying engagement metric: official
 * /discover reference payloads show page-1 values of ~900–9300 (movies) and
 * ~1300–2700 (TV). Historical floors of 1.0–2.0 excluded almost nothing,
 * letting daily soaps / telenovelas (huge day-rate, tiny vote counts) dominate
 * every row. See docs/catalog-audit.md §1.2, §1.6, Appendix A.7.
 *
 * Lanes:
 *  - browse:  default popularity-sorted rails (genre hits, popular, micro-genre,
 *             top-picks pools, decade rows). Baseline bar.
 *  - curated: all-time-best rails sorted by rating (top-rated, acclaimed).
 *             Stricter: junk must be impossible here.
 *  - fresh:   "New & Recent" rails where freshness is the point. Low vote floor,
 *             NO popularity floor (brand-new titles haven't accrued attention),
 *             back-protected by a minimum rating instead.
 *  - niche:   rating-sorted narrow pools (keyword rows, hidden gems) where
 *             moderate obscurity is intentional; vote floor only.
 */

export type MediaKind = "movie" | "tv"

export type QualityLane = "browse" | "curated" | "fresh" | "niche"

export interface QualityFloor {
  voteCountGte: number
  /** null = do not emit a popularity floor for this lane */
  popularityGte: number | null
  /** optional rating backstop (used by the fresh lane) */
  voteAverageGte?: number
}

export const CATALOG_QUALITY_FLOORS: Record<QualityLane, Record<MediaKind, QualityFloor>> = {
  browse:  { movie: { voteCountGte: 75,  popularityGte: 3 }, tv: { voteCountGte: 30, popularityGte: 3 } },
  curated: { movie: { voteCountGte: 300, popularityGte: 8 }, tv: { voteCountGte: 150, popularityGte: 8 } },
  fresh:   { movie: { voteCountGte: 5,   popularityGte: null, voteAverageGte: 5.0 },
             tv:    { voteCountGte: 3,   popularityGte: null, voteAverageGte: 5.0 } },
  niche:   { movie: { voteCountGte: 50,  popularityGte: null }, tv: { voteCountGte: 25, popularityGte: null } },
}

/** Floor params for a lane, ready to spread into a discover params object. */
export function qualityFloorParams(lane: QualityLane, mediaType: MediaKind): Record<string, string>

/** Merge floors into `params` with max() semantics — never weakens an existing stricter floor. */
export function withQualityFloors(
  params: Record<string, string>,
  lane: QualityLane,
  mediaType: MediaKind
): Record<string, string>

/**
 * Defense-in-depth clamp for the /api/tmdb/discover proxy: raise-or-set
 * vote_count.gte / popularity.gte to the browse baseline. Client callers can
 * only ever be as strict as — never looser than — the browse bar.
 */
export function clampToBrowseMinimums(
  params: Record<string, string>,
  mediaType: MediaKind
): Record<string, string>
```

### 2.2 Lane assignment — every verified site

Values shown as `votes / popularity` ("—" = no floor emitted). ✅ = already compliant, migrated only for centralization.

#### `src/lib/discovery/rows.ts`

| Site (line) | Row | Lane | Movie before → after | TV before → after |
|---|---|---|---|---|
| L129–130 | Top-picks genre pool | browse | 20/1.5 → **75/3** | 10/1.5 → **30/3** |
| L137–138 | Top-picks TV genre pool | browse | — | 10/1.5 → **30/3** |
| L176–177 | Micro-genre rows | browse | 20/1.5 → **75/3** | 10/1.5 → **30/3** |
| L195–198 | Micro-genre **fallback** ⚠️ | browse | *none* → **75/3** | *none* → **30/3** |
| L234 | Keyword row | niche | 50/— → **50/—** ✅ | (movie-only today; use lane for future TV variant) |
| L314 | Late-night contextual | browse | 100/— → **75/3** | — |
| L332 | Bite-sized contextual | browse | 20/— → **75/3** | — |
| L371 | Cold-start "Acclaimed" | curated | 250/— → **300/8** | — |
| L378 | Cold-start "Action Hits" | browse | *none* → **75/3** | — |
| L441–443 | `safeTrending` (discover masquerading as trending) ⚠️ | browse | *none* → **75/3** | *none* → **30/3** |

⚠️ = pollution holes the audit missed but that are squarely within R0-2's remit:
the micro-genre fallback merges a **completely unfiltered** genre discover when a
decade-narrowed pool is small, and `safeTrending` feeds unfiltered popularity-sorted
discover into top-picks, cold-start, and "Trending" rows. Both get browse floors.

Facet registry (L470–544):

| Facet | Lane | Before → after |
|---|---|---|
| `recently-released-movies` | fresh | 5/2.0 → **5 votes + vote_average ≥ 5.0**, popularity floor dropped |
| `popular-movies` | browse | 50/5.0 → **75/3** |
| `top-rated-movies` | curated | 300/3.0 → **300/8** |
| `action-adventure-movies` | browse | 20/1.5 → **75/3** |
| `sci-fi-fantasy-movies` | browse | 20/1.5 → **75/3** |
| `comedy-movies` | browse | 20/1.5 → **75/3** |
| `horror-thriller-movies` | browse | 20/1.5 → **75/3** |
| `on-the-air-shows` | browse | 10/2.0 → **30/3** (true endpoint fix deferred to R1-6) |
| `popular-shows` | browse | 30/5.0 → **30/3** ✅ votes |
| `top-rated-shows` | curated | 150/3.0 → **150/8** ✅ votes |
| `sci-fi-fantasy-shows` | browse | 10/1.5 → **30/3** |
| `crime-mystery-shows` | browse | 10/1.5 → **30/3** |
| `comedy-shows` | browse | 10/1.5 → **30/3** |
| `animation-shows` | browse | 10/1.5 → **30/3** |

#### `src/lib/recommendations.ts` (legacy engine, L187–202)

| Site | Lane | Movie | TV |
|---|---|---|---|
| `getGenreBasedRecommendations` | browse | 15/1.0 → **75/3** | 10/1.0 → **30/3** |

#### `src/lib/genre-catalog.ts` (template objects, L396–473)

| Row | Lane | Before (movie/tv, pop) → after |
|---|---|---|
| trending | browse | 50/30 @ 5.0 → **75/30 @ 3** |
| world-leading (anime) | browse | 100/50 @ 5.0 → **75/30 @ 3** (see Risk 3) |
| acclaimed | curated | 300/150 @ 3.0 → **300/150 @ 8** |
| new-recent | fresh | 5/3 @ 2.0 → **5/3 + vote_average ≥ 5.0**, popularity dropped |
| hidden-gems | niche | 30/15 @ 1.5 → **50/25**, popularity dropped |
| decade rows | browse | 20/10 @ 1.5 → **75/30 @ 3** |

Implementation note: `DiscoverTemplate.voteCountGte` / `popularityGte` stay as-is;
call sites pass values pulled from `CATALOG_QUALITY_FLOORS` instead of inline numbers.
The `fresh` lane's `voteAverageGte` needs a new optional `voteAverageGte?: number` field
on `DiscoverTemplate` + emission in `buildDiscoverParams` (L69–106).

#### Pages (server components building `/api/tmdb/discover` query strings)

| Site | Row | Lane | Before → after |
|---|---|---|---|
| `src/app/page.tsx` L213 | "Something New To You" | fresh | 5/2.0 → **5 + avg ≥ 5.0**, pop dropped |
| `src/app/page.tsx` L221 | "Critically Acclaimed" | curated | 300/3.0 → **300/8** |
| `src/app/movies/page.tsx` L172–173 | Popular Genre Movies | browse | 20/1.5 → **75/3** |
| `src/app/movies/page.tsx` L186–187 | Top Rated Genre Movies | curated | 300/3.0 → **300/8** |
| `src/app/movies/page.tsx` L203–204 | New & Recent Genre | fresh | 5/2.0 → **5 + avg ≥ 5.0**, pop dropped |
| `src/app/tvshows/page.tsx` L219–220 | Popular Genre Series | browse | 10/1.5 → **30/3** |
| `src/app/tvshows/page.tsx` L232–233 | Top Rated Genre Series | curated | 150/3.0 → **150/8** |
| `src/app/tvshows/page.tsx` L248–249 | New & Recently Airing | fresh | 3/2.0 → **3 + avg ≥ 5.0**, pop dropped |

#### `src/components/SearchResults.tsx` (client, genre-filtered fallback L274–276)

| Site | Lane | Before → after |
|---|---|---|
| movie URL | browse | 20/1.5 → **75/3** |
| tv URL | browse | 10/1.5 → **30/3** |

---

## 3. Implementation Steps

### Step 1 — Create `src/lib/catalog-quality.ts`
New file exactly as designed in §2.1 (~90 lines incl. JSDoc). Helpers implement max()
semantics: parse existing `vote_count.gte` / `popularity.gte` / `vote_average.gte`,
emit `String(Math.max(existing ?? 0, floor))`; skip emitting when the lane floor is `null`.
No new env vars → no README/env-sample changes required (per AGENTS.md).

### Step 2 — Migrate `src/lib/discovery/rows.ts`
1. Import `withQualityFloors`, `qualityFloorParams`, `clampToBrowseMinimums` (name TBD) from `../catalog-quality`.
2. `buildTopPicksRow` (L126–140): wrap both genre-pool param objects with `withQualityFloors(..., "browse", mediaType)`.
3. `buildMicroGenreRows` (L174–179): wrap `baseParams` with browse floors; **and the fallback at L195–198** — add the same browse floors (this is the unfiltered-hole fix).
4. `buildKeywordRow` (L232–237): `withQualityFloors(..., "niche", mediaType)` (keeps 50 for movie, adds 25 for a future TV variant).
5. `buildContextualRows` (L311–315, L329–333): browse floors on both discovers.
6. `buildColdStartRows` (L371, L378): curated for acclaimed, browse for action.
7. `safeTrending` (L441–443): apply browse floors to the discover params (leave a TODO pointing at R1-6 for the real `/trending` swap).
8. `FACET_REGISTRY` (L470–544): replace every literal with `qualityFloorParams(...)` spreads, e.g.
   ```ts
   "popular-movies": {
     mediaType: "movie",
     params: {
       sort_by: "popularity.desc",
       "with_runtime.gte": "20",
       ...qualityFloorParams("browse", "movie"),
     },
     title: "Popular Movies",
   },
   ```
   `recently-released-movies` uses `qualityFloorParams("fresh", "movie")` (emits vote floor + rating backstop, no popularity floor).

### Step 3 — Migrate `src/lib/recommendations.ts`
`getGenreBasedRecommendations` (L187–202): replace the four literals with `withQualityFloors({...}, "browse", mediaType)`.

### Step 4 — Migrate `src/lib/genre-catalog.ts`
1. Add optional `voteAverageGte?: number` to `DiscoverTemplate` (L60–67) and emit `vote_average.gte` in `buildDiscoverParams` (after L92).
2. Replace the six template literals (L399–400, 408, 417–418, 427–428, 443–444, 463–464) with values read from `CATALOG_QUALITY_FLOORS[...]`:
   ```ts
   const BROWSE_M = CATALOG_QUALITY_FLOORS.browse.movie
   // ...
   voteCountGte: { movie: BROWSE_M.voteCountGte, tv: CATALOG_QUALITY_FLOORS.browse.tv.voteCountGte },
   popularityGte: BROWSE_M.popularityGte!,
   ```
   (small local aliases keep the template objects readable).

### Step 5 — Migrate pages + `SearchResults.tsx`
All five files import the config and interpolate values into their query strings, e.g. `page.tsx` L213:
```ts
const FRESH = qualityFloorParams("fresh", "movie")
endpoint={`/api/tmdb/discover/movie?sort_by=primary_release_date.desc&primary_release_date.lte=${thirtyDaysAgo}&${new URLSearchParams(FRESH)}&with_runtime.gte=20`}
```
Same pattern for `movies/page.tsx` (browse/curated/fresh), `tvshows/page.tsx` (browse/curated/fresh-tv), `SearchResults.tsx` (browse, both media types).

### Step 6 — Defense-in-depth clamp in `src/app/api/tmdb/[...slug]/route.ts`
After the search-param copy loop (L38–40), when `slug[0] === "discover"`:
```ts
if (slug[0] === "discover") {
  const mediaType = slug[1] === "tv" ? "tv" : "movie"
  for (const [k, v] of Object.entries(clampToBrowseMinimums(Object.fromEntries(search), mediaType))) {
    search.set(k, v)
  }
}
```
Raise-or-set semantics guarantee no client path can serve sub-baseline discover content
even if a future call site forgets the floors. Internal server callers use `tmdbFetch`
directly and are unaffected.

### Step 7 — Unit tests: `src/lib/__tests__/catalog-quality.test.ts`
Node:test style matching `validation.test.ts` conventions (picked up by `npm run test:lib`):
1. Each lane/media returns the exact documented params (pins the calibration; any retune is a deliberate diff).
2. `withQualityFloors` never weakens stricter pre-existing floors (max semantics), preserves unrelated keys, and does not emit `popularity.gte` for `null` lanes.
3. `fresh` lane emits `vote_average.gte` backstop.
4. `clampToBrowseMinimums`: raises lower values, keeps stricter ones, sets missing ones.
5. Regression pin for the two closed holes: `withQualityFloors({}, "browse", "tv").vote_count >= 30` (micro-genre fallback / safeTrending shape).

### Step 8 — Docs
Add a short subsection to `docs/catalog_architecture.md` ("Quality floors" — one paragraph
pointing at `catalog-quality.ts` as the single source of truth and the lane taxonomy).
Mark R0-2 done in the audit's roadmap table (optional, reviewer's choice).

---

## 4. Verification Checklist

```bash
npx tsc --noEmit            # clean
npm run lint                # zero warnings
npm run test:lib            # new catalog-quality tests pass
npm run test:discovery      # existing discovery suite still green
npm run test:e2e -- e2e/home.spec.ts
npm run test:e2e -- e2e/catalog.spec.ts
npm run test:e2e -- e2e/search.spec.ts
npm run dev                 # manual smoke (below)
```

Manual smoke (dev server, logged in):
- **Home**: "Something New To You" still fills (~20 cards); "Critically Acclaimed" unchanged quality, no new junk.
- **/movies + /tvshows**: pick 2–3 genre pills; each of the 3 genre-mode rows renders ≥ 5 cards; no daily-soap-looking entries.
- **/search?filter=<genre>**: grid populated (SearchResults fallback path).
- Spot-check one previously-polluted TV row (e.g. "Currently Airing"): entries should all have visible vote counts well above 30.

Static hygiene gate (can be CI-able later):
```bash
grep -rn "vote_count\.gte\|popularity\.gte\|vote_average\.gte" src --include="*.ts" --include="*.tsx"
# Expected remaining hits ONLY: catalog-quality.ts, the proxy clamp, genre-catalog.ts
# template plumbing (reading from config), and tests.
```

---

## 5. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| 1 | Pools shrink below `MIN_ROW_ITEMS = 5` → rows silently skipped (empty shelf) | Low–Med | Pools already over-fetch 2–3 pages (40–60 items pre-filter); browse floors still leave hundreds of titles per mainstream genre. Watch `[Discovery]` console warnings during smoke test. Engine feed-floor and genre-page `pushRow` degrade gracefully. |
| 2 | Anime / world-cinema depth loss (international titles accrue votes slower) | Med | `world-leading` moves 100→75 (movie) — mild. All knobs live in ONE file; retuning is a one-line diff. If K-drama/anime rows look thin, add a `with_original_language` carve-out in R1-3 rather than weakening global floors. |
| 3 | "Bite-Sized Stories" (runtime ≤ 35 **and** vc ≥ 75 **and** pop ≥ 3) may get sparse | Med | Accepted short-term; row self-skips below 5 items. If persistent, move to `niche` lane (vote floor only) — one-word change. |
| 4 | Fresh rows lose ultra-fresh obscure releases | Accepted | Deliberate audit policy: freshness lanes keep a low vote floor but must clear a 5.0★ rating backstop — filters junk launches, keeps legitimate new titles. |
| 5 | Cache invalidation blip after deploy | Certain, harmless | Pool cache keys embed params → new keys automatically; 6h TTL self-heals. Proxy responses carry 5-min cache headers. Expect one cold-cache page load. |
| 6 | Proxy clamp surprises a future client caller wanting raw discover | Low | Raise-or-set only affects `discover/*`; behavior documented in code comment + architecture doc. Any legitimate raw-discover need should go through a server route anyway. |
| 7 | `on-the-air-shows` still isn't the real airing list | Known | Vote floor 10→30 removes most dailies today; true `/tv/on_the_air` swap remains R1-6. Title/promise mismatch persists until then (§3.5). |

**Rollback:** revert the single commit; or hot-tune by editing `CATALOG_QUALITY_FLOORS` alone
(all consumers read from it). No schema, env, or data migrations involved.

---

## 6. Definition of Done

- [ ] `src/lib/catalog-quality.ts` exists with lane taxonomy, floors, and 3 helpers (JSDoc cites audit §1.2/§1.6/App A.7)
- [ ] Zero inline floor literals remain outside the config/clamp/tests (grep gate passes)
- [ ] Micro-genre fallback (`rows.ts:195`) and `safeTrending` (`rows.ts:441`) no longer issue unfiltered discovers
- [ ] Fresh lanes emit `vote_average.gte` backstop and no popularity floor
- [ ] Discover proxy clamps to browse minimums
- [ ] Unit tests green (`npm run test:lib`), discovery suite green, lint + tsc clean
- [ ] Home / movies / tvshows / search smoke-tested with visibly cleaner rows
- [ ] `catalog_architecture.md` documents the config as single source of truth
