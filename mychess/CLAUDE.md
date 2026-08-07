# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MyChess (mychess.lt) — a general chess-training platform (openings/repertoires, spaced-repetition drilling, tournaments, FIDE/Lichess/Chess.com integration). **This is not a kids' product** — an early idea that was dropped; don't apply kid-safety/COPPA-style framing to features or copy.

Stack: SvelteKit 2 + Svelte 5 (runes), Supabase (Postgres + Auth, via `@supabase/ssr`), Tailwind 4, deployed on Vercel (`adapter-vercel`, Node 22.x runtime).

## Repo layout

The git repo root is one level **above** this directory (`git rev-parse --show-toplevel`; the path is machine-specific, so don't hardcode it). This directory (`mychess/`) is the actual SvelteKit app — all `npm` commands run from here. Design specs and implementation plans from past features live one level up, at `../docs/superpowers/specs/` and `../docs/superpowers/plans/`, not under this directory's own (mostly stale) `docs/`.

## Commands

Run from this directory (`mychess/`):

- `npm run dev` — dev server (Vite)
- `npm run build` / `npm run preview` — production build / preview it locally
- `npm test` / `npm run test:watch` — vitest (unit tests, colocated `*.test.ts` files)
- `npx vitest run path/to/file.test.ts` — run a single test file
- `npm run check` / `npm run check:watch` — `svelte-kit sync` + `svelte-check` (TypeScript + Svelte type checking)
- `npm run fide:import` — one-off script (`scripts/import-fide.ts`) to bulk-import FIDE player data
- `npx playwright test` — e2e tests (`tests/*.e2e.ts`); builds and previews the app first, runs against Chromium + a Pixel 5 mobile profile

There is no lint script; `svelte-check` is the correctness gate along with vitest.

**`npm run check` must report zero errors before pushing to `main`.** There is no tolerated baseline — a prior one (OAuth callback/connect routes' `string | undefined` env-var typing) was fixed via `requireEnv()` in `src/lib/env.ts`, which narrows a `$env/dynamic/*` value to `string`, throwing a clear error if it's actually missing. Use it for any new required env var read outside `+layout.server.ts`'s existing patterns, rather than reintroducing the same class of error.

## Database & migrations

- SQL migrations live in `supabase/migrations/*.sql`, numbered sequentially (`0001_...` onward).
- **There is no local Postgres and no working service-role key in this environment.** Claude cannot apply migrations directly. Write the migration file, then paste its contents for the user to run manually in the Supabase dashboard SQL editor (or trigger the `migrate.yml` GitHub Action if asked). Never assume a migration took effect — if a feature depends on new schema/RLS, ask the user to confirm they ran it before relying on it.
- Migration files can drift from the live schema (has happened at least twice — `repertoires`/`moves` columns, and `coach_notes`). Before writing code against a table whose shape you're unsure of, ask the user to run a quick read-only `information_schema.columns` (or `select *`) query against production rather than trusting the migration history.
- RLS is used throughout. Remember: a `WITH CHECK` clause cannot reference the pre-update (`OLD`) row — enforcing column immutability on `UPDATE` requires a `BEFORE UPDATE` trigger instead. Also remember Postgres ORs together multiple permissive policies for the same operation — a broad `for all` policy silently defeats a narrower same-operation policy added alongside it; split into single-operation policies instead.
- Supabase's default `anon` grant on new views/tables isn't revoked by granting to `authenticated` — add an explicit `REVOKE ALL ... FROM anon, public` when a view shouldn't be public.
- `.upsert()` without an explicit `onConflict` targets the table's primary key, not other unique constraints — always pass `{ onConflict: '<col1>,<col2>' }` explicitly when upserting against a non-PK unique constraint (e.g. `assigned_repertoires`'s `unique(player_id, repertoire_id)`).

## Architecture

**Route groups gate by role**, enforced in each group's `+layout.server.ts`:
- `src/routes/(player)/` — default player experience. Guests (no session) and anonymous sessions pass through; a `role: 'coach'` profile is redirected to `/coach`.
- `src/routes/(coach)/` — requires a real (non-anonymous) session with `profile.role === 'coach'`; everyone else is redirected to `/` or `/login`.
- `src/routes/auth/`, `/login`, `/welcome`, `/join/[token]` — outside both groups (auth flows, onboarding, invite redemption).
- `src/routes/api/` — JSON endpoints (cron-triggered jobs, imports, quest/review progress) rather than page routes.

**Auth model** (`src/hooks.server.ts`, `src/lib/server/auth.ts`, `src/lib/server/guest.ts`):
- `locals.safeGetSession()` is the single source of truth — returns `{ session, user, profile, isGuest }`. It does *not* eagerly create a session; public pages render with `user: null`.
- Guests can get a *lazy anonymous* Supabase session (`ensureGuestSession`) to try DB-backed features without registering; anonymous users get an auto-created `profiles` row (`ensureGuestProfile`) with placeholder display name `"Guest"`.
- `requireAccount(locals)` is the guard for pages/actions that need a real (non-anonymous) account — throws a redirect to `/login` otherwise. Because TypeScript can't narrow its return type, call sites use `user!.id` afterward, matching existing sibling files — this is intentional, not a defect to "fix."
- Converting a guest to a real account backfills `display_name` from `first_name`/`last_name` once set, replacing the `"Guest"` placeholder.

**Code split: pure logic vs. Supabase I/O.** Throughout `src/lib/`, business logic that can be unit-tested without a database lives in a plain module (e.g. `src/lib/pgn-import.ts`, `src/lib/repertoire.ts`, `src/lib/coach-players.ts`, `src/lib/fide/*.ts`, `src/lib/tournaments/*.ts`, `src/lib/srs/*.ts`, `src/lib/badges/*.ts`, `src/lib/quests/*.ts`) with a colocated `*.test.ts`. Anything that actually touches `supabase` lives in `src/lib/server/` (e.g. `src/lib/server/pgn-import.ts`, `src/lib/server/coach-players.ts`) and, following established precedent, is generally *not* unit-tested directly — it's a thin wrapper around the pure logic plus DB calls, exercised through the pure-logic tests and manual/e2e verification instead.

**Key domains under `src/lib/`:**
- `srs/` — XP/leveling math (`xp.ts`), used by the Practice training flow.
- `pgn/` — PGN parsing into position graphs (`parser.ts`), consumed by `pgn-import.ts` to build `repertoires`/`positions`/`moves` rows.
- `fide/` — FIDE rating lookup, search, and ranking logic; `download.ts`/`import-job.ts` back the `fide:import` script and the cron-triggered `/api/fide/import` route.
- `tournaments/` — tournament listing/filtering/ranking (`query.ts`) plus a scraper (`scraper.ts`, `scrape-job.ts`) that also runs as a Supabase Edge Function (`supabase/functions/tournaments-scrape/`) and via `/api/tournaments/scrape`.
- `badges/`, `quests/`, `cosmetics.ts` — gamification layer (grants, recalculation, daily quest generation).
- `coach-players.ts` (+ `server/coach-players.ts`) — the many-to-many coach↔player relationship system: request/accept flow, invite-link redemption (`/join/[token]`), and directory browsing (`/coach/students` finding players, `/(player)/coaches` finding coaches). This has its own guard-trigger-based anti-hijack protection at the DB layer (see migrations 0019–0021) — don't bypass it by writing directly instead of through the relationship functions.
- `repertoire.ts` / `server/pgn-import.ts` — repertoires are position/move graphs built from parsed PGN; a repertoire is *owned* by whoever uploaded it (`repertoires.player_id`) and separately *assigned* to students via `assigned_repertoires` (coach_id, player_id, repertoire_id) — ownership and assignment are deliberately decoupled so a coach can build a personal library and assign the same repertoire to many students.

**Chess platform integrations** (`src/lib/server/{lichess,chesscom,oauth}.ts`, `src/routes/auth/{connect,callback}/*`): OAuth/PKCE flows to link Lichess and Chess.com accounts, plus a custom Google Sign-In flow — all hand-rolled against each provider's token endpoint rather than a generic OAuth library. `oauth.ts` centralizes signed-state handling (`OAUTH_STATE_SECRET`).

**Client-side chess UI:** `chess.js` for rules/move validation, `chessground` for the interactive board, wrapped by `src/lib/components/ChessBoard.svelte`.

**PWA:** `@vite-pwa/sveltekit` (configured in `vite.config.ts`) generates a service worker with `NetworkFirst` caching for Supabase REST calls; manifest/icons under `static/`.

## Svelte/SvelteKit conventions used throughout

- Runes mode is forced project-wide via `svelte.config.js` (`compilerOptions.runes`), except inside `node_modules`.
- Mutating forms use `use:enhance` with `+page.server.ts` `actions`; a two-button toggle pattern (`{#each [...] as const as x}` + conditional Tailwind classes + a hidden input) is reused for every binary choice (White/Black, Player/Coach, etc.) instead of a native `<select>`.
- File inputs are visually hidden (`class="hidden"`) with a styled `<label for="...">` as the visible "Choose File" trigger — keep the original descriptive `<label>` text/for-association intact when doing this, since component tests assert on it via `getByLabelText`.
- Vitest environment is `node` by default; component tests that need the DOM opt in per-file with a `// @vitest-environment jsdom` pragma comment (not global config — see the note in `vite.config.ts`).

## Workflow notes

- **Log substantive requests as GitHub issues.** When the user's request is a real feature, bug, or task (not a trivial reply/confirmation/clarification), file it as a GitHub issue in `tomyka/mychess` via `gh issue create --title "..." --body "..."` — do this as part of handling the request, with a clean title/description reflecting the actual ask, not a raw prompt dump. Skip this for one-word replies, "yes"/"looks good" confirmations, or answers to Claude's own clarifying questions.
  - **Default (most issues):** a lightweight body — Problem, Proposed Solution, Acceptance Criteria, Non-Goals — borrowed from the `prd` skill's schema but skipping its discovery interview and the AI/Technical/Risk sections. No need to ask clarifying questions first; write it from context.
  - **Larger feature initiatives only** (new product surface, something that genuinely warrants stakeholder-style scoping): invoke the full `prd` skill — interview included — and either paste the resulting PRD into the issue body or link it, rather than using the lightweight template.
- Treat production (mychess.lt / Vercel) as the test environment for this project going forward: commit and push directly to `main` without asking for confirmation first, since `main` auto-deploys via Vercel and the project has no other users yet. This does not extend to destructive git operations (force-push, history rewrites) — those still require asking.
- When a request's scope is vague (no file/function named, no clear done-condition), ask one focused clarifying question before fanning out searches across the repo — don't burn tokens exploring to guess intent. Once scope is clear (named files, stated done-condition), act without further questions.
- Substantial features go through brainstorm → spec → plan → subagent-driven-development (spec-compliance review, then code-quality review, per task) in an isolated worktree; small iterative UI/UX fixes are made directly in-place, still gated on the full `vitest` + `svelte-check` run before commit.
