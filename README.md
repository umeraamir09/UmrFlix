<div align="center">

<img src="public/umrflix-logo.svg" width='300' />

</div>

UmrFlix is a self-hosted web app for discovering movies and TV, browsing a Jellyfin library, requesting titles through Radarr or Sonarr, and watching through Jellyfin. It brings those services together in a single Next.js interface. Turn your jellyfin deployment into a streaming service like website.

<div align="center">

<img src="public/preview.png" width="1000"/>

</div>

## Features

- **Catalog discovery:** browse trending titles, search TMDB-backed movie and TV catalogs, and explore genre and recommendation rows.
- **Library and availability:** browse Jellyfin media, see whether titles are available or still being requested, and continue watching where supported by the library.
- **Requests and progress:** send movie and series requests to configured Radarr and Sonarr instances and view queue progress.
- **Playback:** play Jellyfin media with HLS support, subtitle rendering for ASS/SSA, and audio-track selection.
- **Personal features:** keep a list, see personalized discovery rows, and join synchronized Watch Party sessions.

The app connects to services you configure; it does not include TMDB, Jellyfin, Radarr, Sonarr, or media files.

## How it fits together

| Service | Role in UmrFlix |
| --- | --- |
| [TMDB](https://www.themoviedb.org/) | Catalog and discovery data, requested directly from the TMDB API. |
| [Jellyfin](https://jellyfin.org/) | Sign-in, library information, and media playback. |
| [Radarr](https://radarr.video/) | Movie requests and queue information. |
| [Sonarr](https://sonarr.tv/) | Series requests and queue information. |
| PostgreSQL | Self-hosted app persistence using the Postgres service in `docker-compose.yml`; see the [deployment guide](docs/DEPLOY.md). |

## Technology

- **Application:** Next.js 16 App Router, React 19, and TypeScript
- **Styling and UI:** Tailwind CSS 4, custom components, and Lucide icons
- **Data fetching:** SWR
- **Playback:** `hls.js` and `jassub` for ASS/SSA subtitles
- **Tests and tooling:** ESLint, TypeScript, Vitest, Node test runner, and Playwright

## Run locally

### Prerequisites

- Node.js 20 or newer
- npm
- The external services and credentials for the features you plan to use. TMDB-backed catalog requests need a TMDB API key; Jellyfin is used for sign-in and playback, and Radarr/Sonarr are needed for their respective request integrations.

### Install and start

```bash
git clone https://github.com/umeraamir09/UmrFlix.git
cd UmrFlix
npm ci
cp .env.example .env
```

Edit `.env` and provide the values for the services you use. Keep credentials in this local file or your deployment's secret store—never commit real API keys, passwords, tokens, or `.env.local`.

Start Postgres and initialize the fresh schema, then start the development server:

```bash
docker compose up -d --wait postgres
npm run db:migrate
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). Postgres persists lists, avatars, requests, notifications, sessions, party snapshots, caches, and discovery signals. Without `DATABASE_URL`, file/memory development fallbacks remain available; with it configured, durable writes fail if the database is unavailable.

The server can start without every integration configured, but pages and actions that depend on a service need that service to be reachable and configured.

## Run with Docker Compose

Copy `.env.example` to `.env`, fill in your service credentials and Postgres
settings, then build and start the app:

```bash
docker compose up -d --build umrflix
```

The `umrflix` service uses the existing `media_internal` network and connects
to Jellyfin, Radarr, Sonarr, and qBittorrent by service name. Start those services
as needed (`docker compose up -d jellyfin radarr sonarr qbittorrent`). Postgres
starts automatically; `umrflix-migrate` applies the schema before the app starts.
Use HTTPS through your reverse proxy for production sign-in. See the
[Docker deployment guide](docs/DEPLOY.md#docker-hosting) for proxy setup and updates.

Docker settings in `.env`:

| Variable | Purpose |
| --- | --- |
| `UMRFLIX_DATABASE_URL` | Optional container database URL; defaults to `POSTGRES_*` credentials at `postgres:5432`. Supply a URL-encoded password here when needed. |
| `UMRFLIX_PORT` | Published host port, default `3000`. |
| `UMRFLIX_BIND_IP` | Published host address, default `127.0.0.1`; use `0.0.0.0` for LAN access. |

## Configuration

`.env.example` is the starting point for local configuration. These are the main integration and security settings; set only what applies to your deployment.

| Variable(s) | Purpose |
| --- | --- |
| `TMDB_API_KEY` | TMDB API key or API Read Access Token. Requests go directly to TMDB from the server; no Cloudflare Worker is required. |
| `JELLYFIN_URL`, `JELLYFIN_USERNAME`, `JELLYFIN_PASSWORD` | Jellyfin server and credentials used by the app. |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr connection for movie requests and queue information. |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr connection for series requests and queue information. |
| `OMDB_API_KEY` | Optional IMDb ratings enrichment; TMDB ratings are used when it is unset. |
| `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | Optional qBittorrent connection for the admin download view. |
| `DATABASE_URL` | Server-only Postgres connection URL. On the host use `127.0.0.1:5432`; inside `media_internal` use `postgres:5432`. |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Initialize the Compose Postgres service. Match these credentials in `DATABASE_URL`; URL-encode special characters in the password. |
| `WEBHOOK_SECRET` | Optional protection for `/api/webhooks`. When configured, webhook requests must include it in the `x-webhook-secret` header or `secret` query parameter. |
| `NOTIF_DEBUG` | Set to `1` for verbose notification logs. These logs can include user and admin IDs; leave it off in production. |
| `JELLYFIN_ENV_REAUTH`, `JELLYFIN_SERVER_ALLOWLIST` | Optional Jellyfin re-authentication control and comma-separated list of allowed custom server origins for login. |
| `ALLOW_PUBLIC_IMAGES` | `0` requires a session for images; `1` permits unauthenticated Jellyfin poster artwork. |
| `CSRF_INSECURE_CLIENTS_ALLOWED` | `0` enforces Origin/Referer checks on mutations; `1` permits insecure or non-browser clients. Keep the default unless you specifically need the alternate behavior. |
| `TRUSTED_PROXY`, `CLIENT_IP_HEADER` | Proxy/client-IP handling. The template enables use of a validated rightmost `X-Forwarded-For` value; an optional custom header can be configured. |

The sample file also contains a few optional or deployment-specific values. Review its comments and [the VPS deployment guide](docs/DEPLOY.md) before changing security or proxy settings. Do not treat every placeholder as a requirement for starting the development server.

## Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build. |
| `npm run db:migrate` | Initialize/update the Postgres schema safely, including on existing Docker volumes. |
| `npm run test:db` | Run Postgres integration tests in a disposable schema (requires `DATABASE_URL` and schema creation permission). |
| `npm run lint` | Run ESLint. |
| `npx tsc --noEmit` | Run the TypeScript check. |
| `npm run test:party` | Run Watch Party synchronization tests. |
| `npm run test:discovery` | Run discovery tests. |
| `npm run test:lib` | Run library and player logic tests. |
| `npm run test:components` | Run Vitest component tests. |
| `npm run test:e2e` | Run the Playwright end-to-end suite. |
| `npm run test:e2e:ui` | Open the Playwright UI runner. |
| `npm run test:visual` | Run the visual Playwright test. |
| `npm run penpot:verify -- --target <target>` | Verify a mapped target against the Penpot design when that setup is available. |
| `npm run penpot:sync` | Run the Penpot sync script. |

End-to-end and visual checks may need a running, configured app and the related authentication or design setup. See [CONTRIBUTING.md](CONTRIBUTING.md) for the project’s recommended checks and notes on environment-dependent tests.

## Repository layout

```text
src/
├── app/          Next.js pages and API route handlers
├── components/   Shared interface, player, and UI components
└── lib/          Service clients, authentication, discovery, playback, and app logic
src/lib/db/       Postgres pool, document stores, schema, and retention jobs
public/           Logos, icons, and player assets
docs/             Deployment and product/design documentation
e2e/              Playwright tests and visual baselines
scripts/           Penpot verification and sync scripts
```

## Deployment and contributor docs

- [Services deployment guide](docs/DEPLOY.md) — Deploy your own local instance of UmrFlix Media Server Stack.
- [Contributing guide](CONTRIBUTING.md) — local setup, checks, conventions, and pull-request guidance.
- [Code of Conduct](CODE_OF_CONDUCT.md) — project code of conduct

## License

UmrFlix is distributed under the [MIT License](LICENSE).
