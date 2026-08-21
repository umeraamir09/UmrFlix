# UmrFlix — Catalog & Recommendation System Audit

> Full audit of the catalog / discovery / personalization stack: every verified flaw,
> bug, and gap, with file/line references, why each matters, and what to fix.
> Companion to [`catalog_architecture.md`](../catalog_architecture.md).
>
> Audit date: 2026-08-19 · Scope: `src/lib/discovery/**`, `src/lib/{catalog,recommendations,genre-catalog,genre-profile,horizontal-posters,genres,tmdb}.ts`,
> `src/app/api/{discovery,recommendations,tmdb}/**`, catalog pages & feed components, `convex/**`.
> External research: official TMDB API v3 reference (verified 2026-08-19).

---

## 0. Executive Summary

The system is architecturally interesting (dual-decay 64-D taste vectors, two-tier ranking,
fatigue suppression) but is undermined by **broken feedback loops, near-absent quality
floors, and hard caps that strangle content volume**. The three user-facing complaints map
directly to verified root causes:

| Complaint | Primary root causes (verified in code) |
|---|---|
| Catalog polluted with low-quality / explicit content | Quality floors set 10–100× below TMDB scale (§1.2); zero explicit-content handling (§1.1); empty-`with_genres` bug returning *unfiltered* popular TV/movies in personalized rows (§1.5); TV discover pools dominated by obscure dailies/soaps (§1.6); quality scoring gives sub-50-vote items a free 0.5 pass (§1.3) |
| Too little content, too few rows, 2-second scroll | Hard 20-item cap with no pagination anywhere (§2.1); feed capped at 8 rows with only ~6 builders (§2.2); 14 static facets total (§2.3); cold-start TV feed renders **2 rows** (§2.4); genre-page global dedupe starves later rows (§2.5) |
| Personalized content has low variety | All personalized row builders are movie-only by default (§3.1); only 2 seeds, 1 keyword, 2 contextual rows ever generated (§3.2–3.4); candidate vectors are sparse → personalization mostly decorative (§4.1); click feedback loop is permanently broken so the system never learns from engagement (§5.1) |

Plus one severe correctness bug: **the click beacon contract is broken app-wide**, so click
stats, UCB1, and fatigue reset have never fired for any user (§5.1).

Content policy note: per product decision, the fixes below implement **quality/explicit
demotion (down-rank first, hide only spam-grade items)** rather than hard global blocking.

Severity legend: **P0** = user-visible breakage or garbage content today · **P1** = major
quality/variety/UX deficit · **P2** = hardening, scale-out opportunities.

---

## 1. Content Pollution & Quality Findings

### 1.1 P0 — Zero explicit / NSFW / adult-content handling anywhere

- **Location:** whole stack — `src/lib/tmdb.ts:180-186` (`discoverMovies`/`discoverTv` pass-through), `src/lib/tmdb.ts:24-50` (`TmdbMovie`/`TmdbTvShow` types **omit the `adult` field entirely**), `src/lib/catalog.ts:179-326` (no adult/certification checks), `src/lib/genre-catalog.ts:104-107` (a `maxParentalRating` template option exists but **no row spec uses it**). Grep for `adult`/`include_adult`/`certification` across `src/` returns only the unused template line.
- **Problem:** TMDB's `/discover` defaults `include_adult=false`, but `/trending/*` and `/{type}/{id}/recommendations` accept **no such parameter** — and more importantly TMDB's `adult` flag only covers actual adult films. The real-world pollutant class ("erotic thriller", soft-explicit mainstream titles, NC-17/TV-MA-style content) flows freely through trending, recommendations, genre discovers, and cold-start pools. The repo never reads `release_dates`/`content_ratings`, never uses `certification_country` + `certification.lte`, and has no keyword/title-based denylist.
- **Why it matters:** This is the user's #1 complaint. Every ranked row — home, movies, TV, genre pages, search-adjacent surfaces — can surface explicit content because there is not a single check or demotion rule anywhere in the pipeline.
- **Fix / improvement:** Add a content-suitability layer in `src/lib/catalog.ts` (see roadmap R0-4): (a) add `adult` to TMDB types and demote `adult:true` items to near-zero in browse/recommendation scores (they remain findable via search, per the down-rank policy); (b) fetch age ratings cheaply — `certification_country=US` + `certification` detail calls are cacheable per-item in Convex `itemFeatures`; (c) maintain a config file (`src/lib/content-policy.ts`) of demoted TMDB keyword IDs/names (`erotic`, `softcore`, `sexploitation`, …) matched against cached item keywords (already resolved in `profile.ts:107-108` `detailToItemProfile`); (d) per-profile maturity ceiling eventually (§7.9). Expected result: explicit titles vanish from browsed rows and personalized feeds without breaking search discoverability.

### 1.2 P0 — Quality floors are 10–100× below TMDB's actual scale

- **Location:** `src/lib/discovery/rows.ts:128-139` (`"vote_count.gte": "20"`, `"popularity.gte": "1.5"` top-picks), `rows.ts:174-179` (micro-genre: 20/10 votes, popularity ≥ 1.5), `rows.ts:472-544` (facet registry: mostly `vote_count.gte` 5–50, `popularity.gte` 1.5–5.0), `src/app/page.tsx:211-213` (home static rows: `vote_count.gte=5`, `popularity.gte=2.0`), `src/lib/recommendations.ts:188-202` (`vote_count.gte` 10–15, `popularity.gte` 1.0), `src/lib/catalog.ts:286-297` (final gate: vote_count < 10 AND popularity < 1.0).
- **Problem:** TMDB `popularity` is a relative, continuously-decayed engagement metric. In the official `/discover` reference responses, *page-1* items sit at ~900–9300 (movies) and ~1300–2700 (TV). A floor of **1.5 filters out essentially nothing** — and `vote_count.gte=10` lets through TV items with 10 votes and a 2.2 rating. Verified from TMDB's own example payload for unfiltered `/discover/tv`: page 1 is dominated by obscure international daily soaps ("Ulice", 2.2★/10 votes, popularity 2518; "Al rojo vivo", 1.5★/4 votes, popularity 2216). Those exact titles pass every floor in this codebase.
- **Why it matters:** TMDB popularity measures *transient attention*, not quality — daily soaps and regional dailies have enormous day-rates from their home markets. With floors at 1.5–2.0 popularity and 5–20 votes, the "quality gate" is decorative; the pollution the user sees is the *expected output* of these parameters.
- **Fix / improvement:** Re-calibrate floors to TMDB reality and make them **sort-aware** (roadmap R0-2): e.g. movie browse rows `vote_count.gte ≥ 75–300` and `popularity.gte ≥ 3–8`; TV rows `vote_count.gte ≥ 30–150`, `popularity.gte ≥ 3–8`; keep low-floor lanes only for "New & Recent" rails where freshness is the point and back-protect with `vote_average.gte`. Centralize all floors in one typed config (`CATALOG_QUALITY_FLOORS`) instead of 30+ inline literals. Expected result: immediate, dramatic removal of soap/daily/spam content from every row.

### 1.3 P0 — Ranking's quality term gives thin-voted items a free pass

- **Location:** `src/lib/discovery/ranking.ts:44-47`:
  ```ts
  const quality =
    input.voteCount != null && input.voteCount < 50
      ? 0.5
      : Math.min(1, Math.max(0, input.voteAverage / 10))
  ```
- **Problem:** Any item with fewer than 50 votes is assigned quality 0.5 — *better than a 5.0-rated blockbuster*. Since most polluted pools are full of 5–49-vote items (see §1.2), the ranker actively scores junk at half-max quality while a genuinely bad title never scores below what a mediocre-good one gets.
- **Why it matters:** Even if a garbage item enters a pool, ranking should bury it; instead the formula guarantees it mid-pack placement before similarity/popularity terms — and the popularity term is ln-normalized *within the pool* (`ranking.ts:39-42`), so in a pool full of junk, junk is the anchor.
- **Fix / improvement:** Use a **Bayesian weighted rating** (the IMDb Top-250 formula) instead of raw average: `WR = (v/(v+m))·R + (m/(v+m))·C` with `C ≈ 6.8` (TMDB corpus mean), `m ≈ 300` for movies / `m ≈ 100` for TV (roadmap R0-3). Thin-voted items regress toward the corpus mean instead of being gifted 0.5; truly-bad items score ~0.3–0.5. Expected result: ranking stops rewarding obscurity.

### 1.4 P1 — `isQualityContent` thresholds are weak and exploitable

- **Location:** `src/lib/catalog.ts:234-300`.
  - L244-249: low-rating removal only when `vote_count >= 5 && vote_average < 3.5` — a 2.0★ title with 4 votes passes.
  - L263-266: when `vote_count`/`popularity` are absent from the row payload, items pass unconditionally (deliberate, but it means `RowItem`-shaped data gets no quality screening at all).
  - L279-292: the 30-day new-release window passes anything with `popularity >= 1.5` OR `voteCount >= 1` — i.e. *any* new release with a single vote is "quality".
- **Problem:** The universal last-line filter does not catch the classes of content users call "garbage": low-engagement dailies, 4-vote flops, promo clips with >15min runtimes, foreign dailies with no English metadata (those pass `isQualityContent` but get dropped by the overview requirement elsewhere — inconsistent).
- **Fix / improvement:** Replace the piecemeal floor with the same Bayesian quality score from §1.3 plus an engagement floor scaled to content type (movies vs TV vs daily formats). Demote (don't delete) sub-threshold items from ranked rows so search stays complete. Also unify: one `qualityScore(item)` used by filter, ranking, and facets instead of 3 different heuristics.

### 1.5 P0 — Personalized rows silently fetch *unfiltered popular content* for TV-dominant users (empty `with_genres`)

- **Location:** `src/lib/discovery/vector.ts:263-284` (`GENRE_DIM_TO_TMDB`) has **no TV mapping** for dim 10 History (`tv: []`), 11 Horror (`tv: []`), 12 Music (`tv: []`), 14 Romance (`tv: []`), 19 Reality & Talk (`movie: []`); dim 16 Thriller is mis-mapped to `tv: [80]` (Crime). Consumers:
  - `rows.ts:128` & `rows.ts:136` (`buildTopPicksRow`): ``GENRE_DIM_TO_TMDB[...]?.movie.join(",") ?? ""`` and same for TV — an empty array joins to `""`.
  - `rows.ts:187` (`buildMicroGenreRows`): `(targetType === "tv" ? ids.tv : ids.movie).join(",")` — no guard.
  - `rows.ts:197` (micro-genre fallback): same.
- **Problem:** `tmdbFetch` (`tmdb.ts:4-21`) blindly sets every param, so `with_genres=""` reaches TMDB, which ignores empty filters. Result: a TV user whose dominant taste dim is Horror/Romance/History gets personalized rows titled *"Pulse-Pounding Horror — Fresh Releases"* whose contents are **generic unfiltered popular TV** — the soap/daily garbage from §1.2 — wearing a personalization label. The movie reality-TV (dim 19) case does the same on the movie side.
- **Why it matters:** This is a direct, high-volume pollution path *inside the personalized engine itself* and destroys trust ("the app recommends random junk labelled as my taste").
- **Fix / improvement:** (a) Skip a row when the mapped ID list is empty rather than issuing an empty filter (`rows.ts:126-140, 187, 197`); (b) correct `GENRE_DIM_TO_TMDB`: History → TV `[10768? no — use 18|36 absent]` reality-check each dim (Thriller TV has no direct id — use keyword-based fallback or Crime+Mystery `80|9648` with pipe OR semantics, documented); (c) add pipe-OR support where rows are conceptually "A or B" (TMDB: comma = AND, pipe = OR — verified official docs). Expected result: every titled row actually matches its promise.

### 1.6 P0 — TV pools are structurally dominated by dailies/soaps; "on-the-air" facet misuses discover

- **Location:** `src/lib/discovery/rows.ts:509-513` — facet `on-the-air-shows` is implemented as `/discover/tv` with `{ sort_by: "popularity.desc", "vote_count.gte": "10", "popularity.gte": "2.0" }`; it never calls `/tv/on_the_air`. Same pattern for `popular-shows` (`rows.ts:514-517`).
- **Problem:** Verified against TMDB's official `/discover/tv` reference payload: unfiltered-by-type discover results are overwhelmingly daily soaps/telenovelas/talk shows ("Dirty Linen", "Aashiqana", "Ulice", "Bhagya Lakshmi"…) — high day-rate popularity, near-zero votes. The facet's 10-vote / 2.0-popularity floor passes them all. TV discover offers purpose-built filters this codebase never uses: `with_type` (0 Documentary, 1 News, 2 Miniseries, 3 Reality, 4 Scripted, 5 Talk Show, 6 Video), `with_status` (0 Returning, 3 Ended…), `with_networks`, `air_date.*` vs `first_air_date.*`, `screened_theatrically`, `include_null_first_air_dates`. Meanwhile dim 19 of the taste vector (vector.ts:56-59) folds Reality+Talk+News+Soap into one dimension, and the **cold-start vector** (`profile.ts:447-462`) averages unfiltered trending TV — so even default vectors drift toward daily formats.
- **Why it matters:** The TV side of *every* surface — personalized or not — is polluted by construction, not by bad luck.
- **Fix / improvement:** `/tv/on_the_air` (and `/tv/airing_today`) for the airing facet (roadmap R1-6); add `with_type=4` (Scripted) or exclusion of `with_type` 0/1/5/6 to general TV rows (dailies get their own opt-in row, surfaced only when the user's vector actually favors dim 19); never feed raw trending into the cold-start vector without type/vote gating.

### 1.7 P1 — Trending feeds enter with no quality gating at the source

- **Location:** `src/app/page.tsx:80-85, 197-203, 225-230` (home hero + "Trending Right Now" + "Global Hits"), `src/components/MovieRow.tsx:42` (default endpoint `/api/tmdb/trending/{type}/week`), `src/lib/recommendations.ts:143-174` (trending contribute to legacy recs), `src/lib/discovery/profile.ts:447` (cold-start vector). `/trending/*` has **no** `include_adult`, vote, or type parameters at TMDB — verified.
- **Problem:** Trending is the single most-reused pool in the app (hero, cold-start, static home rows, legacy recs, cold rows, login art) and the only thing between raw TMDB trending and the user is the downstream `filterDisplayableContent`, whose quality check is §1.4-weak. Hype-driven low-rated releases and explicit-adjacent titles trend hard.
- **Fix / improvement:** Introduce one shared `curateTrending(items)` post-filter (Bayesian quality + suitability demotion from §1.1/§1.3) applied wherever trending results are used; hero candidates (page.tsx:137-138) should require both backdrop quality and minimum rating before rotation.

### 1.8 P1 — Double filtering shrinks rows unpredictably

- **Location:** server-side `rows.ts:71-73` applies `filterDisplayableContent(filterReleasedContent(...))` to pooled items; then the client re-applies `filterDisplayableContent` in `MovieRow.tsx:50-53`.
- **Problem:** Rows are built to ≥5 / ≤20 items *before* the client strips posters/overviews/cinema-window items — the UI can end up showing 2–3 cards in a row the server thought had 20. Filtering is also inconsistent: facet rows are filtered twice, `/api/tmdb/*` endpoint rows only client-side, genre rows server-side only (via `toRowItems`, `genre-catalog.ts:111-120`).
- **Fix / improvement:** Filter exactly once, server-side, and **over-fetch to compensate** (pool 40–60 candidates → deliver 20 post-filter items); client `MovieRow` should trust the payload (roadmap R0-5). Expected result: rows are predictably full (20 visible cards), fixing the "2-second scroll" complaint.

### 1.9 P2 — English-overview requirement silently deletes international catalog

- **Location:** `src/lib/catalog.ts:314` (`if (!item.overview) return false`); `tmdbFetch` hard-sets `language=en-US` (`tmdb.ts:6`), so this effectively means "English overview only".
- **Problem:** Quality international content (anime/K-drama/Bollywood) frequently lacks an English overview on list endpoints and is dropped, narrowing catalog breadth and biasing everything Western — at odds with variety goals.
- **Fix / improvement:** Per the down-rank (not delete) policy: demote overview-less items in browse scores rather than dropping; consider `append_to_response`-style localized fetch or `with_original_language` rows ("K-Dramas", "Anime", "Bollywood") where the lack of an English blurb is accepted. Also shortens the §1.8 double-filter mismatch.

### 1.10 P1 — Legacy engine fallback returns unfiltered trending

- **Location:** `src/lib/recommendations.ts:349-355` — on error, `generateRecommendations` returns raw `getTrendingItems(...)` with **no** `filterDisplayableContent` (applied only on the success path at L338).
- **Problem:** When Jellyfin/TMDB hiccup, users get the *least* curated possible response: unreleased, announced, poster-less, low-quality items straight from trending.
- **Fix / improvement:** Always run the fallback through the same displayability pipeline (roadmap R0-6).

### 1.11 P2 — `hasValidReleaseDate` rejects date-less TV; `isOnlyInCinemas` overlaps ISR hero logic

- **Location:** `src/lib/catalog.ts:113-121`, 56-108.
- **Problem:** Items with empty release dates are dropped (strict, fine) but TMDB returns many legit returning TV series with empty `first_air_date` in list payloads only in edge tooling; more importantly the cinema-window logic is re-checked client- and server-side in three different ways (`isOnlyInCinemas`, `includeCinemas` flag in `genre-catalog.ts:455-470, 471-483`, proxy rows), producing inconsistent row membership across pages.
- **Fix / improvement:** Consolidate release-window policy into the single quality/suitability module (§1.1 fix) with explicit per-row opt-in (e.g., "In Theaters Now" row intentionally includes the window).

---

## 2. Content Quantity & Variety Findings

### 2.1 P0 — No pagination, infinite scroll, or "load more" anywhere in the app

- **Location:** every surface — `src/app/page.tsx` (rows are single-endpoint page-1 SWR fetches, `MovieRow.tsx:45-48`), `src/app/api/discovery/row/route.ts:66-67` (`.slice(0, 20)`), `src/lib/discovery/rows.ts:38` (`ROW_ITEM_LIMIT = 20`) and `rows.ts:460` (`dedupeItems` caps at 20), engine `engine.ts:140, 204` (`slice(0, 20)`), `genre-catalog.ts:57, 147`.
- **Problem:** TMDB returns ≈760k movies / ≈148k TV shows (official reference `total_results`); the app ever shows 20 per row, once. `safeDiscoverPages` (`rows.ts:408-439`) already fetches 2–3 pages (40–60 items) and then `dedupeItems` throws away everything past 20 — wasted upstream calls, still no depth. There is no `/api/discovery/row?cursor=` continuation and `MovieRow` has no end-of-row event to trigger one.
- **Why it matters:** Directly causes the "scroll for 2 seconds and it's over" complaint: after ~20 cards the row simply ends; after ~8 rows the page ends.
- **Fix / improvement:** (roadmap R1-1) Row-level pagination: extend `/api/discovery/row` with `?cursor=<page>` (pool cache already keys by params — append page), let `MovieRow` fetch the next page when scrolled to 80% (IntersectionObserver sentinel), SWR-infinite for genre/search grids. Server: stop slicing pools to 20 — keep 40–60 and serve progressively. Expected result: infinite-feeling Netflix-style rows with bounded TMDB cost (each next page is one cached pool fetch).

### 2.2 P0 — Personalized feed is structurally capped at ~8 max possible rows; only 6 builders exist

- **Location:** `src/lib/discovery/engine.ts:45` (`DEFAULT_MAX_ROWS = 8`), `engine.ts:80-102`; builders in `rows.ts`: `buildTopPicksRow` (1), `buildMicroGenreRows` (≤2, `rows.ts:168`), `buildKeywordRow` (≤1), `buildSeedRows` (≤2, `rows.ts:256`), `buildContextualRows` (≤2, only late-night + bite-sized), `buildColdStartRows` (≤4, sliced `rows.ts:393`).
- **Problem:** Even a rich, long-tenured user's home feed can *never exceed 8 rows by construction* (1+2+1+2+2). The feed floor (`engine.ts:46` `FEED_FLOOR_ROWS = 6`) and ceiling are nearly the same number, so MMR row ranking (`ranking.ts:121-162`) is ranking 6–8 candidates into 6–8 slots — diversity optimization over a set that barely exists.
- **Fix / improvement:** (roadmap R1-2) Raise `DEFAULT_MAX_ROWS` to 20–30 and expand the builder family: multi-seed BYW (top 5 seeds), top-3 keyword rows, per-dim micro-genre rows (all dims > threshold, not just 2), decade×genre combos, "Because you added", "Watch it again", collection/franchise rows, network affinity rows (HBO, Netflix, Studio Ghibli via `with_companies`/`with_networks` — verified available in discover). The MMR layer then actually does its job.

### 2.3 P0 — Only 14 static facets; pages render 5–8 rows; genre mode only 3 rows

- **Location:** `rows.ts:470-544` (FACET_REGISTRY: 7 movie + 7 TV); rendered on `/movies` (`src/app/movies/page.tsx:213-275`: personalized feed + 7 facet rows), `/tvshows` (`src/app/tvshows/page.tsx:254-320`: same pattern), home (`page.tsx:187-271`: personalized feed + 3 static rows + library grid). Genre-filtered mode on `/movies` & `/tvshows` renders only **3 rows** (`movies/page.tsx:166-208`, `tvshows/page.tsx:210-253`).
- **Problem:** Netflix-class apps render 25–40 rows on their home surfaces with genre rows for every major genre; UmrFlix has no romance, drama, documentary, family, animation, mystery, war, western, music, or history facets; no decade facets; no network/collection facets. Selecting a genre pill *reduces* the page to 3 rows.
- **Fix / improvement:** (roadmap R1-3) Generate facets from the existing 24-entry genre registry (`src/lib/genres.ts:29-206`) — at minimum one "Popular/Top-Rated/New" triple per genre per media type (≈40+ facets) from a data-driven builder instead of hand-written entries; genre mode pages should get the full facet family filtered to that genre (they currently get only 3). Same rows.ts pool cache absorbs the cost.

### 2.4 P0 — Cold-start TV feed renders **two** rows; home bias starves TV entirely

- **Location:** `rows.ts:351-401`: for `mediaTypeFilter==="tv"`, all three movie specs are skipped and only `cold:trending-tv` remains (`rows.ts:382-390`). `engine.ts:94-101` then yields `top-picks` + 1 cold row. The floor (`engine.ts:165`) targets `min(6, candidates.length) = 2`.
- **Problem:** A brand-new user opening `/tvshows` sees a "personalized" feed of 2 rows; the new-user home feed is 3–4 rows (top-picks + 3 movie cold rows + 1 TV). First impressions are the churn moment.
- **Fix / improvement:** Cold-start spec library needs parity (trending/popular/acclaimed/genre-hits per media type — 8–12 specs) and the floor should reach 6 regardless of media filter (roadmap R1-2).

### 2.5 P1 — Genre page: global dedupe starves later rows; zero-item rows silently vanish

- **Location:** `src/lib/genre-catalog.ts:510-522` (`pushRow` with one shared `seen` set; rows pushed with `accepted.length > 0` — no minimum).
- **Problem:** Rows are emitted in a fixed order where `trending`, `available`, `acclaimed`, `new-recent` come before `hidden-gems`, `because`, and the two decade rows. Earlier rows drain the (heavily overlapping) candidate universe; later rows are rendered with 1–4 cards or dropped entirely — visible as patchy, sparse pages. Only 2 decade rows exist (`getRecentDecades`, `genre-catalog.ts:389-401`: current-decade-minus-10 and minus-20 only).
- **Fix / improvement:** Reserve-tag top items per row family, interleave bucketed sources (rank-based allocation à la Netflix's row-construction), give decade rows their own pools, require ≥5 items per emitted row, and extend decades back to the 70s (roadmap R1-4).

### 2.6 P2 — Home's static rows: mislabeled type, thin configs, no variety

- **Location:** `src/app/page.tsx:197-203` — `<MovieRow type="tv" endpoint="/api/tmdb/trending/all/week">` (mixed content typed as TV); `:209-214` "Something New To You" (`primary_release_date.lte=30d` ago, `vote_count.gte=5`, no `gte` lower bound → "new" = 30–50 days old); `:217-222` acclaimed; `:225-230` "Global Hits".
- **Problem:** Only 3 static rows on the biggest page, one mislabeled, one misnamed, all page-1-only, all with §1.2 floors.
- **Fix / improvement:** Replace hand-rolled static rows with the facet registry (shared definitions), so home gets 15+ curated rows consistent with `/movies` & `/tvshows`.

### 2.7 P2 — `/movie` and `/popular` pages are redirects; search is the only full-catalog surface

- **Location:** `src/app/movie/page.tsx:15-16` → `/movies`; `src/app/popular/page.tsx:3-4` → `/search?filter=popular`.
- **Problem:** No dedicated browse-all grid with pagination exists; the only "everything" surface is search results.
- **Fix / improvement:** (roadmap R1-5) Add a true catalog explorer page (sort + filter bar over `discover`, paginated grid) — this is where the down-ranked long tail can still be browsed, keeping the policy coherent (rows stay clean; explorer stays complete).

---

## 3. Personalization Variety Findings

### 3.1 P0 — Personalized row builders are movie-only by default; home feed is movie-monoculture

- **Location:** `rows.ts:173` (`const targetType = mediaTypeFilter ?? "movie"`), `rows.ts:190` (`toScoredItem(r, mediaTypeFilter ?? "movie")`), `rows.ts:232` (keyword row), `rows.ts:309` (`if (!mediaTypeFilter || mediaTypeFilter === "movie")` guard around *all* contextual rows).
- **Problem:** On the **home** feed (no mediaType filter), micro-genre rows, the keyword row, and *both* contextual rows consider movies only. TV content enters home personalization only via the mixed top-picks pool and any BYW seeds. A TV-heavy user's home "personalized" feed is mostly movie rows built from a minority of their taste.
- **Fix / improvement:** Build each personalized row in both media variants (or mirror the user's actual movie/TV event ratio from the profile) and let MMR pick between `micro-genre:6 (movie)` vs `micro-genre:6 (tv)` variants (roadmap R1-2).

### 3.2 P1 — Only 2 "Because You Watched" rows, from a 5-candidate seed pool, gated at weight ≥ 0.7

- **Location:** seeds: `profile.ts:280-289` (`weight >= 0.7` → candidate, then `.sort(timestamp).slice(0, 5)` at `profile.ts:336`); rows: `rows.ts:256` (`slice(0, 2)`).
- **Problem:** Favorites (+1.0) and completions (+1.0) qualify, but partial plays (≤0.87) never do; of 5 candidates only 2 rows ship, the newest two — so the BYW rail rotates only when the user *completes* something new, and duplicates vanish if the two newest are similar.
- **Fix / improvement:** Sample 4–6 seeds weighted by decayed weight (not newest-first), mix `recommendations` and `similar` TMDB endpoints per seed (both exist: `tmdb.ts:164, 171` already fetch `recommendations,similar` inline on detail pages), and de-dupe seeds near-identical in vector space.

### 3.3 P1 — One keyword row ever, from `topKeywords[0]` only

- **Location:** `rows.ts:220-248` (`const keyword = profile.topKeywords[0]`); profile keeps 10 keywords (`profile.ts:320-322`) — 9 are never used for rows.
- **Problem:** Keyword rows are the most distinctive personalization surface ("Neo-noir Heists", "Space Opera") and the system uses 10% of its own signal.
- **Fix / improvement:** Build up to 3 keyword rows (distinct keywords, distinct genres where possible), rotate them daily for freshness.

### 3.4 P1 — Contextual system: 2 triggers, movie-only, one is a horror/thriller stereotype

- **Location:** `rows.ts:301-348` — late-night (hour ≥ 22 or < 3, hardcoded genres `53,27` = Thriller+Horror) and bite-sized (`meanWatchMinutes < 35`, runtime ≤ 35 min movies).
- **Problem:** `peakViewingHour` is computed from every user's own play histogram (`profile.ts:311-318`) and **never used** — the late-night row fires on wall-clock hour assuming everyone binge-horrors at midnight. No morning/family/movie-night/weekend contexts; no TV contexts at all (§3.1).
- **Fix / improvement:** Drive context from `peakViewingHour` + day-of-week; add weekend-family, commute-hours short-form TV (≤30 min episodes), and genre-appropriate late-nights derived from the user's own vector; always emit a TV variant.

### 3.5 P2 — Subtitle honesty & row identity

- **Location:** `rows.ts:154` ("Ranked by your personal 64-dimensional taste profile" — shown even for cold-start users with no profile), `rows.ts:441-443` (`safeTrending` is `discover?sort_by=popularity.desc`, mislabelled "Trending Movies Today" at `rows.ts:358-361`).
- **Problem:** Cosmetic but trust-eroding: cold users are told content is personalized; "Trending" rows aren't the trending endpoint.
- **Fix / improvement:** Honest copy ("Popular with members right now"); use actual `/trending` (already wrapped at `tmdb.ts:148-150`) for trending rows.

---

## 4. Personalization Correctness & Depth Findings

### 4.1 P0 — Candidate vectors are sparse: personalization is mostly genre+decade cosmetics

- **Location:** `rows.ts:44-69` (`toScoredItem` builds candidate vectors with `genreIds`, `releaseYear`, `runtimeMinutes: null` only — no cast, no directors, **no keywords**); compare `profile.ts:112-121` where *profile-side* items include cast/directors/keywords.
- **Problem:** User vectors carry signal in dims 32–63 (people, keywords); candidate vectors have zeros there, so cosine similarity is driven almost entirely by dims 0–31 (genres/decade/runtime-bucket) — and runtime is a *defaulted constant* (`vector.ts:209`: 100 for movie, 45 for TV — every movie has the same runtime bucket). Result: the "personal 64-D taste profile" ranking behaves as a 2.5-feature genre/decade matcher. Two items identical in genre + year are indistinguishable.
- **Why it matters:** Explains "personalized content has less variety" — the similarity term collapses to genre matching, so rows feel samey, and the genuinely distinctive dims (cast, keywords) never influence ranking.
- **Fix / improvement:** (roadmap R2-1) Enrich candidate vectors for the top-N of each pool (e.g., 40–60) through the existing `resolveItemProfile` path (Convex-cached `itemFeatures`, `profile.ts:143-161`) — one detail call per candidate amortized over 6h pool TTLs; or precompute item features in a nightly Convex cron for the entire active catalog window. Also drop the runtime-default bucket to neutral (spread the bucket mass) when runtime is unknown.

### 4.2 P1 — 16-dimension hash buckets for people and keywords collide constantly

- **Location:** `vector.ts:214-227` — `fnv1a(name) % 16`.
- **Problem:** Top-8 cast + 3 directors → 11 names into 16 dims (birthday-paradox collisions); 20 keywords into 16 dims (~70% collision chance for the tail). Colliding entries `Math.max`-merge, so e.g. "Tom Hanks" and "Werner Herzog" can literally share a dimension. Similarity in 32–63 is noisy by design.
- **Fix / improvement:** Expand the feature space (e.g., 128-D with 32 people / 32 keyword dims), or store explicit sparse index→weight maps per item and compute similarity over the intersection — both preserve the cosine contract.

### 4.3 P1 — `scoreItem` takes `isWatched`/`allowWatched` params it ignores

- **Location:** `ranking.ts:29-30` (type), `ranking.ts:36-61` (never referenced).
- **Problem:** Dead parameters signal a spec/implementation drift; call sites hardcode `isWatched: false` (`engine.ts:130`, row route L51). Watched-state is handled pre-filter instead.
- **Fix / improvement:** Remove the params or implement the intended soft-penalty path (rewatchable classics could be *demoted*, not hidden — see §7 "Watch It Again").

### 4.4 P1 — Inconsistent scoring scales across engines make the same title rank differently on different pages

- **Location:** engine `ranking.ts:39-60` (ln-normalized pool-relative popularity, quality 0.5-floor); genre-page `genre-profile.ts:400-425` (`popularity/400`, rating 25%, libraryBoost 0.15); legacy `recommendations.ts:312-333` (`vote_average*4 + min(popularity/10, 30) + source boost`).
- **Problem:** Three scoring dialects; pool-relative normalization means the same item scores differently depending on pool composition; libraryBoost applies to movies only (`genre-profile.ts:419-423`).
- **Fix / improvement:** Consolidate on one item-scoring module (the Bayesian-quality + normalized-popularity formulation) shared by all three engines, with per-surface weight presets. Step toward the long-term goal of deleting the legacy engine (§4.5).

### 4.5 P2 — Legacy recommendation engine duplicates the discovery engine with worse semantics

- **Location:** `src/lib/recommendations.ts` whole file vs `src/lib/discovery/**`; route `src/app/api/recommendations/route.ts:1-31` (dead `"trending"`/`"bygenre"` filter values at L12, unchecked casts L11/L14, `limit` unclamped L10).
- **Problem:** Two engines drift apart (bug: shared cache ignores user, §5.4); endpoints disagree on behavior and error conventions (500 here vs 200-empty in discovery).
- **Fix / improvement:** Deprecate `/api/recommendations` behind a thin adapter onto the discovery engine (BYW facet with `seed=` param), retire `cacheMap`.

---

## 5. Feedback Loop & Ranking Bugs (the engine never learns)

### 5.1 P0 — Click beacon contract is broken app-wide: clicks are never recorded, fatigue never resets, UCB1 starves

- **Location:** sender `src/components/MovieRow.tsx:242-257` posts `{ rowCategoryKey, clicked: true }`; receiver `src/app/api/discovery/impression/route.ts:26-29` requires `{ rowCategoryKey, action: "view" | "click" }` and 400-rejects otherwise. Grep confirms `MovieRow.tsx` is the only client sender.
- **Problem:** Every click beacon in the product fails validation. Consequences: `resetRowFatigue` (route L42-47) never runs → fatigue only increments (see §5.2) → rows vanish and churn; `recordRowImpression(clicked: true)` never runs → the global bandit stats (`rowImpressionStats` table) receive impressions with clicks only from... nothing. Net effect: the engagement half of the learning loop has been dead since the beacon was written.
- **Why it matters:** This single mismatch silently disables the system's ability to learn from engagement — the central promise of the discovery engine.
- **Fix / improvement:** Align the payload (send `action: "click"`) or accept `clicked` in the validator; add a contract test (`npm run test:lib` style) pinning the beacon schema (roadmap R0-1).

### 5.2 P0 — Fatigue is counted at serve time AND (was meant at) viewport time, and every mount double-fires

- **Location:** serve-time recording in `src/app/api/discovery/home/route.ts:44-50` (records a fatigue impression for **every row in the payload**, viewed or not); viewport beacon path in `impression/route.ts:37-41`; double-fetch-per-mount in `PersonalizedFeed.tsx:26-42` (`hour` starts `null` → fetch → effect sets hour → second fetch with a different URL; the two requests have **different route-cache keys** (`home/route.ts:33`) **and different engine-cache keys** (`engine.ts:64-65`: "all" vs "am"/"pm"), so both run the full pipeline and both record).
- **Problem:** One page view = 2 full feed builds + 2 serve-log + 2 fatigue writes for up to 8 rows each. With suppression at 4 unclicked impressions in 7 days (`ranking.ts:71-72`), a row is suppressed after ~2 page loads even if the user loves it — and with clicks broken (§5.1), nothing ever resets it. Then the **feed floor** (`engine.ts:164-173`) re-processes *suppressed* rows to reach 6 rows, so suppression is partly undone at random — the system oscillates.
- **Fix / improvement:** Record fatigue only on genuine viewport impressions (IntersectionObserver on rows, throttled, one per row per session); never at serve time. Initialize `hour` synchronously (`useState(() => new Date().getHours())`) to kill the double fetch. Make the floor respect suppression (fall back to the cold-start registry, not to suppressed rows) (roadmap R0-1/R0-6).

### 5.3 P1 — The "UCB1 bandit" is write-only; it never influences ranking

- **Location:** writes: `impression/route.ts:42`, `store.ts` `recordRowImpression/getRowStats`; reads: **none** — `engine.ts:1-24` imports only `getRowFatigueMap, getServeLog`; `ranking.ts:101-116` (`rowUtility`) uses `topItemScore × relevance × fatiguePenalty` only.
- **Problem:** The `rowImpressionStats` table and the architecture doc's "UCB1 exploration" are dead subsystems; row ranking cannot explore (a new row's utility starts at a structural disadvantage vs. established rows).
- **Fix / improvement:** Wire a real exploration bonus: `S_row' = rowUtility + c·sqrt(ln(N_total)/(1+N_row))` using `getRowStats`; ε should anneal. Until the click pipeline (§5.1) is fixed, do it with impressions-only proxies (roadmap R2-2).

### 5.4 P0 — Legacy recommendations cache is keyed **without userId**: one user's recs served to everyone

- **Location:** `src/lib/recommendations.ts:243` (`const cacheKey = mediaType || "all"`), cache check L246-251, 30-min TTL L89. The route (`src/app/api/recommendations/route.ts:9`) trusts a client query param for `userId` and never reads the session.
- **Problem:** `generateRecommendations` personalizes from server-context Jellyfin (`getResumeItems`, L255) — itself user-agnostic — and then caches globally. In a multi-user deployment, personalization is both wrong (admin's resume list) and shared.
- **Fix / improvement:** Key cache by `{userId, mediaType}`, read the session server-side (as discovery routes do), and pass the Jellyfin user context into `getResumeItems` (roadmap R0-6).

### 5.5 P1 — `/api/discovery/row` fallback path bypasses the watched filter

- **Location:** `src/app/api/discovery/row/route.ts:63-67`: if scored+filtered items < 5, the route serves the **raw pool order**, first 20 — including completed/interacted items it explicitly filtered two lines earlier.
- **Fix / improvement:** Fall back to relaxing *demotion*, never the hard watched filter; top up from pool page 2–3 (already fetched) before giving up.

### 5.6 P1 — Serve-log inflation/conflation across cache layers

- **Location:** 20s route cache (`home/route.ts:15, 33-42`) recording serves; 10-min engine cache (`engine.ts:47, 235`) returning identical rows; `recordServeLog` per served item; demotion at `engine.ts:132-135`.
- **Problem:** Refreshing at 21s re-records "serves" for identical content (0.85^n demotion accelerates for no user-visible reason); conversely, genuinely distinct serves inside 20s collapse to one. Serve counts are a function of cache TTLs, not behavior.
- **Fix / improvement:** Record serves only when the *payload content* actually differs (hash of row keys + item keys), or attach recording to the engine cache-miss path.

### 5.7 P2 — Time-key bugs: `hour=0` aliases to "default"; 12-hour engine buckets; unbounded route cache

- **Location:** `home/route.ts:31-33` (`clientHour || "default"` — midnight `0` and NaN both alias); `engine.ts:64` (am/pm buckets make feeds stale up to 12h inside a 10-min cache — coherent but coarse); `home/route.ts:14` `homeFeedCache` has **no size cap or sweeper**; the raw hour integer embeds in the key (`?hour=` arbitrary ints → permanent entries — trivial memory DoS).
- **Fix / improvement:** Validate `hour ∈ 0..23`, key the route cache by am/pm like the engine, cap the map (LRU, e.g., 500).

---

## 6. Ingestion, Profile & Store Pipeline

### 6.1 P1 — Cold-start vector averages unfiltered trending (soap/daily drift)

- **Location:** `profile.ts:439-470` — `trending("movie"/"tv", "week")` → averaged into the cold-start vector with no quality/type gating (§1.6 on what trending TV contains), 6h TTL.
- **Problem:** New and anonymous users' vectors lean into the most polluted pool in the system; their "Top Picks" ranking starts skewed.
- **Fix / improvement:** Build the cold-start vector from votecount-gated popular lists (e.g., `sort_by=vote_average.desc, vote_count.gte≥500` across core genres), not raw trending.

### 6.2 P1 — Only 25 items ever get resolved into the profile; the rest of the 90-day event log is vector-silent

- **Location:** `profile.ts:67` (`MAX_DETAIL_RESOLUTIONS = 25`), `profile.ts:181-208`; events without resolved profiles contribute only to `completedKeys`/`interactedKeys` (`profile.ts:251-256`).
- **Problem:** Active users have hundreds of events/90d; the vector sees 25 (batched 5-at-a-time TMDB calls, latency-bound). Keyword/people dims of the user vector are built from ≤25 items — thin and recency-skewed (the `|weight|×decay` sort favors whatever happened lately).
- **Fix / improvement:** The Convex `itemFeatures` cache (`store.ts:371-427`) should be pre-warmed by a cron for active catalog items so profile builds rarely call TMDB at all; raise the cap to ~100 once cheap (roadmap R2-1).

### 6.3 P1 — Jellyfin "watch history" is actually the *resume* list; completed watches are invisible

- **Location:** `src/lib/recommendations.ts:255` & `src/lib/genre-profile.ts:120` — `getResumeItems(20)`.
- **Problem:** Jellyfin resume = in-progress items only. Fully-watched content (the strongest taste signal) contributes *only* if the player posted a `playback/progress` event (`src/app/api/jellyfin/playback/progress/route.ts:62` → `ingestPlaybackStopped`). Any play session that misses the progress post (crashes, other clients) is unknown to the profile; `genre-profile.ts` has no completion signal at all.
- **Fix / improvement:** Use Jellyfin's user-data/user-views endpoints (Played filter, sort by DateLastPlayed) for genuine history; keep resume items as a separate, stronger "currently watching" signal.

### 6.4 P1 — Signal vocabulary is too narrow for the down-rank policy and user control

- **Location:** `ingest.ts` events (play_complete/partial/abandonment/rewatch/favorite/unfavorite/request) + `SIGNAL_EVENT_TYPES` at `profile.ts:170-179` (lists `rating` but nothing emits it).
- **Problem:** No thumbs-down / "Not Interested" (the single most valuable negative signal), no trailer-view, no row-scroll-past; the 5–10% completion gap silently drops events (`ingest.ts:44`, deliberate), so early-quit documentaries etc. never register; `computeRewatchWeight`'s `>30d` branch (`ingest.ts:48-53`) is unreachable (lookup window is 30d).
- **Fix / improvement:** Add explicit negative feedback (row-card "Not interested" → `-1.0` event + item-level hide for 90d), emit the declared-but-unused `rating` type, remove the dead branch.

### 6.5 P2 — Store.ts resilience: permanent Convex lockout, event duplication, prune bugs

- **Location:** `store.ts:170-173` (one thrown `new ConvexHttpClient` ⇒ `cachedClient = null` forever), `:209, 234-243` (event written to Convex *and* merged from local buffer on read → potential double-count on network-blip retries), `:385-388` (item cache sweep deletes a single oldest entry — can park at 501 forever, and "oldest" = insertion order), `engine.ts:226-234` (same one-oldest prune pattern in the feed cache).
- **Fix / improvement:** Retryable init with backoff; dedupe merged events by id before sort; true LRU/TTL sweeps.

### 6.6 P2 — String-literal Convex function references; no codegen safety

- **Location:** `store.ts:76-140` — 12 `FunctionReference` casts like `"discovery:logEvent"`.
- **Problem:** Schema/mutation renames fail only at runtime.
- **Fix / improvement:** Use generated `api` from `convex/_generated/api` (already exists — `convex/crons.ts:2` uses it).

### 6.7 P2 — Title-search TMDB fallback can misresolve IDs; series-level-only attribution

- **Location:** `ingest.ts:111-121` (`results[0].id` — first hit wins; no year/popularity disambiguation), `ingest.ts:103-109` (episodes always roll up to the series).
- **Problem:** Wrong-ID events inject garbage vectors (a name-colliding movie becomes permanent taste signal); anthology/variety shows collapse to one series-level vector.
- **Fix / improvement:** Disambiguate with year + popularity + original-title Levenshtein; keep episode-level keywords only for specials/anthologies.

---

## 7. Feature Gaps vs Industry Standard (Netflix / Disney+ / Max)

These are absent capabilities users *expect* from a modern catalog app (all feasible on already-used TMDB endpoints):

| # | Gap | Industry reference | Feasibility notes |
|---|---|---|---|
| 7.1 | **"Not Interested" / double-thumbs rating** | Netflix thumbs up/down + remove-from-row | New `rating` event already stubbed in `profile.ts:170-179`; UI in `MediaCardFlyout.tsx`; hide or -1.0 demote for 90d |
| 7.2 | **Top 10 rows** ("Top 10 Movies Today") | Netflix Top 10 | One discover call, `sort_by=popularity.desc` + quality floors + ordinal badges on cards |
| 7.3 | **% Match score on cards** | Netflix match % | Already have `cosineSimilarity` per item in engine (`engine.ts:121, 136`) — export `match = round(50 + 45·(sim+1)/2)` into `RowItem` and render in `MovieCard.tsx` / `MediaCardFlyout.tsx` |
| 7.4 | **Watch-provider / Network rows** ("HBO", "Netflix", "Studio Ghibli") | Disney+ hubs, Netflix "Netflix Originals" | TMDB discover `with_networks` (TV), `with_companies` (film), `with_watch_providers`+`watch_region` — verified params; user network affinity from existing vectors |
| 7.5 | **Collections / franchises rows** (MCU, Harry Potter) | Disney+ | TMDB `/collection/{id}` from movie details (`belongs_to_collection`) |
| 7.6 | **"Watch It Again" / Recently Watched row** | Netflix | `completedKeys` + rewatch weights already exist in the profile (`profile.ts:219, 280-289`) |
| 7.7 | **Country/language rails** (K-Drama, Anime, Bollywood) | Netflix global rows | `with_original_language=ko|ja|hi` in discover; anime precedent exists (`genres.ts:52-55`) |
| 7.8 | **Coming Soon / theatrical rails** (opt-in windows) | Netflix "Coming Soon" | `primary_release_date.gte=today` + `with_release_type` (1–6 verified) — the currently *excluded* window becomes a deliberate row |
| 7.9 | **Per-profile maturity ceiling & kids mode** | Netflix Kids | `certification_country`+`certification.lte` (movies), `content_ratings` (TV detail); per-profile setting plumbing (needs §multi-profile fix) |
| 7.10 | **Sheduled content velocity**: "New episodes airing this week" | Max/Hulu rails | `/tv/on_the_air` + `air_date.gte/lte`, TVMaze already integrated (`tvmaze.ts`) |
| 7.11 | **Exploration budget (ε-greedy)** | RecSys standard practice | MMR exists for rows; add small exploration slot (every Nth row = curated non-personalized) |
| 7.12 | **Offline metrics / A-B harness** | Industry ML practice | Precision@k / coverage / intra-list diversity computed nightly from `userEvents`; required to stop "feels random" regressions |
| 7.13 | **Multi-profile plumbing (cross-cutting)** | Netflix profiles | `profileId` is hardcoded `"default"` in every API route (`home/route.ts:34/36/41/46/48`, `row/route.ts:34-35/71`, `impression/route.ts:40/45`) while the store is already profile-aware — plumb `?profileId=` from session/UI through routes → engine → store |

---

## 8. Phased Fix Roadmap

> Effort assumes focused work; each phase ships independently. P0 stops the bleeding; P1 fixes quantity/variety; P2 makes it a genuinely good recommendation system.

### Phase P0 — Stop the pollution & unbreak the loops (days)

| ID | Fix | Addresses | Files |
|---|---|---|---|
| R0-1 | Fix click-beacon contract (send/accept `action:"click"`); move fatigue recording from serve-time to an IntersectionObserver viewport beacon (one per row per session); make the feed floor respect suppression | §5.1, §5.2 | `MovieRow.tsx:242-257`, `impression/route.ts:26-47`, `home/route.ts:44-50`, `engine.ts:164-173` |
| R0-2 | Central quality-floor config; recalibrate all discover/vote floors to TMDB-scale values (movies ≥75 votes & popularity ≥3 browse-baseline, TV ≥30 & ≥3; stricter on curated rows) | §1.2, §1.6 | new `src/lib/catalog-quality.ts`; replace literals in `rows.ts`, `recommendations.ts`, `page.tsx`, `movies/page.tsx`, `tvshows/page.tsx`, facets |
| R0-3 | Bayesian weighted rating everywhere (`m=300` movie / `100` TV); replace `voteCount<50→0.5` | §1.3, §1.4 | `ranking.ts:44-47`, `catalog.ts:234-300` |
| R0-4 | `content-policy.ts`: `adult` field typing + demotion, keyword/certification demote-list, TV `with_type`/soap exclusion by default (opt-in row for dailies) | §1.1, §1.6 | `tmdb.ts:24-50`, `catalog.ts`, `rows.ts` facets |
| R0-5 | Guard empty `with_genres`; skip (not fetch) rows with no mapping; fix `GENRE_DIM_TO_TMDB` (TV Thriller→Crime+Mystery pipe-OR; Reality&Talk handled as TV-only) | §1.5 | `vector.ts:263-284`, `rows.ts:128,136,187,197` |
| R0-6 | Filter once (server), over-fetch (pool 40–60 → ship 20 post-filter); route fallbacks never bypass watched filter; legacy engine: per-user cache key + session userId + filterDisplayable on fallback | §1.8, §1.10, §5.4, §5.5 | `rows.ts:408-461`, `MovieRow.tsx:50-53`, `row/route.ts:63-67`, `recommendations.ts:243,349-355`, `recommendations/route.ts:9` |
| R0-7 | PersonalizedFeed single fetch (`useState(() => new Date().getHours())`); validate `hour`; LRU-cap `homeFeedCache`; unify cache keys to am/pm | §5.2, §5.7 | `PersonalizedFeed.tsx:26-32`, `home/route.ts:14-42` |

### Phase P1 — Depth: more rows, more items, TV parity (1–2 weeks)

| ID | Fix | Addresses | Files |
|---|---|---|---|
| R1-1 | Row pagination: `?cursor/page=` on `/api/discovery/row`; pool cache keyed incl. page; `MovieRow` end-sentinel + SWR; server ships items 20-at-a-time from 60-item pools | §2.1 | `row/route.ts`, `rows.ts:405-461`, `MovieRow.tsx` |
| R1-2 | Feed scale-out: `DEFAULT_MAX_ROWS` → 24; new builders (multi-seed BYW, ×3 keywords, per-dim micro-genres **movie AND tv variants**, network rows, watch-it-again, weekend/family contexts), cold-start parity (10–12 specs/media type); drive late-night from `peakViewingHour` | §2.2, §2.4, §3.1–3.4 | `engine.ts:45-46`, `rows.ts:161-401`, `profile.ts:311-318` |
| R1-3 | Data-driven facets from `genres.ts` (Popular/Top-Rated/New × genre × media type ≈ 40+); genre-mode pages render the filtered facet family, not 3 hand rows | §2.3, §2.6 | `rows.ts:470-544`, `genres.ts`, `movies/page.tsx`, `tvshows/page.tsx` |
| R1-4 | Genre-page row allocation: bucketed dedupe (reserved shares) + ≥5 minimum per row + decades back to the 70s | §2.5 | `genre-catalog.ts:389-401, 510-522` |
| R1-5 | Catalog explorer page (grid + sort/filter + pagination) — also the sanctioned home for the long tail under the down-rank policy | §2.7, §1 policy | new `src/app/browse/page.tsx` |
| R1-6 | Fix `on-the-air-shows` → `/tv/on_the_air`; add `with_type=4`-style scripted bias to general TV facets; add Top-10 rows (7.2); % Match on cards (7.3); "Not Interested" (7.1, MVP store event + flyout button) | §1.6, §7 | `rows.ts:509-513`, `tmdb.ts`, `MovieCard.tsx`, `MediaCardFlyout.tsx`, `ingest.ts` |

### Phase P2 — Intelligence & scale (2–4 weeks)

| ID | Fix | Addresses | Files |
|---|---|---|---|
| R2-1 | Item-feature precompute (nightly Convex cron over active catalog + watched items) → dense candidate vectors (cast+keywords) for top-N of every pool; raise `MAX_DETAIL_RESOLUTIONS` once reads are cache-local; neutral runtime bucket when unknown | §4.1, §6.2 | `profile.ts:67,143-161`, `rows.ts:44-69`, `vector.ts:209`, `convex/` |
| R2-2 | Wire rowImpressionStats → real UCB1/exploration bonus in `rankRowsMMR`; ε annealing; offline metrics job (precision@k, row coverage, intra-list diversity) | §5.3, §7.11, §7.12 | `ranking.ts:101-162`, `engine.ts`, `store.ts:288-321` |
| R2-3 | Expand feature space to 128-D (32 people/32 keyword buckets); one shared scoring module across engine/genre/legacy; retire legacy `/api/recommendations` behind discovery adapter | §4.2, §4.4, §4.5 | `vector.ts`, `ranking.ts`, `genre-profile.ts:366-426`, `recommendations.ts` |
| R2-4 | Per-profile plumbing end-to-end (`profileId` param from session/UI through routes → engine → store); maturity ceilings & kids mode (7.9); watch-provider rows (7.4); collections (7.5); language rails (7.7) | §7.13, §7.4/5/7/9 | all discovery routes, `content-policy.ts`, `rows.ts` |

---

## Appendix A — TMDB API facts relied on in this audit (verified 2026-08-19 against developer.themoviedb.org)

1. `/discover/movie` & `/discover/tv` support 30+ filters including `include_adult` (default **false**), `certification_country`+`certification(.gte/.lte)`, `with_genres` (comma=**AND**, pipe=**OR**), `without_genres`, `with_keywords`, `without_keywords`, `with_watch_providers`+`watch_region`+`with_watch_monetization_types` (`flatrate|free|ads|rent|buy`), `with_companies`, `with_networks` (TV), `with_origin_country`, `with_original_language`, `with_cast`, `with_people`, `with_runtime.gte/lte`, `vote_average.gte/lte`, `vote_count.gte/lte`, `primary_release_date.gte/lte` (movie), `first_air_date.*`/`air_date.*` (TV), `with_release_type` (1 Premiere, 2 Ltd. Theatrical, 3 Theatrical, 4 Digital, 5 Physical, 6 TV), and movie `sort_by` incl. `popularity/vote_average/vote_count/primary_release_date/revenue(.asc/.desc)`.
2. TV-only extras: `with_type` (0 Documentary, 1 News, 2 Miniseries, 3 Reality, 4 Scripted, 5 Talk Show, 6 Video), `with_status` (0 Returning, 1 Planned, 2 In Production, 3 Ended, 4 Canceled, 5 Pilot), `with_networks`, `screened_theatrically`, `include_null_first_air_dates`.
3. `/trending/{all|movie|tv|person}/{day|week}` accepts **no** quality/adult/type filters — curation must happen client/server-side after fetch.
4. Curated list endpoints exist and are free of soap pollution by construction: `/movie/{now_playing,popular,top_rated,upcoming}`, `/tv/{airing_today,on_the_air,popular,top_rated}` — the current codebase **only uses `/discover` + `/trending`**.
5. `/movie|tv/{id}/recommendations` and `/similar` return full pages (20/page) like discover (paginated) — currently used single-page only (`recommendations.ts:110-112`).
6. Item `adult` boolean exists on movie payloads (and discover responses); TV explicit control is via `content_ratings` (`tvDetail` already fetches it, `tmdb.ts:171`, but nothing reads it).
7. `popularity` is an unbounded, relative, decaying engagement metric — official example page-1 values: movies ~875–9273, TV ~1370–2684. Floors of `1.0–2.0` (current) exclude almost nothing; realistic browse floors are `3–8`, curated floors `8–20`.
8. Genres: fixed ids (movies 19 ids, TV 16 ids) — `src/lib/genres.ts` covers them; TV has no Horror/History/Music/Romance genre ids (hence the mapping bug in §1.5).
9. Certifications: `/certification/movie/list`, `/certification/tv/list`; movie certifications per item via `/movie/{id}/release_dates`, TV via `/tv/{id}/content_ratings` (already in `append_to_response`, `tmdb.ts:171`).
10. Rate guidance: ~50 req/s per key; the app's SingleFlight + 6h pool caches (`rows.ts:405`) + proxy response cache are correctly placed to absorb the roadmap's increased row counts if pagination reuses pooled params.

## Appendix B — Quick-reference: worst 10 offenders (fix first)

1. `MovieRow.tsx:242-257` × `impression/route.ts:26-29` — broken beacon contract (all clicks lost). §5.1
2. `home/route.ts:44-50` + `PersonalizedFeed.tsx:26-42` — serve-time fatigue + double-fetch (rows self-suppress in ~2 loads). §5.2
3. `vector.ts:263-284` + `rows.ts:128/136/187` — empty/mismatched genre mapping → unfiltered garbage in personalized rows. §1.5
4. `rows.ts:509-513` — "on-the-air" facet = popularity-sorted discover (soap flood). §1.6
5. `ranking.ts:44-47` — sub-50-vote items gifted quality 0.5. §1.3
6. All `popularity.gte: 1.0–2.0` / `vote_count.gte: 5–20` floors — no effective quality bar. §1.2
7. `rows.ts:173/190/232/309` — personalized builders movie-only; home never gets TV rows. §3.1
8. `rows.ts:382-390` + `engine.ts:94-101` — TV cold-start feed = 2 rows. §2.4
9. `rows.ts:38,460` + every route `.slice(0, 20)` — 20-item hard cap, zero pagination. §2.1
10. `recommendations.ts:243` — cross-user cache (personalization leaks between users). §5.4
