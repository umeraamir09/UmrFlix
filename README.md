# UmrFlix

![UmrFlix logo](public/logo_header.png)

UmrFlix is a self-hosted web app for discovering movies and TV, browsing a Jellyfin library, requesting titles through Radarr or Sonarr, and watching through Jellyfin. It brings those services together in a single Next.js interface.

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
| [TMDB](https://www.themoviedb.org/) | Catalog and discovery data, requested through a configured proxy. |
| [Jellyfin](https://jellyfin.org/) | Sign-in, library information, and media playback. |
| [Radarr](https://radarr.video/) | Movie requests and queue information. |
| [Sonarr](https://sonarr.tv/) | Series requests and queue information. |
| Convex (optional) | Self-hosted persistence for supported app data; see the [deployment guide](docs/DEPLOY_VPS.md). |

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
- The external services and credentials for the features you plan to use. TMDB-backed catalog requests use a Cloudflare Worker proxy; Jellyfin is used for sign-in and playback, and Radarr/Sonarr are needed for their respective request integrations.

### Install and start

```bash
git clone https://github.com/umeraamir09/UmrFlix.git
cd UmrFlix
npm ci
cp .env.example .env.local
```

Edit `.env.local` and provide the values for the services you use. Keep credentials in this local file or your deployment's secret store—never commit real API keys, passwords, tokens, or `.env.local`.

Start the development server:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000). The server can start without every integration configured, but pages and actions that depend on a service need that service to be reachable and configured.

## Configuration

`.env.example` is the starting point for local configuration. These are the main integration and security settings; set only what applies to your deployment.

| Variable(s) | Purpose |
| --- | --- |
| `TMDB_PROXY_URL`, `TMDB_PROXY_SECRET` | Cloudflare Worker URL and shared secret for TMDB requests. The secret is sent in the `X-Proxy-Secret` header. |
| `JELLYFIN_URL`, `JELLYFIN_USERNAME`, `JELLYFIN_PASSWORD` | Jellyfin server and credentials used by the app. |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr connection for movie requests and queue information. |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr connection for series requests and queue information. |
| `OMDB_API_KEY` | Optional IMDb ratings enrichment; TMDB ratings are used when it is unset. |
| `QBITTORRENT_URL`, `QBITTORRENT_USERNAME`, `QBITTORRENT_PASSWORD` | Optional qBittorrent connection for the admin download view. |
| `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY` | Optional self-hosted Convex connection. The deployment guide describes the file-based fallback and additional URL configuration. |
| `WEBHOOK_SECRET` | Optional protection for `/api/webhooks`. When configured, webhook requests must include it in the `x-webhook-secret` header or `secret` query parameter. |
| `NOTIF_DEBUG` | Set to `1` for verbose notification logs. These logs can include user and admin IDs; leave it off in production. |
| `JELLYFIN_ENV_REAUTH`, `JELLYFIN_SERVER_ALLOWLIST` | Optional Jellyfin re-authentication control and comma-separated list of allowed custom server origins for login. |
| `ALLOW_PUBLIC_IMAGES` | `0` requires a session for images; `1` permits unauthenticated Jellyfin poster artwork. |
| `CSRF_INSECURE_CLIENTS_ALLOWED` | `0` enforces Origin/Referer checks on mutations; `1` permits insecure or non-browser clients. Keep the default unless you specifically need the alternate behavior. |
| `TRUSTED_PROXY`, `CLIENT_IP_HEADER` | Proxy/client-IP handling. The template enables use of a validated rightmost `X-Forwarded-For` value; an optional custom header can be configured. |

The sample file also contains a few optional or deployment-specific values. Review its comments and [the VPS deployment guide](docs/DEPLOY_VPS.md) before changing security or proxy settings. Do not treat every placeholder as a requirement for starting the development server.

## Project scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build. |
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
convex/           Convex schema and functions
public/           Logos, icons, and player assets
docs/             Deployment and product/design documentation
e2e/              Playwright tests and visual baselines
scripts/           Penpot verification and sync scripts
```

## Deployment and contributor docs

- [VPS deployment guide](docs/DEPLOY_VPS.md) — PM2, Nginx Proxy Manager, and optional self-hosted Convex notes.
- [Personalization design document](docs/PERSONALIZATION.md)
- [Contributing guide](CONTRIBUTING.md) — local setup, checks, conventions, and pull-request guidance.
- [Code of Conduct](CODE_OF_CONDUCT.md) — **draft for maintainer review; it is not an adopted project policy.**

## License

UmrFlix is distributed under the [MIT License](LICENSE).
