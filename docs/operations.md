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
2. `pnpm test:e2e`. It builds the app and serves it on
   `http://127.0.0.1:3100`; a server already on that port is reused.

### Mail in tests (Mailpit, from S1)

Staging and production send with Resend; local runs and E2E use Mailpit.
Nothing sends mail yet, so there is no Mailpit container yet. S1 (magic-link
sign-in) adds it:

- Locally: `docker run -d --name mychess-mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`
  (SMTP on 1025, web UI and API on 8025), or a compose file under `infra/`
  if S1 needs more than one container.
- CI: a `services: mailpit` container on the `e2e` job with the same ports.
- E2E reads the magic link through Mailpit's API
  (`GET /api/v1/message/latest`). How the app chooses between Resend and
  Mailpit is S1's spec to decide.

## Health check

`GET /api/health` answers `200 {"status":"ok","database":"up"}` when the
app reaches its database and `503 {"status":"unavailable","database":"down"}`
when it does not; never cached. The staging deploy's smoke test (#234) can
call it.
