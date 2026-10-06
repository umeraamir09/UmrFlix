# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

# Package the same schema used by npm run db:migrate. No source bind mount
# is needed on the deployment host.
FROM postgres:16-alpine AS migrate
COPY src/lib/db/schema.sql /schema.sql
USER postgres
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["exec psql \"$DATABASE_URL\" --set=ON_ERROR_STOP=1 --file=/schema.sql"]

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
EXPOSE 3000
CMD ["node", "server.js"]
