![Logo](public\logo_header.png)

A Netflix-style media client that unifies **TMDB** catalog browsing, **Radarr** / **Sonarr** request management, and **Jellyfin** playback into one seamless interface.

Browse millions of movies and TV shows, see what's already in your library, request new downloads, and stream instantly — all from a single Next.js app running on your own infrastructure.

## Architecture

![Architecture](https://i.ibb.co/rGpVDYDP/custom-jellyfin-radarr-sonarr-client.png)

- **TMDB** — powers all browsing and search (infinite catalog, not limited to what's downloaded)
- **Radarr** — manages movie library and handles new requests + downloads
- **Sonarr** — manages TV library and handles new requests + downloads
- **Jellyfin** — streams the actual media files for playback
- **UmrFlix** — the glue layer that cross-references everything and presents a unified Netflix-like UI

## Features

- **Trending & browse** — hero billboard, spotlight banners, genre/genreless rows powered by TMDB
- **Search** — instant search across the full TMDB catalog with availability indicators
- **Availability badges** — knows whether each title is downloaded, downloading, or missing by cross-referencing Radarr/Sonarr APIs via TMDB/TVDB IDs
- **Request & download** — one-click requests flow through to Radarr/Sonarr automatic search
- **Download progress** — polls queue status so you see real-time % progress instead of a dead "requested" state
- **Streaming** — full Jellyfin-powered playback with HLS, ASS/SSA subtitle support, and audio track selection
- **Continue watching** — resumes in-progress titles from where you left off
- **Library** — browse everything you already own, unified across movies and TV

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| UI Components | Custom (`class-variance-authority`, `tailwind-merge`) |
| Icons | Lucide React |
| Data Fetching | SWR |
| Playback | hls.js, jassub (ASS/SSA subtitles) |
| Catalog API | TMDB |
| Media Servers | Radarr, Sonarr, Jellyfin |

## Prerequisites

- **Node.js** >= 20
- **npm** (or pnpm/bun/yarn)
- A running instance of each backend service (Oracle VM or local):
  - [Jellyfin](https://jellyfin.org) — media server
  - [Radarr](https://radarr.video) — movie management
  - [Sonarr](https://sonarr.tv) — TV series management
- A [TMDB API key](https://www.themoviedb.org/settings/api) (free)

## Getting Started

### 1. Clone and install

```bash
git clone <your-repo-url>
cd umrflix
npm install
```

### 2. Configure environment

Copy `.env.example` to `.env.local` and fill in your credentials:

```bash
cp .env.example .env.local
```

| Variable | Description |
|----------|-------------|
| `TMDB_API_KEY` | Your TMDB API key (v3 auth) |
| `RADARR_URL` / `RADARR_API_KEY` | Radarr instance URL and API key |
| `SONARR_URL` / `SONARR_API_KEY` | Sonarr instance URL and API key |
| `JELLYFIN_URL` / `JELLYFIN_USERNAME` / `JELLYFIN_PASSWORD` | Jellyfin connection details |

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## How It Works

**Browsing & search** hits the TMDB API directly — you see the full universe of movies and TV, not just what's already downloaded.

**Availability checking** cross-references every TMDB result against your Radarr/Sonarr collections by ID (never by title string). If a match is found, it reads `hasFile` status. For TV, TMDB IDs are mapped to TVDB IDs via TMDB's `external_ids` endpoint since Sonarr uses TVDB internally.

**Requesting** a title posts to Radarr (`POST /api/v3/movie`) or Sonarr (`POST /api/v3/series`) with the media ID and your configured quality profile / root folder. The backend immediately triggers an automatic search.

**Download progress** is shown by polling `GET /api/v3/queue` on both apps, so you see live percentage rather than a static "requested" label.

**Playback** streams directly from Jellyfin's HLS endpoints. Subtitles are rendered client-side via jassub for ASS/SSA format, with VTT as a fallback.

## Project Structure

```
src/
├── app/
│   ├── api/            # Next.js route handlers (proxies to TMDB/Radarr/Sonarr/Jellyfin)
│   ├── library/        # "My Library" page (already-downloaded content)
│   ├── movie/          # Movie detail pages
│   ├── tv/             # TV series detail pages
│   ├── search/         # Search results page
│   ├── page.tsx        # Home page (trending, billboard, rows)
│   └── layout.tsx      # Root layout with Navbar + Footer
├── components/
│   ├── player/         # Video player (hls.js + jassub integration)
│   ├── ui/             # Primitive UI components
│   ├── HeroBillboard.tsx
│   ├── MovieCard.tsx / MovieRow.tsx
│   ├── SearchBar.tsx / SearchResults.tsx
│   ├── RequestButton.tsx / RequestModal.tsx
│   ├── AvailabilityBadge.tsx
│   ├── ContinueWatchingSection.tsx
│   └── ...
└── lib/
    ├── tmdb.ts         # TMDB API client
    ├── radarr.ts       # Radarr API client
    ├── sonarr.ts       # Sonarr API client
    ├── jellyfin.ts     # Jellyfin auth + API client
    ├── stream.ts       # Streaming / playback helpers
    ├── cache.ts        # Server-side caching for Radarr/Sonarr collections
    ├── use-availability.ts  # SWR hook for availability status
    ├── vtt.ts          # Subtitle parsing
    └── env.ts          # Validated environment variables
```

## Deployment

### Build

```bash
npm run build
```

### Start production server

```bash
npm run start
```

All API keys stay server-side in route handlers — they are never exposed to the client. The app can be deployed to any Node.js host (Vercel, Railway, your Oracle VM, etc.).

Jellyfin, Radarr, and Sonarr must be network-reachable from wherever the Next.js app runs.

## License

Private — for personal/home-lab use.
