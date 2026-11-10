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

Production sends with Resend; local runs and E2E use Mailpit.

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

`MYCHESS_ENV` is `local` or `production`; any other value, `staging`
included, stops the app at start-up (there is no staging, R-166). It fails
closed (security N1): under a production build (`NODE_ENV=production`, as
`next start` and the image set it) the app refuses to start without it;
only `next dev` and the tests default an unset value to `local`. Everything
that starts a production build names it: `infra/compose/production.yml`
sets `MYCHESS_ENV: production` as a literal, whatever the VM's `.env` says,
and `infra/compose/e2e.yml`, `quality.yml` and `playwright.config.ts` set
`local`. `next build` does not read it. Production also needs
an https `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`;
every environment needs a `BETTER_AUTH_SECRET` of at least 32 random
characters (`openssl rand -base64 32`).

The persona sign-in route (`POST /api/test/sign-in`, R-73) is on only where
`MYCHESS_TEST_SIGNIN=1` and `TEST_SIGNIN_SECRET` are set and the environment is
not production: set them locally only (see "Local persona stack"), never
on production. A production deployment with `MYCHESS_TEST_SIGNIN` on refuses
to start (#268), and production's compose file never passes either.

The admin CLI (`admin:grant`, `admin:disable`) keys the email hash in its
audit rows with `AUDIT_EMAIL_KEY` (R-94; at least 32 random characters,
`openssl rand -base64 32`) and refuses to run without it. Set it per
environment, never the same value locally and in production, and keep it
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
set. Daily, not hourly: a late prune only lets dead
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
  `production`, used only by deploys (R-165). What keeps a fork's code off
  it: no workflow a pull request can start asks for that label, and the
  repository requires approval of workflow runs for all external
  contributors. The runner itself refuses nothing yet (follow-up: a
  job-started hook that accepts only this repository's `main`). It must stay the only one:
  it runs one job at a time, which is what keeps two deploys, or a deploy
  and a rollback, from interleaving.

Files on the host: `/srv/mychess/production/` (compose files, the root-only
`.env`, `deployed-tag` (the release that runs), `confirmed-tag` (the newest
release whose check and e2e passed: the automatic rollback's target),
`.deploy.lock`), `/srv/mychess/edge/`, `/srv/mychess/backups/`
(root only), `/srv/mychess/logs/` (failed webs' logs, root only),
`/srv/mychess/backup-status.json`, and the root-only
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
suite against that archive's image, as above). `quality.yml` runs the gate
again on pull requests (and on pushes to main until the owner's pending
change below; it is not part of the deploy).

On `main`, during the development phase (R-192), the image goes to
production as soon as it is built and scanned, about 2-3 minutes after the
push, while `check` (~14 minutes) and `e2e` (~10 minutes) still run:

```text
check ----------------------------------+--> verdict             (on trial)
image --+--> e2e -----------------------+
        +--> deploy (VM) ---------------+--> deploy-after-tests  (held)
```

1. `deploy` (the VM's runner) decides with `infra/ci/release-decision.sh`:
   - **skip** when production already runs this commit or a newer one (an
     older commit never replaces a newer one);
   - **hold** when `packages/db/migrations`, `infra/ci`, `infra/compose`,
     `infra/edge` or `.github/workflows/ci.yml` (the verdict and rollback
     logic) differs between the release that runs and this commit, or
     no known release runs (`deployed-tag` missing): a schema change, deploy
     script, compose or Caddy file never goes out before its tests, so an
     automatic rollback (which runs the trial commit's own deploy script)
     never runs a failed trial's infra;
   - otherwise **deploy on trial**:
     `sudo -n infra/ci/deploy-production.sh --on-trial <sha>-arm64 <archive> <sha256>`.
2. `verdict` (VM, after `check` and `e2e`, for a commit planned for a
   trial, or whenever `deploy` failed or was cancelled): all passed records
   it in `confirmed-tag`; check or e2e failed or cancelled redeploys the
   confirmed release (`--roll-back`); a trial deploy cut short before it
   recorded itself redeploys the release on record (`--restore`), since its
   web may be half swapped; only when the plan was a trial (a held or
   skipped commit's verdict touches nothing) and never for a commit that
   changes a gated path (`--restore` runs that commit's deploy script as
   root): that case is `stranded`, red, and names the button. Anything but all passed ends the run red (below).
   The plan step fails on an empty or unknown plan.
3. `deploy-after-tests` (VM, only for a held commit): once `check` and `e2e`
   pass, deploys it as before R-192, unless production runs it or a newer
   commit by then. A failed check or e2e leaves production untouched.

Every deploy, whichever job or the button starts it, is the same script:

1. load the archive, refusing any other bytes than the build's (sha256);
2. copy the compose and Caddy files to `/srv/mychess`, start the edge and
   reload Caddy;
3. start Postgres, dump a restore point (`/srv/mychess/backups/predeploy-*`,
   the newest 14 kept; a failed dump stops the deploy);
4. migrate (`docker compose run --rm migrate`);
5. replace web and wait for its healthcheck;
6. verify through Caddy (`curl --resolve <domain>:443:127.0.0.1`):
   `/api/version` names the commit, `/` and `/prisijungti` end in 200;
7. on a failure at 5 or 6, keep the failed web's log on the host
   (`/srv/mychess/logs/web-*.log`, root only, the newest 20; it can name
   users, and the Actions log is public: the job log prints only its path),
   put the previous release's web back and fail;
8. record `deployed-tag` (and `confirmed-tag`, except on trial) and keep
   only the newest 3 release images plus the running, previous and
   confirmed ones.

On `main` no CI job is cancelled by a newer push (each run is its own
concurrency group), so every commit that went out gets its own verdict; on
other branches a newer push cancels the superseded run. The production jobs
take no concurrency group (GitHub cancels a group's pending job when a newer
one queues, which could drop a rollback); the VM's one runner and the
script's lock serialise them.

### When check or e2e fails after a deploy

The `verdict` job runs `deploy-production.sh --roll-back <failed>-arm64`,
which, under the deploy lock, re-reads `deployed-tag` (and does nothing if
production no longer runs the failed commit) and `confirmed-tag`, then
redeploys the confirmed release with its image already on the VM (the
button's path); the job fails, so the run is red. `--confirm` likewise
refuses, under the lock, a release that does not hold the confirmed one
(never backwards, never off main's line after a force-push). It is the web only: a trial deploy
never carries a migration (those are held), so the schema is the confirmed
release's too, and the database is not restored, because that would throw
away what users wrote in the meantime. The trial's `predeploy-*` dump is
there if the owner decides otherwise (restore below).

The target is the newest *confirmed* release, not simply the one that ran
before: with two quick pushes A then B, B's predecessor is A, which may be
the very commit that failed. Overlapping runs are settled by
`release-decision.sh`'s `verdict`, whatever order they finish in:

| Production runs | This commit's check and e2e | Verdict |
| --- | --- | --- |
| this commit | passed | confirm it |
| a newer commit holding this one | passed | confirm it (a better rollback target for the newer one), unless a newer one is confirmed already |
| this commit | failed or cancelled | roll back to `confirmed-tag` |
| a newer commit | failed or cancelled | leave it: the newer commit contains this one, and its own run confirms or rolls back |
| an older commit (already rolled back, or the button) | either | leave it |
| this commit, nothing confirmed before it | failed | `stranded`: the run is red and names the button |
| the release before (the trial deploy was cut short) | any | `restore`: redeploy the release on record; `stranded` if this commit changes a gated path |
| any (the plan was `hold` or `skip`) | any | leave it: no trial to judge |
| a newer commit (the trial deploy was cut short) | any | leave it: that deploy replaced the web |

So a rollback never undoes a newer push that already deployed, and never
goes to an untested commit. A commit whose `check` or `e2e` fails on a
flake: re-run the failed jobs; if they pass the run goes green but
production stays on the rollback, so redeploy main's head with the button.

How to see one: the run is red, its `verdict` job carries an error
annotation ("rolling production back from <sha> to <sha>") and a job
summary saying what it did; `cat /srv/mychess/production/deployed-tag
confirmed-tag` on the host, or `curl $PRODUCTION_URL/api/version`, shows
the commit that serves. The environment's Deployments list shows only the
deploys (`deploy`, `deploy-after-tests`, the button), not rollbacks.

Why the hold covers `infra/ci`, `infra/compose`, `infra/edge` and `ci.yml` too: the
rollback runs the deploy script from the failed commit's checkout and copies
that commit's compose and Caddy files; with those unchanged since the
confirmed release, it puts back exactly what ran before. `infra/host` is not
deployed by a deploy and does not hold.

A destructive migration (a dropped column or table, a rename, a type
change) is never deployed before its tests, by the hold above; but once a
migration is live, rolling the web back below it (the button) runs older
code on the newer schema. Write migrations expand-then-contract: add in one
commit, switch the code, drop in a later commit once nothing reads the old
shape, so the release before each one still works on its schema
(recommended with #352; not yet an owner ruling).

### Rollback and redeploy

The rollback button is `.github/workflows/deploy-production.yml` (Actions >
Deploy production > Run workflow, on `main`). Empty, it redeploys main's
head; with a full SHA, that earlier commit. It refuses a commit outside
main's history or without a green CI/CD run (check, image and e2e), runs
the same deploy script with the image already on the VM (the last 3
releases and the confirmed one), records it as the confirmed release (the
automatic rollback's target from then on), and checks that
`PRODUCTION_URL` then serves that commit. A migration is never undone:
rolling back across a schema change needs the restore point (below). The
same button with an empty SHA is how a changed host setting
(`set-secret.sh`) reaches the running web.

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
missing or older than 26 hours. Each deploy (and each automatic rollback)
adds a `predeploy-*` dump; only the newest 14 stay, which on a busy day of
pushes can be less than a day, so the nightly dumps are the longer history.

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

### Local persona stack

There is no staging (R-166); persona testing and E2E run on the local stack
(R-168), never against production.

1. Start Postgres and Mailpit, copy `.env.example` and migrate, as in "Mail
   in tests" above.
2. In `apps/web/.env.local`, with `MYCHESS_ENV=local`, set
   `MYCHESS_TEST_SIGNIN=1` and a `TEST_SIGNIN_SECRET` of at least 32 random
   characters (`openssl rand -base64 32`).
3. `pnpm --filter @mychess/db seed:personas` seeds the persona accounts and
   their data (#258; it refuses to run unless `MYCHESS_ENV` is `local` and
   the database host is `localhost`, `127.0.0.1`, `[::1]` or
   `host.docker.internal`). Each run deletes the five persona accounts and
   seeds them again, so it also resets whatever a tester changed. Other
   accounts are never deleted, but a local account linked to
   `persona-coach` receives the automatic forks of R-49 on each run. The
   host check cannot tell a tunnel to a remote database on localhost from a
   local one; never tunnel to production. The seed is built to
   `packages/db/local/dist/`, outside the production image.
4. `pnpm --filter @mychess/web dev`, then sign a persona in with
   `POST /api/test/sign-in`, body `{"email":"persona-<id>@mychess.test"}`
   and the secret in `x-test-secret`. Magic links land in Mailpit.

## Opponent's games (broadcast index)

`/fide` ("Opponent's games", #316) lists a FIDE ID's over-the-board games
from the Lichess broadcast dumps of the 12 newest months in
`https://database.lichess.org/broadcast/list.txt` (R-183). It answers from
an index in two tables:

- `broadcast_months`: one row per dump month (`YYYY-MM`) with its `state`
  (`pending`, `processing`, `done`, `failed`), `attempts`, `game_count`
  and when it was claimed, processed or last failed.
- `broadcast_games`: one row per broadcast game with at least one FIDE ID:
  the Lichess game URL (unique, kept under the first month that listed it),
  both players' names and FIDE IDs, date, result, ECO, opening and event.
  No moves. Public broadcast data only; no account owns it and the data
  export leaves it out.

The index fills on demand (R-184): a search hands each of its months that
is not ready to a background runner in the web process, which downloads that
one month's dump from database.lichess.org, streams it, and writes its games
and `done` in one transaction. One month at a time per process; a row lock
keeps two processes off the same month. Nothing runs on a schedule and
there is no bulk import: a month nobody searches is never fetched. The
month list is cached an hour and a player's Lichess FIDE profile a day, in
memory only. Searches are not logged with the searched ID.

Retry rules (domain `BROADCAST_MONTH_RULES`, spec decision 2, R-188): one
attempt may run 10 minutes and stall at most 60 s; a failed attempt puts the
month back to `pending` and the next search may try it again 10 minutes
later; after the third failed attempt it is `failed`, shown as
"unavailable, retried tomorrow", and a search 24 hours later tries it
again. A month left `processing` over 15 minutes (its process died) counts
as a failed attempt.

The month states on production:

```sh
sudo docker exec -i mychess-production-postgres-1 psql -U mychess -d mychess -c \
  "select month, state, attempts, game_count, claimed_at, failed_at, processed_at
     from broadcast_months order by month desc"
```

Resetting a month (to retry a failed one now, or to re-read a dump) sets it
back to pending; the next search that needs it processes it again:

```sh
sudo docker exec -i mychess-production-postgres-1 psql -U mychess -d mychess -c \
  "update broadcast_months set state = 'pending', attempts = 0, failed_at = null
    where month = 'YYYY-MM'"
```

Never delete a `broadcast_months` row: its games cascade with it, and a
game stored under it may also be listed by a later month already `done`,
which would then lack that game. Re-reading a month adds the games the
index lacks and changes none it has. Leave a month that is `processing`
alone until it is done, failed or 15 minutes old: resetting it under a live
attempt makes that attempt lose its claim and throw its work away.

`FIDE_DUMP_FIXTURE_DIR` is a local-only switch for E2E: with
`MYCHESS_ENV=local` and the test sign-in on (`MYCHESS_TEST_SIGNIN`,
`TEST_SIGNIN_SECRET`), the runner reads `list.txt` and
`lichess_db_broadcast_<YYYY-MM>.pgn.zst` from that directory instead of
database.lichess.org, and Lichess's FIDE profile answers 404 (so the result
is headed by the ID alone). Production refuses to start with it set.
`apps/web/playwright.config.ts` and `infra/compose/e2e.yml` point it at
`apps/web/e2e/fixtures/broadcast/`: two invented months, made by `node
apps/web/e2e/support/broadcast-fixture.ts` (rerun after changing the games
there; `fide-search.spec.ts` fails while the committed files differ). The
E2E journey resets those months to pending in its own database before it
searches.

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The web container's healthcheck calls it.
`GET /api/version` answers `{"commit":"<sha>"}`, the commit the image was
built from (`null` where the build named none); the deploy's release check,
the deploy button and `uptime.yml` compare it.
