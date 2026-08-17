# AGENTS.md

## Project overview
- This repo is a Next.js 16 App Router app written in TypeScript for a Netflix-style media client.
- The app integrates TMDB for browsing/search, Radarr/Sonarr for requests and availability, and Jellyfin for playback.
- Most user-facing UI lives under src/components and route-level pages under src/app.

## Working conventions
- Keep external service access on the server side. Prefer route handlers in src/app/api/** or helper modules in src/lib/**; do not expose secrets from client components.
- Use the shared environment helper in src/lib/env.ts for reading env vars. New environment variables should be documented in README and the local env sample if applicable.
- Follow the existing feature structure:
  - pages and route layouts: src/app/**
  - reusable UI: src/components/**
  - server integration helpers: src/lib/**
- Client-side data fetching generally uses SWR. Match the existing pattern used in components like MovieRow, TvDetail, SearchResults, and LibraryPage.
- UI styling is Tailwind CSS v4. Always use tokens available in the Tailwind v4 `@theme` configuration in `src/app/globals.css` (e.g. Penpot design tokens `bg-penpot-bg`, `bg-penpot-surface`, `text-penpot-text-medium`, `bg-penpot-primary-300`, etc.) instead of hardcoded hex values (`#...`). Prefer existing UI primitives in `src/components/ui/**` and utility classes instead of introducing new styling systems.
- The player stack lives under src/components/player/** and uses hls.js plus subtitle helpers. When changing playback behavior, keep compatibility with the current player architecture.
- Player controls split: CinemaPlayer renders src/components/player/touch/TouchControls.tsx (Figma-referenced touch layout) + touch/use-touch-gestures.ts (pointer-event tap/double-tap-skip/lock recognizer) on (pointer: coarse) devices, and PlayerControls.tsx on desktop. Shared popovers (Audio/Subtitles, Speed/Quality) live in player-menus.tsx; SeekBar is exported from PlayerControls.tsx. All ±10s skip paths (double-tap, transport, keyboard) must route through CinemaPlayer's seekTo/skipBy so watch-party seek coalescing stays intact — never write video.currentTime directly.

## Commands
- Install deps: npm install
- Start dev server: npm run dev
- Lint: npm run lint
- Watch Party protocol/manager tests: npm run test:party
- Pure-logic lib/player tests (node:test): npm run test:lib
- Player component tests (vitest + jsdom, `*.component.test.tsx`): npm run test:components
- Production build: npm run build
- Start production server: npm run start

## Change guidance
- When adding a new media source or API integration, add a server route under src/app/api/<name>/... and a thin wrapper in src/lib/ if needed.
- For new pages, keep the Next.js App Router structure and colocate related UI and route logic.
- If a change affects environment configuration, update the relevant docs and keep secrets server-side.
- Prefer small, targeted changes that fit the existing component and data-fetching patterns.

## Notes
- Test suites: `npm run test:party` (watch party), `npm run test:lib` (pure-logic via node:test), and `npm run test:components` (player UI via vitest/jsdom). Use lint/build plus these suites for behavior changes.
- The /watch route intentionally renders a fullscreen player experience without the standard navbar/footer chrome.
- Watch Party engine lives under `src/lib/party/` (in-memory ephemeral rooms, protocol math, `roomManager` globalThis singleton), `/api/party/*` route handlers, `src/components/player/use-party-sync.ts` hook, and `/watch?party=[id]` room route.
- Watch Party requires a single Node process (PM2 fork mode; see DEPLOY_VPS.md). Convex persistence is restart-survival only; hydrated room states get their `updatedAt` rebased to load time.
- Party command/status payloads must validate through `sanitizePartyCommand` / `isValidPositionSec` in src/lib/party/protocol.ts (playbackRate whitelist: 0.5–2). System-generated states (buffer-pause/buffer-resume) must never carry `senderClientId` or echo suppression will skip them on that client. Commands carry `sentAt` (server-space capture time) so the server advances `positionSec` by the transport delay — never add latency-compensation paths that skip the 2s clamp in `applyCommand`.
- Strict buffer-hold: while ANY member reports `buffering`, the room stays paused — `play` commands from anyone (host included) are rejected; there is no force-resume and no stuck-timeout. The room resumes only via the system `buffer-resume` after every member's client reports a genuine recovery. Recovery is gated client-side (`PARTY_BUFFERING` in protocol.ts): a member must prove 8s buffered ahead sustained over a 2s grace window (or be genuinely playing). The only exception is crash cleanup: a buffering member whose heartbeat has been silent for 90s is treated as departed (pruned, membership broadcast, room resumes if they were the last holder) — presence cleanup, never an eviction of a live member. Keep the time-bound scrub/seek window (`scrubUntilRef`, 2.5s) — an event-only flag can wedge a member out of sync when `seeked` is delayed by buffering.
- In a party, only the host advances at end-of-media; other members hold at end and follow the host's party:item broadcast.
