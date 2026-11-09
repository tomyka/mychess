# S8: M1 exit

Issue #258, part of epic #250. Slice row S8 in `2026-10-16-m1-slices-plan.md`.

## The rulings applied

- R-32 as amended by R-168: persona seed accounts exist on the local stack only; persona testers and E2E run against it.
- R-73 and R-93 with R-166: the persona test sign-in is on only locally; production always refuses it. There is no staging any more.
- R-166: Vercel staging and its Neon database are retired. Done on 2026-11-09 by the owner's yes, step by step: Neon `neon-byzantine-sail`, Vercel project `mychess-staging`, and the frozen v1 Vercel project `mychess` were deleted.
- R-169: no v1 account count (R-71 dropped).
- R-170: the brand is MyChess; R-167 the domain mychess.lt. No open question blocks the M1 exit.
- R-5: M1 closes when the core loop works for the personas; production is already live (R-166, deploy job and uptime green).

## Lead decisions

1. **Staging leaves the code.** `MYCHESS_ENV` takes `local` and `production` only. The Vercel lock in `env.ts` (`VERCEL` set means `MYCHESS_ENV` must be named) goes with it, since nothing deploys to Vercel. `apps/web/vercel.json` is deleted; the prune route stays because the VM's timer calls it. Comments, `.env.example`, `docs/operations.md`, the persona docs and the role files stop naming staging. ADR 0007's staging sentences get a "superseded by ADR 0010" note, not an edit of the decision. Marked SECURITY: the production lock and the test sign-in change.
2. **Persona seed is one idempotent command**, `pnpm --filter @mychess/db seed:personas`, built on the existing repositories (no raw SQL inserts), refusing to run unless `MYCHESS_ENV` is `local` and the database host is local. One exception: the account row itself is a direct insert matching what the test sign-in writes, because only Better Auth in `apps/web` creates accounts at runtime and a db repository for it would have no runtime caller; onboarding and coaching then go through the repositories. Each run deletes and reseeds the five persona accounts. It seeds the M1 parts of each persona doc's "Seed data" table: accounts (`persona-<id>@mychess.test` and `persona-coach2`), the coach link and group "Šeštadienio grupė" with join dates, the pending invite, repertoires from the docs' PGN fences, the assignments (group Caro-Kann with its deadline), shares, and a few weeks of training history. M2 and M3 rows (goals, messages, linked accounts, games) are not seeded now.
3. **Seed definitions live in one module** (`packages/db/src/testing/personas/`) so later E2E fixtures can import them; existing E2E tests are not rewritten in this slice.
4. **Persona testing runs locally**: local Postgres, Mailpit, `pnpm dev`, the seed, test sign-in on. The four persona agents get the local URL and sign-in method instead of a staging URL. The lead triages their findings into issues labelled `persona/*`; the owner decides which block the M1 exit.
5. **Architecture review**: the architect runs `improve-codebase-architecture` over M1's packages; the owner picks follow-ups, which become issues (M2 or later).

## Design

- **web** (`apps/web/src/server/env.ts`, `test-sign-in.ts`, the prune route comment, `.env.example`): drop `staging` and the Vercel fields; the test sign-in is allowed only when `MYCHESS_ENV` is `local`. Tests: production still refuses the sign-in; local still allows it; an unknown env value (including `staging`) is refused at parse.
- **db** (`packages/db/src/testing/personas/`, its script entry `seed-personas.ts` there because `src/bin` may not import `src/testing`, built to `packages/db/local/dist/` so the image never ships it, `seed:personas` script): pure definitions plus a seeding function that goes through the repositories; a feature test seeds twice into a Testcontainers database and asserts the same rows (idempotence) and the persona journeys' preconditions (Rokas sees his assignment, the coach sees three group members, Gabija has two coaches).
- **docs**: operations.md (local persona stack section replaces "Vercel staging"), personas README and docs, `.claude/agents/persona-*.md`, `qa.md`, `security-reviewer.md`, `backend-dev.md`.
- **ci**: the `TODO(#234)` staging block in `quality.yml` is removed.

## Testing

TDD per task; the gate (`node quality/gate.mjs check`) before each commit. Persona testers are exploratory and produce issues, not tests.

## Done means

- No tracked file outside `archive/` and dated specs and plans describes staging as live.
- `seed:personas` runs twice locally without error or duplicate rows.
- The four persona agents ran the M1 journeys locally; findings are issues; the owner signed off which, if any, block.
- The architect's review ran; the owner picked follow-ups.
- Retro done; #234 closed as superseded; #258 and epic #250 closed; milestone M1 closed.
