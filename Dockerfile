# One runtime image from one build (ADR 0010): the Next.js server, and the
# database's bundled commands beside it in /app/db (migrate, the admin CLI,
# the rate-limit prune), run as another command of the same image. CI builds
# it natively on a GitHub-hosted arm64 runner (.github/workflows/ci.yml), the
# E2E suite runs against it, and the deploy ships those very bytes.
#
# The node tag is pinned exactly, matching .nvmrc; postgres:18.x
# (infra/compose/app.yml, packages/db/src/testing/database.ts,
# infra/host/backup-production.sh) and caddy:2.x.y (infra/edge/edge.yml) are
# bumped deliberately together with it.

FROM node:24.21.0-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json ./
# The pnpm version is the one package.json pins in packageManager.
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
# Every workspace package's manifest, so the install layer is cached until a
# dependency changes. A new package under packages/ is added here too.
COPY apps/web/package.json apps/web/
COPY packages/chess/package.json packages/chess/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r build

FROM node:24.21.0-slim AS app
# Debian security fixes the pinned node image has not picked up yet (the Trivy
# gate in ci.yml fails the release on a fixable CRITICAL one). Runs as root,
# before the USER switch and before any app file is copied, so the layer is
# cached until the base or the Debian archive moves.
RUN apt-get update \
  && apt-get -y --no-install-recommends upgrade \
  && rm -rf /var/lib/apt/lists/*
LABEL org.opencontainers.image.source=https://github.com/tomyka/mychess
# The host's docker-prune timer never removes a release image: the deploy
# keeps the last three for the rollback button (infra/ci/release-image.sh).
LABEL mychess.release=true
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# The commit this image is built from (CI passes the sha); /api/version names it
# and the production deploy compares it with the tag it deployed. Declared late
# so a new commit does not invalidate the layers above.
ARG APP_COMMIT=
ENV APP_COMMIT=$APP_COMMIT
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# The database's commands: each bundle finds ../migrations from its own file.
COPY --from=build /repo/packages/db/dist ./db/dist
COPY --from=build /repo/packages/db/migrations ./db/migrations
# The one directory the server writes at run time: Next's prerender and data
# cache. The standalone tree is root-owned, so without this mkdir fails with
# EACCES for `node`. It lives in the container's own layer and starts empty on
# every deploy, which is enough: the caches are rebuilt on demand.
RUN mkdir -p apps/web/.next/cache && chown node:node apps/web/.next/cache
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
