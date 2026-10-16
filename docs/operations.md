# Operations

How mychess v2 is tested, built and run. Hosting decisions: `docs/adr/`;
rulings Q20, Q21, Q40 in `docs/owner-rulings.md`.

## Test suites

| Suite | Command | What it runs | Where it runs |
| --- | --- | --- | --- |
| unit | `pnpm test:unit` | domain and chess | gate (`node quality/gate.mjs check`) |
| db | `pnpm test:db` | packages/db against a Testcontainers Postgres | gate |
| component | `pnpm test:component` | apps/web components in jsdom | gate |
| feature | `pnpm test:feature` | apps/web route handlers and server actions (`apps/web/test/feature/`) against a Testcontainers Postgres from `@mychess/db/testing` | gate |
| e2e | `pnpm test:e2e` | Playwright (`apps/web/e2e/`), desktop Chromium and Pixel 7, against `next build` + `next start` on port 3100 | CI `e2e` job, outside the gate |

Feature and db suites need Docker. The Postgres image every suite uses is
`POSTGRES_IMAGE` in `packages/db/src/testing/database.ts`.

### Running E2E locally

1. Once per machine (and after a Playwright bump):
   `pnpm --filter @mychess/web exec playwright install chromium`.
2. `docker compose -f infra/compose.yaml up -d` starts Postgres and Mailpit.
3. `pnpm --filter @mychess/db build && pnpm --filter @mychess/db migrate`
   applies the migrations (with no `apps/web/.env.local`, export
   `DATABASE_URL=postgres://mychess:mychess@localhost:5432/mychess` first).
4. `pnpm test:e2e`. It builds the app and serves it on
   `http://127.0.0.1:3100`; a server already on that port is reused. The
   app's variables come from `webServer.env` in `apps/web/playwright.config.ts`:
   each defaults to the compose services when unset, and they win over
   `apps/web/.env.local`. The tests run one at a time (`workers: 1`): they
   share one Mailpit inbox and one database.

CI's `e2e` job does the same: the two images as service containers, the
migrate step, then `test:e2e` with the variables set on the job.

### Mail in tests (Mailpit, from S1)

Staging and production send with Resend; local runs and E2E use Mailpit.

1. `docker compose -f infra/compose.yaml up -d` starts Postgres and Mailpit
   (Mailpit's UI on http://localhost:8025).
2. Copy `apps/web/.env.example` to `apps/web/.env.local`.
3. `pnpm --filter @mychess/db migrate` applies the migrations.
4. `pnpm --filter @mychess/web dev` starts the app.

The app picks Mailpit with `MAIL_TRANSPORT=mailpit` and sends through
`MAILPIT_URL`'s `/api/v1/send`. E2E reads the newest message through
`GET /api/v1/message/latest`. CI's `e2e` job runs the same two images as
service containers on the same ports.

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The staging deploy's smoke test (#234) can
call it.
