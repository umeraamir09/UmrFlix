# UmrFlix — Production Roadmap

> **Vision:** Transform UmrFlix from a functional MVP into a production-grade, everyday-usable media web application — combining TMDB's exhaustive catalog, Jellyfin's streaming capabilities, and Radarr/Sonarr's automated media management into a seamless, Netflix-quality experience.

---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Client ["Client Layer (Browser / Smart TV / PWA)"]
        UI["UmrFlix UI (Next.js 16 + React 19 + Tailwind CSS)"]
        Player["HLS Video Engine (HLS.js + Audio/Subtitles + Resume)"]
    end

    subgraph Server ["Server Proxy & Middleware Layer (Next.js App Router)"]
        APIProxy["API Route Proxies (Server-Side Secrets)"]
        AuthModule["Jellyfin User Auth & JWT Session"]
        PersistentCache["Persistent Cache (SQLite / Redis)"]
        EventHub["Real-time Event Hub (Webhooks / SSE)"]
    end

    subgraph Services ["Backend Media Ecosystem (Oracle VM / Server)"]
        TMDB["TMDB API (Master Catalog & Metadata)"]
        Jellyfin["Jellyfin Media Server (Streaming & UserData)"]
        Radarr["Radarr (Movie Automation)"]
        Sonarr["Sonarr (TV Show Automation)"]
        Downloaders["Download Clients (qBittorrent / SABnzbd)"]
    end

    UI <-->|HTTPS / WebSockets| Server
    Player <-->|HLS Video Stream| Jellyfin
    APIProxy <--> TMDB
    APIProxy <--> Jellyfin
    APIProxy <--> Radarr
    APIProxy <--> Sonarr
    EventHub <---|Webhooks| Radarr
    EventHub <---|Webhooks| Sonarr
    Radarr <--> Downloaders
    Sonarr <--> Downloaders
```

---

## 0. MVP Implementation Status (Completed)

The core MVP foundation has been fully built and verified:

- [x] **Scaffold & UI Core:** Next.js 16 (App Router), TypeScript, Tailwind CSS v4, shadcn/ui components (`MovieCard`, `AvailabilityBadge`, `RequestButton`, `RequestModal`, `Navbar`, `SearchBar`, `VideoPlayer`).
- [x] **API Proxy Layer:** Server-side route handlers proxying TMDB (`/trending`, `/search`, `/movie/:id`, `/tv/:id`), Radarr (`/movies`, `/queue`), Sonarr (`/series`, `/queue`), and Jellyfin (`/stream/:id`).
- [x] **Library Cache & ID Cross-Referencing:** In-memory collection caching (`cache.ts`) matching TMDB `tmdbId` for movies and resolving TMDB `external_ids` -> TVDB `tvdbId` for TV shows.
- [x] **Availability Engine:** Live status indicator ("In Library", "Downloading XX%", "Request").
- [x] **Automated Requesting:** Modal workflow for adding movies to Radarr and series to Sonarr.
- [x] **Library Browser & Basic Playback:** `/library` grid with filtering and embedded HTML5 video playback via Jellyfin.

---

## Phase 1: Crunchyroll-Inspired Premium UI/UX (Netflix Red Aesthetic) (Completed)

### 1.1 Header, Navigation & Branding Integration
- [x] **Branded Header Navigation (`Navbar.tsx`):**
  - Integrate custom logo (`logo_header.png`) and custom favicon (`favicon.ico`).
  - Dark sleek top bar (`#141519`) with top accent border in Netflix Red (`#E50914`).
  - Navigation menu links: "Home", "Popular", "Movies", "TV Shows", "Categories", "My Library".
  - Quick Search input box with Netflix red focus line, live search drop-down overlay, and Watchlist quick-access icon.

### 1.2 Crunchyroll-Style Hero Spotlight Carousel
- [x] **Hero Billboard & Carousel (`HeroBillboard.tsx`):**
  - Full-width hero banner slider featuring high-res backdrop fanart with dark side gradient overlays.
  - Show metadata pills (`NEW`, `Sub | Dub`, `Rating`, `Genres`).
  - Action buttons styled after Crunchyroll's high-contrast CTAs: Netflix Red primary "WATCH NOW" button with play icon, and secondary outline "ADD TO WATCHLIST" button.
  - Bottom slider thumbnail navigation indicators.

### 1.3 Media Cards, Continue Watching & Spotlight Banners
- [x] **Crunchyroll Card System (`MovieCard.tsx`, `ContinueWatchingCard.tsx`):**
  - **Portrait Media Cards:** Clean vertical posters with top-corner availability ribbon tag (In Library / Downloading / Request), crisp title underneath, and metadata tag line (`Sub | Dub`, `Year`, `Availability`).
  - **Continue Watching Landscape Cards (`ContinueWatchingRow.tsx`):** 16:9 widescreen thumbnails with bottom red progress bar, episode/time remaining badge (e.g., `23m left` or `62% downloaded`).
  - **Middle Spotlight Banners (`SpotlightBanner.tsx`):** Crunchyroll-style mid-page featured highlight cards split between large backdrop image on left and title, description, and Netflix Red action buttons on right.

### 1.4 Crunchyroll-Style Categorized Search & Grid
- [x] **Search Results Page (`/search` & `SearchResults.tsx`):**
  - Instant query bar with red focus line.
  - Categorized results layout: "Top Results" hero cards, "Series" grid list, and "Movies" grid list with episode/season metadata badges.

### 1.5 Crunchyroll Dark Theme System (`globals.css`)
- [x] **Color Palette & Styling:**
  - Deep dark background (`#141519` / `#0a0b0d`), subtle card elevation (`#23252b`).
  - Primary Brand Accent: Netflix Red (`#E50914`) replacing Crunchyroll orange for all buttons, active indicators, progress bars, and focus states.
  - Footer with logo, category directory, resources, and social links.

---

## Phase 2: Production Video Player & Media Engine

### 2.1 HLS.js & Transcoding Media Engine
- [x] **Advanced Video Player (`CinemaPlayer.tsx`):**
  - Integrate `hls.js` for adaptive HLS streaming (resolves browser codec incompatibility with MKV/HEVC/EAC3/DTS).
  - Automatic fallback between Direct Play (native HTML5) and Transcoded HLS stream based on browser capabilities.
  - Quality selector (Auto, 4K 20Mbps, 1080p 10Mbps, 720p 4Mbps) hitting Jellyfin's transcode profile API.

### 2.2 Subtitles & Multi-Audio Selector
- [x] **Track Switcher:**
  - Audio track selector (English 5.1, Commentary, Original Audio language).
  - Subtitle track selector (Embedded Jellyfin SRT/VTT + OpenSubtitles plugin integration).
  - Subtitle styling controls: Font size, background opacity, text color, and sync offset adjustment slider (+/- 5 seconds).

### 2.3 Progress Tracking & "Continue Watching" Sync
- [x] **Bi-directional Jellyfin Playback State:**
  - Send periodic heartbeat events (`POST /Sessions/Playing/Progress`) to Jellyfin every 10 seconds.
  - Save watch progress percentage and playback position timestamp.
  - "Resume Playback" prompt modal ("Resume from 42:15" vs "Start from Beginning").
  - Auto-mark items as "Watched" when reaching 90% completion.

### 2.4 TV Show Episode Navigator & Season Browser
- [x] **TV Show Season Hub (`SeasonBrowser.tsx`):**
  - Season selector dropdown/tab bar with season poster and episode count.
  - Episode card grid featuring episode thumbnail, episode title, air date, runtime, overview, and individual download/play status.
  - "Next Episode" auto-play overlay prompt with 10-second countdown timer during episode credits.

### 2.5 Intro & Credits Skipping
- [x] **Marker Integration:**
  - Support Jellyfin Intro Skipper API / chapter markers.
  - Display "Skip Intro" and "Skip Recap" floating buttons during detected timestamp ranges.

---

## Phase 3: Multi-User Auth, Profiles & Personalization

### 3.1 Native Jellyfin Authentication & Session Security
- [ ] **User Authentication Flow (`/login`):**
  - Replace static `.env` Jellyfin credentials with a multi-user Jellyfin login interface.
  - Authenticate against Jellyfin server API (`POST /Users/AuthenticateByName`).
  - Store Jellyfin `AccessToken` and `UserId` in encrypted httpOnly HTTP cookies (`iron-session` or JWT).
  - User profile switcher in Navbar (Avatar, username, active server URL).

### 3.2 Role-Based Access Control (RBAC)
- [ ] **Permissions & Limits:**
  - Admin users: Full control over Radarr/Sonarr profiles, root folders, download cancellation, and library settings.
  - Standard users: Can browse and request titles (subject to request quotas or approval workflows).
  - Guest/Kids mode: Filter catalog based on Jellyfin rating restrictions.

### 3.3 Personalized Watchlists & Favorites
- [ ] **User Personalization:**
  - "My List" bookmark button synced with Jellyfin User Favorites (`POST /Users/{userId}/FavoriteItems/{itemId}`).
  - Watch status indicators (green checkmark for watched, partial progress bar for in-progress).

---

## Phase 4: Real-time Download Management & Automation Hub

### 4.1 Webhook & Server-Sent Events (SSE) System
- [ ] **Real-time Event Bridge (`/api/webhooks`):**
  - Configure Radarr & Sonarr Webhooks pointing to UmrFlix (`On Grab`, `On Download`, `On Rename`).
  - Server-Sent Events (SSE) or WebSocket channel to broadcast state changes instantly to client browsers.
  - Instant UI badge state updates without polling.

### 4.2 Download Activity Center (`/activity`)
- [ ] **Active Downloads Drawer & Page:**
  - Consolidated view of active Radarr and Sonarr queues.
  - Live progress bar, download speed (MB/s), ETA, download client tag (qBittorrent / SABnzbd), and release title.
  - Actions: Pause download, Cancel download, Force re-search, and Remove from queue.

### 4.3 Advanced Request Customization Modal
- [ ] **Enhanced Request Modal (`RequestModal.tsx`):**
  - Quality Profile selector (e.g., Ultra-HD 4K, HD-1080p, Any).
  - Root Folder destination picker.
  - Minimum Availability & Tags selection.
  - For TV Shows: Season selection picker (All Seasons, First Season, Future Seasons, Specific Season).

### 4.4 Interactive Manual Search & Release Selection
- [ ] **Manual Release Picker (`/movie/:id/releases`):**
  - Fallback manual search triggering Radarr/Sonarr release search (`GET /api/v3/release`).
  - Interactive table displaying release title, size, indexer, seeders/leechers, quality, and age.
  - One-click "Grab Release" button to manually override automatic release selection.

---

## Phase 5: Persistent Cache & High-Performance Architecture

### 5.1 Persistent Storage Engine
- [ ] **Database & Cache Layer (SQLite / Prisma or Redis):**
  - Replace in-memory maps in `cache.ts` with persistent storage (SQLite via Prisma/Kysely or Upstash Redis).
  - Store TMDB metadata, TMDB↔TVDB mapping table, Jellyfin item indices, and user request history.
  - Background cron job to refresh collection indices every 15 minutes.

### 5.2 Next.js Image Optimization & Asset Proxying
- [ ] **Optimized Media Delivery:**
  - Use `next/image` for TMDB posters and fanart (`image.tmdb.org`).
  - Secure proxy route for Jellyfin image assets (`/api/jellyfin/image/:id`) with token authorization and browser caching headers.

### 5.3 Resilient API Middleware & Circuit Breakers
- [ ] **Fault Tolerance:**
  - Circuit breaker for external services (Radarr, Sonarr, Jellyfin, TMDB).
  - Fallback UI states when any self-hosted service goes offline (e.g., graceful message "Radarr unavailable, browsing remains active").
  - Retry logic with exponential backoff for external API calls.

---

## Phase 6: PWA, Smart TV Support & Production Deployment

### 6.1 Progressive Web App (PWA) & Smart TV Navigation
- [ ] **Everyday Usability & Accessibility:**
  - PWA Web Manifest (`manifest.json`) and service worker for app installation on mobile and desktop.
  - Spatial Navigation (D-Pad support for TV remotes / LG webOS / Samsung Tizen / Android TV browsers).
  - Touch gestures for mobile video player (double tap to skip 10s, vertical drag for volume/brightness).

### 6.2 Dockerization & Production Infrastructure
- [ ] **Deployment Readiness:**
  - Multi-stage `Dockerfile` optimizing Next.js standalone build output.
  - Complete `docker-compose.yml` boilerplate integrating UmrFlix with Jellyfin, Radarr, Sonarr, and Caddy/Nginx reverse proxy.
  - Environment variable validation using `zod` on app start.
  - Health check endpoint (`GET /api/health`) reporting status of database and upstream media services.

### 6.3 Health Monitoring & Audit Logs
- [ ] **Observability:**
  - Application activity log for admin users (who requested what, download completions, auth logs).
  - Error boundaries with user-friendly recovery UI.

---

## Implementation Sequence & Priorities

| Priority | Phase | Core Deliverable | Key Target |
|---|---|---|---|
| 🎯 **P0** | **Phase 2** | HLS.js Video Player & Episode Picker | Reliable playback for all codecs & TV show support |
| 🎯 **P0** | **Phase 3** | Jellyfin User Authentication | Secure multi-user login & sessions |
| 🚀 **P1** | **Phase 1** | Netflix UI, Hero Billboard & Carousels | Premium cinematic design & smooth discovery |
| 🚀 **P1** | **Phase 4** | Webhooks & Active Download Activity Center | Real-time download progress & status updates |
| 🛡️ **P2** | **Phase 5** | Persistent SQLite/Redis Cache & Performance | Resilient caching across server restarts |
| 📱 **P2** | **Phase 6** | Docker Stack, PWA & Smart TV Support | One-click deployment & TV remote accessibility |
