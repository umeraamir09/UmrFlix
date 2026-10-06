# Docker hosting

The repository includes a multi-stage production Dockerfile and an `umrflix`
service in the existing Compose stack. The final image runs the Next.js
standalone server as a non-root user. Build inputs exclude local environment
files, database/media data, and host dependencies; credentials are passed at
runtime from `.env`.
The homepage renders on request so TMDB/Jellyfin credentials are read after
the container starts rather than freezing an empty homepage during the build.

1. Copy `.env.example` to `.env` and configure Postgres, TMDB, and integration
   credentials. Keep `DATABASE_URL` for host development. Docker derives its
   own URL from `POSTGRES_*`, using the `postgres` service hostname. If the
   password contains URL-reserved characters, set `UMRFLIX_DATABASE_URL` with
   the encoded password and matching database/user. The Compose app overrides
   integration URLs with `jellyfin:8096`, `radarr:7878`, `sonarr:8989`, and
   `qbittorrent:8080`. Edit these service environment entries if your services
   run elsewhere.
2. Start the integrations you use, or keep your existing running stack:

   ```bash
   docker compose up -d jellyfin radarr sonarr qbittorrent
   ```

3. Build and start UmrFlix:

   ```bash
   docker compose up -d --build umrflix
   docker compose ps -a umrflix umrflix-migrate postgres
   docker compose logs --tail=100 umrflix umrflix-migrate
   ```

   Compose waits for healthy Postgres, runs the one-shot `umrflix-migrate`
   container against the same schema used by `npm run db:migrate`, and starts
   UmrFlix only after it succeeds. An exited migration container with status 0
   is expected. No Node/npm installation on the deployment host is needed.

4. Route your HTTPS domain through a reverse proxy to port 3000. Production
   sessions use Secure cookies; plain HTTP on a remote/LAN address cannot be
   used for production sign-in.

## Reverse proxy

By default port 3000 binds to `127.0.0.1` for a proxy running on the host. Set
`UMRFLIX_PORT` to change the host port or `UMRFLIX_BIND_IP=0.0.0.0` for LAN
access. HTTPS is still needed for sign-in.

For Nginx Proxy Manager in Docker, uncomment the `npm_proxy` network definition
and the `npm_proxy` membership under `umrflix`, and set `NPM_NETWORK_NAME` to
the proxy's existing network name. Configure a Proxy Host with forward scheme
`http`, hostname `umrflix`, port `3000`, and an SSL certificate. You can remove
the app's `ports` entry when the proxy connects over this network.

Preserve the public Host and scheme headers, and disable buffering for event
streams (notifications and Watch Party). For Nginx/NPM, use these directives
in the app's proxy location / NPM Advanced configuration:

```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;
```

Leave `CSRF_INSECURE_CLIENTS_ALLOWED=0`. Enable `TRUSTED_PROXY=1` when access
comes through your trusted proxy; use `0` for direct access. Configure
Radarr/Sonarr webhooks to reach `http://umrflix:3000/api/webhooks` on
`media_internal`, supplying `WEBHOOK_SECRET` as documented in `.env.example`.

## Updates and persistence

After pulling new code, rebuild both images and rerun migrations before
recreating the app. This explicitly recreates the migration container even
when an earlier run completed successfully:

```bash
docker compose build umrflix umrflix-migrate
docker compose up -d --wait postgres
docker compose stop umrflix
docker compose up -d --force-recreate umrflix-migrate umrflix
```

If migration fails, resolve the database error before starting the app. Back up
Postgres before updates. App records and sessions live in the existing
`config/postgres` volume; UmrFlix needs no media/download bind mounts. The
image cache is disposable and can be rebuilt after container recreation.
Keep one UmrFlix instance: live Watch Party membership requires a single Node
process. Restarting the container disconnects streams; persisted party snapshots
provide recovery.

## Self-hosted Postgres setup (host development)

The `postgres` service in `docker-compose.yml` runs PostgreSQL 16 and stores its data in `config/postgres`. Port 5432 is bound to localhost. Containers on `media_internal` can connect using the `postgres` hostname.

1. Copy `.env.example` to `.env` and set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB`. Set `DATABASE_URL` to the matching credentials, for example `postgresql://umrflix:your-password@127.0.0.1:5432/umrflix`. URL-encode special characters in the password. Use `postgres` instead of `127.0.0.1` if the app runs in a container on the Compose network.
2. Start the service and wait for it to be healthy:

   ```bash
   docker compose up -d --wait postgres
   ```

3. Install dependencies and initialize the app schema:

   ```bash
   npm ci
   npm run db:migrate
   ```

4. Configure Jellyfin, TMDB, Radarr, and Sonarr as needed, then run `npm run dev`, or `npm run build` followed by `npm run start` for production.

Next.js and `db:migrate` load `.env.local` before `.env`. If an existing `.env.local` defines `DATABASE_URL`, update that value as well. Keep all connection URLs and credentials server-side; do not use a `NEXT_PUBLIC_` database variable.

A brand-new Postgres volume also initializes automatically from the Compose-mounted `src/lib/db/schema.sql`. Existing volumes do not rerun Docker entrypoint initialization, so run `npm run db:migrate` after pulling schema changes. This command is idempotent and does not copy any old backend data. Tables use the `umrflix_` prefix to avoid collisions with other schemas already in the database. Each feature stores its app documents in JSONB with primary keys, unique natural-key indexes, and GIN indexes for scoped lookups.

Compose's `POSTGRES_*` settings only create users/passwords/databases when the volume is empty. Changing those values later does not change an existing database's credentials. Use the credentials originally used to initialize that volume.

The app shares one connection pool per Node process. Within the running process, retention cleanup runs every six hours: cache records older than seven days, discovery events older than 90 days, and expired sessions are removed. Discovery counters and serve logs use transactions to prevent lost concurrent updates. File/memory fallback is for development with `DATABASE_URL` unset; configured database failures propagate for durable user data rather than creating a second local store.

Watch Party still requires one Node process (for example PM2 fork mode with one instance). Live synchronization and room membership stay in memory; Postgres snapshots provide restart recovery. Hydrated playback timelines are rebased to the time of loading.

Run `npm run test:db` against a reachable Postgres instance to verify persistence, user isolation, expiration, concurrent counters, rollback, and retention. The suite creates and drops a unique temporary schema and requires permission to create schemas; it does not modify application tables.
