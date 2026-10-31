# Operations

How mychess v2 is tested, built and run. Hosting decisions: `docs/adr/`
(ADR 0010); rulings R-164 to R-166 in `docs/owner-rulings.md`.

## Test suites

| Suite | Command | What it runs | Where it runs |
| --- | --- | --- | --- |
| unit | `pnpm test:unit` | domain and chess | gate (`node quality/gate.mjs check`) |
| db | `pnpm test:db` | packages/db against a Testcontainers Postgres | gate |
| component | `pnpm test:component` | apps/web components in jsdom | gate |
| feature | `pnpm test:feature` | apps/web route handlers and server actions (`apps/web/test/feature/`) against a Testcontainers Postgres from `@mychess/db/testing` | gate |
| e2e | `pnpm test:e2e` | Playwright (`apps/web/e2e/`), desktop Chromium and Pixel 7, against `next build` + `next start` on port 3100, or against `E2E_BASE_URL` when set | CI/CD `e2e` job against the release image, outside the gate |

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

CI/CD's `e2e` job (`.github/workflows/ci.yml`) runs the suite against the
release image instead: `infra/ci/e2e-stack.sh up` starts Postgres (in
memory), Mailpit and the image's web server (`infra/compose/app.yml` +
`e2e.yml`) and migrates; the job then sets `E2E_BASE_URL`, `MAILPIT_URL` and
`DATABASE_URL` to that stack, and `playwright.config.ts` starts no server of
its own when `E2E_BASE_URL` is set. Nothing is seeded: the tests make their
own accounts and data. The same works locally after a `docker build -t
mychess:local .`:

```sh
export APP_IMAGE=mychess:local E2E_WEB_PORT=3197  # any free port
export E2E_BASE_URL="$(infra/ci/e2e-stack.sh up mychess-e2e-local)"
export MAILPIT_URL="$(infra/ci/e2e-stack.sh mailpit mychess-e2e-local)"
export DATABASE_URL="$(infra/ci/e2e-stack.sh database mychess-e2e-local)"
pnpm test:e2e
infra/ci/e2e-stack.sh down mychess-e2e-local
```

The web port is fixed (default 3100) because the app's `BETTER_AUTH_URL`
must be the origin the browser uses.

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

Every deployment sets `MYCHESS_ENV`: `production` on the VM (`staging` was
the retired Vercel project's; `local` is the default only off Vercel). On
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
app reads the IP from `x-real-ip`, then `x-forwarded-for`. In production
Caddy is the only proxy (`infra/edge/caddy/Caddyfile`): it sets `X-Real-IP`
from the connection's address, and with no `trusted_proxies` it replaces any
`X-Forwarded-For` a client sends with that same address, so neither header
can be forged. Putting anything in front of Caddy (a CDN, another proxy)
would make them the proxy's address or client-controlled: configure Caddy's
`trusted_proxies` and Better Auth's trusted proxies before doing so.

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
`DATABASE_URL`. In production the same prune runs daily at 03:00 UTC from
the VM's `mychess-rate-limit-prune.timer` (`infra/host/rate-limit-prune.sh`)
calling `GET /api/cron/prune-rate-limits`, which answers
`200 {"pruned":<n>}` only to `Authorization: Bearer <CRON_SECRET>`, 401 to
anything else, and 404 where `CRON_SECRET` (at least 32 characters) is not
set. `apps/web/vercel.json` holds the same schedule for the Vercel staging
project until it is retired. Daily, not hourly: a late prune only lets dead
rows wait longer (owner, 2026-10-31). A new limit with a longer window, or a Better
Auth upgrade that changes its built-in windows, must update those constants
(#262).

## Production on the Oracle VM (ADR 0010, #310)

Production runs on one Oracle Cloud A1 VM (arm64, 1 OCPU, 6 GB, Ubuntu
24.04, eu-stockholm-1), host name `mychess`, formerly sportbet-ci. Its
primary network card is private; the public address 129.151.205.113 belongs
to a second VNIC (`enp1s0`, 10.0.0.233), kept answering by
`infra/host/public-nic.sh` and `public-nic-keep.sh`. On it:

- Caddy (`infra/edge/`, compose project `mychess-edge`): TLS from Let's
  Encrypt, reverse proxy to the web container.
- The app (`infra/compose/app.yml` + `production.yml`, project
  `mychess-production`): Postgres 18.6 on the named volume `pgdata`, the web
  server from the one image (`Dockerfile`), and the one-shot `migrate` and
  `admin` tasks from the same image.
- systemd timers: the nightly backup with its restore test, its morning
  watch, the rate-limit prune, a docker prune and the runner watchdog.
- One GitHub Actions runner registered to `tomyka/mychess` with label
  `production`, used only by deploys (R-165).

Files on the host: `/srv/mychess/production/` (compose files, the root-only
`.env`, `deployed-tag`), `/srv/mychess/edge/`, `/srv/mychess/backups/`
(root only), `/srv/mychess/backup-status.json`, and the root-only
`/etc/mychess/` (`backup.env`, `alert.env`, `runner-watchdog.env`).

### The domain: one setting

The site's name is `BETTER_AUTH_URL` in `/srv/mychess/production/.env`,
written by `production-env.sh <https url>`. The deploy derives Caddy's
domain (`APP_DOMAIN`, read by the Caddyfile as `{$APP_DOMAIN}`) and the
release check's host from it, and the rate-limit prune its URL. GitHub
reads the same URL from the repository variable `PRODUCTION_URL` (the
environment's link, the deploy button's live check, `uptime.yml`, which is
skipped while it is unset). Changing the domain: DNS first, then
`production-env.sh <new url>`, `PRODUCTION_URL`, the Google OAuth redirect
URI, the Resend sending domain and `MAIL_FROM`, then a deploy.

### The pipeline

`.github/workflows/ci.yml` (CI/CD) runs on every push: `check` (the quality
gate, the kit's tests, the infra shell tests, the secret scan; GitHub-hosted)
and `image` (`docker build` on `ubuntu-24.04-arm`, Trivy, the image saved as
a zstd archive artifact kept 3 days) in parallel, then `e2e` (the Playwright
suite against that archive's image, as above). On `main` only, `deploy` runs
on the VM's runner: an older commit never replaces a newer deployed one,
then `sudo -n infra/ci/deploy-production.sh <sha>-arm64 <archive> <sha256>`:

1. load the archive, refusing any other bytes than the build's (sha256);
2. copy the compose and Caddy files to `/srv/mychess`, start the edge and
   reload Caddy;
3. start Postgres, dump a restore point (`/srv/mychess/backups/predeploy-*`,
   the newest 14 kept; a failed dump stops the deploy);
4. migrate (`docker compose run --rm migrate`);
5. replace web and wait for its healthcheck;
6. verify through Caddy (`curl --resolve <domain>:443:127.0.0.1`):
   `/api/version` names the commit, `/` and `/prisijungti` end in 200;
7. on a failure at 5 or 6, put the previous release's web back and fail;
8. record `deployed-tag` and keep only the newest 3 release images.

`quality.yml` (protected) runs the gate again on pull requests only.

### Rollback and redeploy

The rollback button is `.github/workflows/deploy-production.yml` (Actions >
Deploy production > Run workflow, on `main`). Empty, it redeploys main's
head; with a full SHA, that earlier commit. It refuses a commit outside
main's history or without a green CI/CD run (check, image and e2e), runs
the same deploy script with the image already on the VM (the last 3
releases), and checks that `PRODUCTION_URL` then serves that commit. A
migration is never undone: rolling back across a schema change needs the
restore point (below). The same button with an empty SHA is how a changed
host setting (`set-secret.sh`) reaches the running web.

By hand on the host, from the runner's checkout:
`sudo /opt/actions-runner/_work/mychess/mychess/infra/ci/deploy-production.sh <tag>`.

### Setting up the VM, in order

Host steps (lead, with the owner's yes for each change to the host):

1. sportbet's CI has left the VM (sportbet_new's own work: its runner,
   containers, volumes, units, users, `/srv/sportbet-new`, `/etc/sportbet`
   removed; the sportbet public-NIC units are replaced in step 3).
2. `scp -r infra/host mychess:/tmp/mychess-host`, then in tmux
   `sudo bash /tmp/mychess-host/bootstrap.sh` (packages, host name, Docker,
   the `runner` user, directories, firewall 80/443, the timers).
3. `sudo bash /tmp/mychess-host/public-nic.sh enp1s0 10.0.0.233 10.0.0.1
   2603:c026:301:3100:0:432e:8ecb:4fd1 fe80::200:17ff:feed:3597`, then at
   once `sudo bash /tmp/mychess-host/public-nic-keep.sh` (they replace
   sportbet's copies; check the addresses with `ip addr` first).
4. `sudo bash /tmp/mychess-host/production-env.sh https://<domain>`.
5. The owner's secrets, each from the clipboard through stdin
   (`set-secret.sh RESEND_API_KEY`, `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET`, `LICHESS_CLIENT_ID`); the deploy refuses to
   start until all four are there.
6. Runner: a registration token piped into
   `install-runner.sh <version> <sha256>` (it also writes the sudoers rule
   for exactly the deploy script), then `install-runner-watchdog.sh
   production` with an Actions-read token.
7. Backups: `set-backup-par.sh` with the PAR URL (enables the nightly
   timer), `set-alert-email.sh` with the owner's address (enables the
   watch), then `sudo mychess-backup-alert --test`.
8. `sudo bash /tmp/mychess-host/bootstrap.sh` once more enables the
   rate-limit prune timer now that the `.env` exists.

Owner steps:

- the domain and its DNS A record to 129.151.205.113 (before the first
  deploy: Caddy asks Let's Encrypt for the certificate the moment it loads
  the name, and failed attempts count against its rate limit);
- optionally, the instance's name `mychess` in the OCI console;
- an Object Storage bucket and a write-only ("Permit object writes")
  pre-authenticated request for it;
- the Google OAuth client's redirect URI
  `https://<domain>/api/auth/callback/google` and a Lichess client id;
- the Resend sending domain for `noreply@<domain>`;
- the GitHub `production` environment and the repository variable
  `PRODUCTION_URL=https://<domain>`;
- `quality.yml` changed to pull requests only (it is protected);
- for Dependabot's lockfile job, the Dependabot secret
  `LOCKFILE_PUSH_TOKEN` (optional).

Then the first deploy (a push to `main`, or Actions > CI/CD > Run workflow
on main), a smoke check of the site, and the retirement below.

### The admin CLI on the host

```sh
cd /srv/mychess/production
sudo env APP_IMAGE="mychess:$(cat deployed-tag)" docker compose -p mychess-production \
  --env-file .env -f app.yml -f production.yml run --rm admin db/dist/admin-grant.mjs <email>
```

`admin-disable.mjs` the same way. `AUDIT_EMAIL_KEY` comes from the `.env`
(written once by `production-env.sh`, never rotated).

### Backups and restoring one

Every night at 02:37 UTC `mychess-production-backup` dumps the database,
restores the dump into a throwaway Postgres and compares every table's row
count, uploads it through the write-only PAR to
`mychess/production/production-<time>.dump`, keeps the newest 7 in
`/srv/mychess/backups` and writes `/srv/mychess/backup-status.json`. A
failure mails the owner through Resend (`mychess-backup-alert`), and at
07:00 UTC `mychess-backup-watch` mails again while the status is failed,
missing or older than 26 hours. Each deploy adds a `predeploy-*` dump.

The restore drill (monthly, and before trusting a new host):
`sudo mychess-production-backup --dry-run` dumps and restores into a
throwaway container without uploading anything.

Restoring production from a dump (a local `production-*.dump` or
`predeploy-*.dump`, or one downloaded from the bucket in the OCI console
and copied to the host):

```sh
cd /srv/mychess/production
compose() { sudo env APP_IMAGE="mychess:$(cat deployed-tag)" docker compose -p mychess-production \
  --env-file .env -f app.yml -f production.yml "$@"; }
compose stop web
sudo docker exec -i mychess-production-postgres-1 \
  pg_restore -U mychess -d mychess --clean --if-exists --no-owner --exit-on-error < <dump>
compose up -d --wait web
```

A dump older than the running release's migrations needs that older
release too: redeploy the commit the dump was taken under (its tag is in a
`predeploy-*` file's name) with the deploy button, then restore.

### Vercel staging: retired after the first production deploy

Until production is live, the Vercel project `mychess-staging` (team
tomykas-projects) still deploys `main` with its Neon database (ADR 0009,
superseded). Once the first production deploy is smoke-checked it is
retired with its Neon store and `apps/web/vercel.json` (R-166); persona
testing then runs locally against the persona seeds.

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The web container's healthcheck calls it.
`GET /api/version` answers `{"commit":"<sha>"}`, the commit the image was
built from (`null` where the build named none); the deploy's release check,
the deploy button and `uptime.yml` compare it.
