# Self-hosted Postgres setup

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
