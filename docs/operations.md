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

By default each suite (and each mutation worker) starts its own
Testcontainers Postgres. Locally you can run them all on one server
instead: start the compose Postgres
(`docker compose -f infra/compose.yaml up -d postgres`) and

```sh
export TEST_POSTGRES_URL=postgres://mychess:mychess@127.0.0.1:5432/postgres
```

`startTestDatabase` (`@mychess/db/testing`) then creates a fresh database
`test_<random hex>` on that server per suite, migrates it, and drops it when
the suite ends. The variable is optional; a value that is not a
`postgres://` URL is refused rather than ignored. CI does not set it and
keeps using containers.

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

### Migrations squashed before the first deployment

The S1 migrations were squashed on 2026-10-17, before any database was
deployed (#271): `0000` is the whole schema, `0001` the `admin_audit`
append-only trigger. A local compose database migrated before that date has
the old history and must be reset:
`docker compose -f infra/compose.yaml down -v && docker compose -f infra/compose.yaml up -d`,
then migrate as in step 3 above.

### Mail in tests (Mailpit, from S1)

Staging and production send with Resend; local runs and E2E use Mailpit.

1. `docker compose -f infra/compose.yaml up -d` starts Postgres and Mailpit
   (Mailpit's UI on http://localhost:8025).
2. Copy `apps/web/.env.example` to `apps/web/.env.local`.
3. `pnpm --filter @mychess/db migrate` applies the migrations.
4. `pnpm --filter @mychess/web dev` starts the app.

The app picks Mailpit with `MAIL_TRANSPORT=mailpit` and sends through
`MAILPIT_URL`'s `/api/v1/send`. E2E finds each test's mail by recipient
(`GET /api/v1/search?query=to:"addr"`, `apps/web/e2e/support/mailpit.ts`). If port
8025 is taken on your machine, run Mailpit on other ports and export
`MAILPIT_URL` (for example `http://localhost:18025`); Playwright passes it to
the app. CI's `e2e` job runs the same two images as
service containers on the same ports.

## Environments and sign-in (from S1)

Every deployment sets `MYCHESS_ENV`: `staging` on the staging project and
`production` on production (`local` is the default only off Vercel). On
Vercel the app refuses to start without it. Staging and production also need an https
`BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and a
`BETTER_AUTH_SECRET` of at least 32 random characters
(`openssl rand -base64 32`).

The persona sign-in route (`POST /api/test/sign-in`, R-73) is on only where
`MYCHESS_TEST_SIGNIN=1` and `TEST_SIGNIN_SECRET` are set and the environment is
not production: set them on staging only, never on production.

The admin CLI (`admin:grant`, `admin:disable`) keys the email hash in its
audit rows with `AUDIT_EMAIL_KEY` (R-94; at least 32 random characters,
`openssl rand -base64 32`) and refuses to run without it. Set it per
environment, never the same value on staging and production, and keep it
stable: rotating it breaks "was this email audited" lookups for older rows.

Sign-in rate limits are counted per client IP in the `rate_limits` table. The
app reads the IP from `x-real-ip`, then `x-forwarded-for`, which Vercel
overwrites with the real client address. Behind any other proxy or CDN these
headers would be client-controlled (or missing, putting everyone in one
bucket); configure Better Auth's trusted proxies before putting one in front.

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The staging deploy's smoke test (#234) can
call it.
