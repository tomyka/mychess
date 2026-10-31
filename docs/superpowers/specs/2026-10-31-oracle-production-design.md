# Production on the Oracle VM, sportbet_new's CI/CD (#310)

Owner request (2026-10-31): apply the CI/CD sportbet_new has and host
production on the unused Oracle VM. Rulings R-164 to R-166; ADR 0010
supersedes ADR 0009.

## Owner answers (2026-10-31)

1. The VM is **sportbet-ci**, made purely mychess's and renamed `mychess`.
   sportbet's CI moves off it first, onto sportbet-web.
2. Build and test jobs run on **GitHub-hosted runners** (the repo is public,
   so minutes are free and a self-hosted runner would face a public repo);
   only the deploy job runs on a self-hosted runner on the VM.
3. **No staging**, as sportbet's decision 16: a green `main` deploys to
   production. Vercel staging and its Neon database are retired once
   production is live.
4. **R-10 is decided now**: the domain is mychess.lt (R-167); Caddy gets its
   certificate once DNS points at the VM.

## The host

- sportbet-ci: A1.Flex arm64, 1 OCPU, 6 GB, 45 GB disk, Ubuntu 24.04,
  eu-stockholm-1. Primary NIC private (10.0.1.96); a second VNIC on the
  public subnet answers on 129.151.205.113 (sportbet's former production
  address, kept alive by its public-NIC policy routing).
- After the move it runs only mychess: Caddy (edge), the app container,
  Postgres 18.6 in a container on a named volume, systemd timers (nightly
  backup with restore test, backup watch, rate-limit prune, docker prune,
  runner watchdog) and one GitHub Actions runner registered to
  `tomyka/mychess` with label `production`.
- Names: hostname `mychess`, `/srv/mychess/{production,edge,backups}`,
  `/etc/mychess`, compose projects `mychess-production` and `mychess-edge`.
- SSH reaches it directly on the public address (no jump through
  sportbet-web once sportbet's runner is gone).

## The pipeline (`.github/workflows/ci.yml`)

Same graph and guards as sportbet_new's ci.yml:

```
check ----------------+
image --> e2e --------+--> deploy (main only)
```

- **check** (ubuntu-latest): the quality gate, `node --test quality/*.test.mjs`
  and the infra shell tests. quality.yml (protected) becomes pull-request
  only, an owner edit, so the gate runs once per push.
- **image** (ubuntu-24.04-arm): `docker build --build-arg APP_COMMIT=$SHA`,
  Trivy (digest-pinned, CRITICAL fails), `docker save | zstd` uploaded as a
  short-lived artifact; its image id is a job output.
- **e2e** (ubuntu-24.04-arm): loads that image, starts the throwaway stack
  (infra/compose app.yml + e2e.yml: Postgres on tmpfs, Mailpit, migrate,
  seed, web), runs Playwright against it. The black-box tests thus run on
  the very bytes that deploy.
- **deploy** (`[self-hosted, production]`, `environment: production`,
  `if: github.ref == 'refs/heads/main' && github.repository == 'tomyka/mychess'`):
  downloads the artifact, ordering guard (an older commit never replaces a
  newer deployed one), `sudo -n infra/ci/deploy-production.sh <tag> <id>`:
  load and verify the image id, copy compose and Caddy files to /srv,
  edge up, Postgres up, pre-deploy pg_dump, migrate, swap web, release check
  through Caddy (`/api/version` equals the commit, key pages 200), roll the
  web back to the previous tag on failure, prune to 3 releases.
- Triggers: `push` and `workflow_dispatch` only, no `pull_request`, so no
  fork can run code on the VM's runner.
- **deploy-production.yml**: the rollback button, as sportbet's: verify the
  sha is on main with a green ci.yml run, redeploy its image (kept on the
  host, last 3), wait until `/api/version` answers it.
- **uptime.yml**: every 10 minutes `/api/version`, `/` and the certificate
  (more than 14 days).
- **Dependabot**: dependabot.yml, automerge of green patch updates, lockfile
  regeneration, as sportbet's.

## The app

- A root `Dockerfile` (node 24.21.0-slim, pnpm from packageManager, Next
  `output: 'standalone'`, `packages/db/dist` and migrations alongside, runs
  as `node`); one image serves web, migrate and seed.
- `GET /api/version` returns `{ "commit": APP_COMMIT }`.
- The client IP: Caddy replaces X-Forwarded-For with the client address
  (no trusted proxies) and sets X-Real-IP; the app's reading stays valid,
  docs/operations.md is updated.
- The rate-limit prune runs from a systemd timer calling
  `/api/cron/prune-rate-limits` with the bearer CRON_SECRET; vercel.json's
  cron goes when Vercel goes.
- Host `.env` (root, 0600), written once by `production-env.sh`, never
  rotated: POSTGRES_PASSWORD, BETTER_AUTH_SECRET, AUDIT_EMAIL_KEY,
  CRON_SECRET, BETTER_AUTH_URL, MYCHESS_ENV=production; Resend, Google and
  Lichess values set through stdin scripts. MYCHESS_TEST_SIGNIN is never set.

## Backups

Nightly pg_dump with row counts before and after, a restore test into a
throwaway Postgres, upload through an OCI Object Storage write-only
pre-authenticated request (owner creates bucket and PAR), status file, mail
alert through Resend on failure and a morning watch, as sportbet's
backup-production.sh. A pg_dump before every deploy, 14 kept.

## Order

1. **sportbet_new** (its own repo and rules): image and e2e jobs run on
   sportbet-web, deploy uses the local image, nothing fetches from
   sportbet-ci; a green deploy proves it; then sportbet's runner is removed
   from sportbet-ci.
2. **mychess repo**: Dockerfile, `/api/version`, infra/ (compose, edge,
   ci scripts, host scripts, shell tests), workflows. CI goes green up to
   e2e while deploy waits for the host.
3. **Host**: clean sportbet off sportbet-ci (containers, volumes, units,
   users, /srv/sportbet-new, /etc/sportbet), rename, bootstrap, production
   env, runner, timers.
4. **Owner steps**: the domain and its DNS A record to 129.151.205.113;
   rename the instance in the OCI console (optional); bucket and write-only
   PAR; Google OAuth redirect URI and Lichess client for the domain; Resend
   sending domain; quality.yml to pull-request only; the GitHub
   `production` environment.
5. First deploy, smoke check, then retire Vercel staging and Neon.

## Open consequences

- Persona testing (#258) had staging and the test sign-in (R-73). Without
  staging it runs locally against the persona seeds; R-73's route stays off
  in production.
- Production data now lives on one VM: the nightly off-host backup and its
  restore test are the safety net.
