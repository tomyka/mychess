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

**On the owner's machine** (S3/S4 retro) other projects often hold the
default ports: port 3100 may be another app's `next start` (which
Playwright would reuse), 8025 another Mailpit, and the compose
`infra-mailpit-1` can stay in "Created". Then:

- run a throwaway Mailpit on another port and point the app at it:
  `docker run -d --name mychess-qa-mailpit -p 127.0.0.1:18025:8025 axllent/mailpit:v1.27`,
  `MAILPIT_URL=http://127.0.0.1:18025` (the app sends through Mailpit's HTTP
  API, so no SMTP port is needed);
- serve the app on a free port (for example 3101) through a scratch
  Playwright config that imports `apps/web/playwright.config.ts` and
  overrides only the port, never by editing the repo config;
- while teammates have uncommitted work in the main checkout, run E2E
  against a clean `git archive HEAD` copy in a scratch folder (no git
  worktree, no `node_modules` junction);
- afterwards delete the `e2e-*@mychess.test` accounts (they cascade), stop
  the server and remove the Mailpit container.

### Migrations squashed before the first deployment

The S1 migrations were squashed on 2026-10-17, before any database was
deployed (#271): `0000` is the whole schema, `0001` the `admin_audit`
append-only trigger. A local compose database migrated before that date has
the old history and must be reset:
`docker compose -f infra/compose.yaml down -v && docker compose -f infra/compose.yaml up -d`,
then migrate as in step 3 above.

### A composite foreign key onto a new unique key (drizzle-kit order)

When one schema change adds a unique key and a composite foreign key that
points at it, drizzle-kit 0.31 writes the foreign key first and Postgres
refuses the migration ("there is no unique constraint matching given
keys"). Generated migrations are never hand-edited, so generate twice:
first the schema with only the unique key (`pnpm --filter @mychess/db
db:generate`), then the rest. That is why 0004/0005 and 0006/0007 come in
pairs. Delete an uncommitted generated pair (SQL, snapshots, journal
entries) before regenerating it.

### Replacing a primary key (drizzle-kit gap)

drizzle-kit 0.31 cannot name a primary key it drops: it writes the `DROP
CONSTRAINT` commented out, with a placeholder, and asks for the name. The
one exception to "never hand-edited" is completing that line in the
freshly generated, uncommitted file with the real name (Postgres names a
column-level key `<table>_pkey`), as in 0011 (`review_results`). A wrong
name fails every db test, which migrates from scratch.

### Mail in tests (Mailpit, from S1)

Staging and production send with Resend; local runs and E2E use Mailpit.

1. `docker compose -f infra/compose.yaml up -d` starts Postgres and Mailpit
   (Mailpit's UI on http://localhost:8025).
2. Copy `apps/web/.env.example` to `apps/web/.env.local`.
3. `pnpm --filter @mychess/db migrate` applies the migrations.
4. `pnpm --filter @mychess/web dev` starts the app.

If another project's container already holds port 8025, compose starts
Mailpit with no published ports and every magic link fails with a 500
(`fetch failed` to `:8025`). Check `docker ps` first; if 8025 is taken,
start Mailpit with a compose override that publishes `127.0.0.1:8026:8025`
and set `MAILPIT_URL=http://localhost:8026` in `.env.local`. E2E reads
`MAILPIT_URL` too (S5).

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
not production: set them on staging only, never on production. A production
deployment with `MYCHESS_TEST_SIGNIN` on refuses to start (#268).

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

A magic link is also limited per inbox: at most 5 an hour, whichever client
asks, counted whether or not an account has the address
(`MAGIC_LINK_EMAIL_RATE_LIMIT`, #264). The inbox is the canonical email
without any `+suffix` in its local part, so `a+1@x` and `a+2@x` share one
count. This bounds the mail one inbox (and the Resend quota) can be sent from
many client addresses; a refused request gets a 429 as the per-IP limit does
and mails nothing.

Training results (`POST /api/training/results`, S6) have two limits per
account, both a minute long: at most 120 batches (`TRAINING_RATE_LIMIT`,
counted before the body is read; the browser posts once per answer) and at
most 600 results (`TRAINING_RESULTS_RATE_LIMIT`, counted after the batch
parses, each batch as its length), so a few large batches cannot carry more
than many small ones. Either refusal is a 429 with
`training.tooManyResults`, and the browser keeps its queue to resend later.
A body declared over 256 KB is refused unread with a 413.

The per-inbox magic-link limit, the PGN import's and the training limits
are our own counters, in the `request_counters` table, keyed by a SHA-256
hash of the inbox or by the account id. The hash is unsalted, so a guessed
address can be matched to its row; rows last at most an hour (the prune below). They are not in `rate_limits`: Better Auth
deletes its rows older than its own longest window (a minute) whenever one of
its keys opens a new window, which would cut our hour short.

Both tables grow: `rate_limits` with every new client address, and
`request_counters` with every new inbox and importing account. `pnpm
--filter @mychess/db rate-limits:prune` (after `pnpm --filter @mychess/db
build`) deletes the rows that can no longer decide a request: `rate_limits`
rows whose last request is older than `BETTER_AUTH_RETENTION_MS` (a minute)
and `request_counters` rows whose window opened longer ago than
`REQUEST_COUNTER_RETENTION_MS` (an hour), both in
`packages/db/src/rate-limits.ts`. It prints `rate-limits: pruned <n>`, the
two tables together. Deleting them changes no limit decision. It needs only
`DATABASE_URL`; run it from a scheduled job (hourly is plenty) once staging
and production exist (#234). A new limit with a longer window, or a Better
Auth upgrade that changes its built-in windows, must update those constants
(#262).

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The staging deploy's smoke test (#234) can
call it.
