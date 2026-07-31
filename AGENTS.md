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
- UI styling is Tailwind CSS v4. Prefer existing UI primitives in src/components/ui/** and utility classes instead of introducing new styling systems.
- The player stack lives under src/components/player/** and uses hls.js plus subtitle helpers. When changing playback behavior, keep compatibility with the current player architecture.
- When an image is attached and refered to specifically as a "Referecnce" or "By taking reference from the image" ONLY if it is meant in a design oriented change by the user - take design reference from the image and avoid making changes mindlessly. Here are a few examples of what not to do and what I mean by "making changes mindlessly":
    1. Copying elements or features not meant for the app / project currently being worked on
    2. Making design changes exactly from the reference like fonts, colors or icons unless specified by the user
The goal is to use the reference image as a design referece and follow the user's instructions exactly and when specific instructions arent provided about design keep the desing cohesive to the project currently being worked on and donot copy from the reference exactly unless specified. See [design.md](./design.md) for design reference.

## Commands
- Install deps: npm install
- Start dev server: npm run dev
- Lint: npm run lint
- Production build: npm run build
- Start production server: npm run start

## Change guidance
- When adding a new media source or API integration, add a server route under src/app/api/<name>/... and a thin wrapper in src/lib/ if needed.
- For new pages, keep the Next.js App Router structure and colocate related UI and route logic.
- If a change affects environment configuration, update the relevant docs and keep secrets server-side.
- Prefer small, targeted changes that fit the existing component and data-fetching patterns.

## Notes
- There are no dedicated test scripts in this repo today; use lint/build plus manual verification for behavior changes.
- The /watch route intentionally renders a fullscreen player experience without the standard navbar/footer chrome.
- Watch Party engine lives under `src/lib/party/` (in-memory ephemeral rooms, protocol math, `roomManager` globalThis singleton), `/api/party/*` route handlers, `src/components/player/use-party-sync.ts` hook, and `/watch?party=[id]` room route.
