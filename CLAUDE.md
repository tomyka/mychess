# CLAUDE.md

mychess helps Lithuanian chess players practise their openings, and lets
coaches assign repertoires to their players and monitor their progress.
References: chessbook.com, chessreps.com, openingtree.com. This is v2, a
restart. v1 (SvelteKit + Supabase) is read-only reference in `archive/v1/`
(tag `v1-final`); `archive/README.md` says what is ported and what is not.

**Read first:** `docs/owner-rulings.md` (what the owner decided, from the
grilling in #226), `docs/CONTEXT.md` (the domain language) and `docs/adr/`
(architecture decisions). Do not reopen a ruling or ADR without the owner.
Never invent a product rule: if those files and the slice spec do not state
it, ask the owner.

## Workflow

- Every substantive request becomes a GitHub issue in `tomyka/mychess`,
  closed when its acceptance criteria are met (`docs/agents/issue-tracker.md`).
- `size/large` work goes grill/brainstorm -> spec -> plan before code;
  specs and plans live in `docs/superpowers/{specs,plans}/`.
- Trunk-based: work lands on `main`; only the lead commits. A green `main`
  deploys to production on the Oracle VM; there is no staging (R-166).
- Agent team: the roles are in `.claude/agents/`; which team fits which
  stage, the pipeline, the working rules and the autonomy rules are in
  `docs/agent-team.md`.
- After a slice: `mp-code-review` on its diff, `improve-codebase-architecture`
  on its files (owner picks follow-ups), `retro`.

## Code rules

### Packages and layering

| Package | Contains | May import |
| --- | --- | --- |
| `packages/chess` (`@mychess/chess`) | positions, position keys, move graph, PGN, ECO and taxonomy, FSRS scheduling, reconciliation, deviation detection | `chess.js`, `ts-fsrs`, `zod` (tests also `vitest`, `fast-check`) |
| `packages/domain` (`@mychess/domain`) | accounts, coach capability, links, invites, groups, assignments, forks, goals, threads, notifications, entitlements, access rules | `zod`, `@mychess/chess` |
| `packages/db` (`@mychess/db`) | Drizzle schema, migrations, repositories, test helpers, seeds | `@mychess/domain`, `@mychess/chess`, `drizzle-orm`, `pg`, `zod` |
| `packages/integrations` (`@mychess/integrations`) | Lichess, Chess.com, FIDE, the Lithuania ranking from the FIDE-LTU list (R-67), chess-results clients | `@mychess/chess`, `zod` |
| `apps/web` (`@mychess/web`) | Next.js App Router pages, components, server actions | all packages through their entry points |

Enforced by dependency-cruiser and ESLint. `archive/` is never imported,
built, linted or tested.

### Rules

- **Rules live in domain objects** (`packages/domain`, `packages/chess`), not
  in pages, server actions, route handlers or queries. A server action
  authenticates, loads, calls the domain method that decides, and saves.
- **Access is decided in the domain and enforced again in queries.** A
  coach reads a player's data only through the access rules of ruling Q26.
- **Positions are keyed, not moves-by-path** (Q27): a repertoire is a
  position-keyed graph; a position key is the FEN without the move counters.
- **Training state belongs to the player and the repertoire move**, never to
  a copy of the repertoire, so a live-linked assignment can change under it
  (reconciliation, Q29).
- **Refusals are values**, not exceptions: domain methods return a
  `Result`-style success or refusal with a reason the UI can translate.
  Exceptions are only for programmer errors: a caller passing input it
  should already have parsed, such as an invalid FEN to `positionKey`.
  Zod issue messages are message-catalogue keys, not text.
- **Parse at the edges:** every request body, query result and external API
  response is parsed with zod. Build-time generators over trusted, committed
  source data (for example `packages/chess/scripts/`) are exempt.
- **No user-visible string in code:** all text goes through the message
  catalogues; Lithuanian is the default locale, English the second.
- Times are stored in UTC; display in the user's time zone
  (Europe/Vilnius by default).
- Migrations: change the Drizzle schema, generate, review and commit the
  SQL. Never edit a migration that has reached `main`.
- No production data in tests, fixtures, issues or logs; persona testing uses the
  persona seeds (`docs/personas/`).

## Quality gates (enforced automatically)

Copied from sportbet_new (ruling Q19); `docs/quality-gates.md` has the
details.

- After every file edit, a hook formats and lint-fixes the file and reports
  what is left.
- When you finish, the Stop hook runs the fast gate: format, lint, strict
  typecheck, suppression markers, tests with coverage thresholds, CRAP, dead
  code (knip) and architecture (dependency-cruiser).
- CI/CD (`.github/workflows/ci.yml`, #310) runs the gate, builds and scans
  the one image, runs E2E against it and deploys a green `main` to the
  production VM; `quality.yml` runs the gate on pull requests. Mutation testing runs nowhere automatically (owner, #295); run it by
  hand with `node quality/gate.mjs mutation`.

Rules:

- Write tests together with the code. Every test asserts observable
  behaviour.
- Kill surviving mutants by strengthening assertions.
- Keep functions small (cyclomatic complexity <= 10, CRAP <= 30). Split rather
  than suppress. No suppression comments, no `any`, no non-null `!`.
- Never edit gate configuration: `eslint.config.mjs`, `tsconfig.base.json`,
  `tsconfig.strict.json`, `vitest.config.ts`, `stryker.config.mjs`,
  `knip.json`, `.dependency-cruiser.cjs`, `quality/**`, `.claude/settings.json`,
  and each package's tsconfig and vitest config. These edits are blocked. If a
  gate seems wrong, stop and tell the owner.
- A new test file must be run by a vitest project or be listed, with its
  reason, in `quality/quality.config.json` `testsOutsideGate`.
- The gate needs Docker (db tests use Testcontainers) and runs once per
  working tree at a time.

Commands: `node quality/gate.mjs check` (the full gate without mutation),
`node quality/gate.mjs mutation` (changed files), `node quality/fix.mjs`
(format and lint-fix everything), `node quality/crap.mjs --top 20`.
